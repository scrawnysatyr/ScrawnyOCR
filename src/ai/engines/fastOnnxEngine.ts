import * as ort from 'onnxruntime-web';
import type { ModelDefinition, ModelMode, OcrPageResult } from '../../types/ocr';
import {
  downloadAndCacheModel,
  getCachedArtifactBuffer,
} from '../../utils/modelCache';
import type { EngineProgressCallback, IOcrEngine } from './baseEngine';

interface TextBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface RecognizedBox {
  box: TextBox;
  text: string;
}

const DET_MEAN = [0.485, 0.456, 0.406] as const;
const DET_STD = [0.229, 0.224, 0.225] as const;

const DET_LIMIT = 1280;
const DET_THRESH = 0.3;
const DET_BOX_THRESH = 0.55;
const DET_UNCLIP = 1.5;
const DET_MIN_SIZE = 3;
const REC_HEIGHT = 48;
const REC_MAX_WIDTH = 3200;
const REC_DROP_BELOW = 0.5;
const REC_MIN_CHARS = 1;

/**
 * Fast Mode Engine (CPU / WASM)
 * Runs iapp/OpenThai2.0-OCR-Text (det.onnx + rec.onnx + rec_dict.txt)
 * using onnxruntime-web WASM backend.
 */
export class FastOnnxEngine implements IOcrEngine {
  readonly engineId = 'fast-openthaigpt-ocr-text';
  private detSession: ort.InferenceSession | null = null;
  private recSession: ort.InferenceSession | null = null;
  private charDict: string[] = [];
  private currentMode: ModelMode = 'fast';
  private activeBackend: 'wasm' | 'webgpu' = 'wasm';

  async initialize(
    model: ModelDefinition,
    onProgress: EngineProgressCallback,
  ): Promise<void> {
    this.currentMode = model.mode;
    const wantWebGpu = model.backend === 'webgpu' && 'gpu' in navigator;

    if (
      this.detSession &&
      this.recSession &&
      this.activeBackend === (wantWebGpu ? 'webgpu' : 'wasm')
    ) {
      return;
    }

    if (this.detSession || this.recSession) {
      await this.dispose();
    }

    // Configure WASM runtime inside Web Worker (load .wasm from CDN to stay under 25 MiB host limit)
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/';
    ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 2);
    ort.env.wasm.simd = true;

    const detArtifact = model.artifacts[0];
    const recArtifact = model.artifacts[1];
    const dictArtifact = model.artifacts[2];

    let detBuf = await getCachedArtifactBuffer(detArtifact);
    let recBuf = await getCachedArtifactBuffer(recArtifact);
    let dictBuf = dictArtifact ? await getCachedArtifactBuffer(dictArtifact) : null;

    if (!detBuf || !recBuf || (dictArtifact && !dictBuf)) {
      onProgress('downloading', 'Downloading OpenThai2.0-OCR-Text (~4.3 MB)...', 5);
      await downloadAndCacheModel(model, (loaded, total, label) => {
        const pct = total > 0 ? Math.round((loaded / total) * 70) : 10;
        onProgress('downloading', `Caching ${label}...`, pct);
      });
      detBuf = await getCachedArtifactBuffer(detArtifact);
      recBuf = await getCachedArtifactBuffer(recArtifact);
      dictBuf = dictArtifact ? await getCachedArtifactBuffer(dictArtifact) : null;
    }

    if (!detBuf || !recBuf) {
      throw new Error('Failed to load OpenThai2.0-OCR-Text ONNX buffers from cache.');
    }

    if (dictBuf) {
      const dictText = new TextDecoder('utf-8').decode(dictBuf);
      // CTC classes: 0 = blank, 1..N = rec_dict.txt, N+1 = trailing space (PaddleOCR)
      const chars = dictText.split(/\r?\n/).filter((l) => l.length > 0);
      this.charDict = ['', ...chars, ' '];
    }

    const providers: Array<'webgpu' | 'wasm'> = wantWebGpu ? ['webgpu', 'wasm'] : ['wasm'];
    const backendLabel = wantWebGpu ? 'WebGPU' : 'WASM';

    const createWithFallback = async (
      buf: ArrayBuffer,
    ): Promise<{ session: ort.InferenceSession; usedWebGpu: boolean }> => {
      if (wantWebGpu) {
        try {
          const session = await ort.InferenceSession.create(new Uint8Array(buf), {
            executionProviders: providers,
            graphOptimizationLevel: 'all',
          });
          return { session, usedWebGpu: true };
        } catch {
          // Fallback to WASM if WebGPU EP fails on this operator/device
        }
      }
      const session = await ort.InferenceSession.create(new Uint8Array(buf), {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      return { session, usedWebGpu: false };
    };

    onProgress('initializing', `Initializing PP-OCRv6-tiny Detector (${backendLabel})...`, 80);
    const detRes = await createWithFallback(detBuf);
    this.detSession = detRes.session;

    onProgress('initializing', `Initializing Thai CTC Recognizer (${backendLabel})...`, 92);
    const recRes = await createWithFallback(recBuf);
    this.recSession = recRes.session;
    this.activeBackend = detRes.usedWebGpu || recRes.usedWebGpu ? 'webgpu' : 'wasm';

    onProgress('initializing', `OpenThai2.0-OCR-Text Engine ready (${this.activeBackend.toUpperCase()}).`, 100);
  }

  async recognizePage(
    rgbaBuffer: ArrayBuffer,
    width: number,
    height: number,
    pageNumber: number,
  ): Promise<OcrPageResult> {
    if (!this.detSession || !this.recSession) {
      throw new Error('FastOnnxEngine is not initialized.');
    }

    const start = performance.now();
    const rgba = new Uint8ClampedArray(rgbaBuffer);

    // 1. Detect text line bounding boxes (det.onnx)
    const boxes = await this.detectLines(rgba, width, height);
    if (boxes.length === 0) {
      return {
        pageNumber,
        markdown: `<!-- Page ${pageNumber}: no text detected -->`,
        durationMs: Math.round(performance.now() - start),
        engineUsed: this.engineId,
      };
    }

    // 2. Sort boxes into reading order (rows top-to-bottom, left-to-right within row)
    const orderedRows = this.sortBoxesIntoRows(boxes);

    // 3. Recognize each line crop with rec.onnx
    const rowBoxes: RecognizedBox[][] = [];
    const rowTexts: string[] = [];
    const recInputName = this.recSession.inputNames[0] ?? 'x';

    for (const row of orderedRows) {
      const recognizedInRow: RecognizedBox[] = [];
      for (const box of row) {
        const cropW = Math.max(1, Math.round(box.x1 - box.x0));
        const cropH = Math.max(1, Math.round(box.y1 - box.y0));
        const targetW = Math.min(
          REC_MAX_WIDTH,
          Math.max(16, Math.ceil((REC_HEIGHT * cropW) / cropH)),
        );

        const recData = this.prepareRecCropTensor(rgba, width, height, box, targetW, REC_HEIGHT);
        const recTensor = new ort.Tensor('float32', recData, [1, 3, REC_HEIGHT, targetW]);
        const recOutputs = await this.recSession.run({ [recInputName]: recTensor });
        recTensor.dispose();

        const { text, confidence } = this.ctcGreedyDecode(recOutputs);
        if (text.length >= REC_MIN_CHARS && confidence >= REC_DROP_BELOW) {
          recognizedInRow.push({ box, text: text.normalize('NFC') });
        }
      }
      if (recognizedInRow.length > 0) {
        rowBoxes.push(recognizedInRow);
        rowTexts.push(recognizedInRow.map((r) => r.text).join('  '));
      }
    }

    const markdown =
      rowTexts.length === 0
        ? `<!-- Page ${pageNumber}: no readable text -->`
        : this.currentMode === 'hybrid'
          ? await this.buildHybridStructuredMarkdown(rowBoxes, rgba, width, height)
          : rowTexts.join('\n');

    return {
      pageNumber,
      markdown,
      durationMs: Math.round(performance.now() - start),
      engineUsed:
        this.currentMode === 'hybrid'
          ? `hybrid-vlm-text-ocr-${this.activeBackend}`
          : this.engineId,
    };
  }

  private async detectLines(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
  ): Promise<TextBox[]> {
    if (!this.detSession) return [];

    const maxSide = Math.max(width, height);
    const scale = maxSide > DET_LIMIT ? DET_LIMIT / maxSide : 1.0;
    const rw = Math.max(32, Math.round((width * scale) / 32) * 32);
    const rh = Math.max(32, Math.round((height * scale) / 32) * 32);

    const detInput = this.prepareDetTensor(rgba, width, height, rw, rh);
    const detTensor = new ort.Tensor('float32', detInput, [1, 3, rh, rw]);
    const detInputName = this.detSession.inputNames[0] ?? 'x';
    const detOutputs = await this.detSession.run({ [detInputName]: detTensor });
    detTensor.dispose();

    const firstKey = Object.keys(detOutputs)[0];
    const probTensor = firstKey ? detOutputs[firstKey] : undefined;
    if (!probTensor || !(probTensor.data instanceof Float32Array)) {
      return [];
    }

    const outH = probTensor.dims[2] ?? rh;
    const outW = probTensor.dims[3] ?? rw;
    const prob = probTensor.data;

    return this.extractDbBoxes(prob, outW, outH, width, height);
  }

  /**
   * Resizes RGBA image to (rw, rh) and normalizes with DET_MEAN / DET_STD (BGR order for PaddleOCR).
   */
  private prepareDetTensor(
    rgba: Uint8ClampedArray,
    srcW: number,
    srcH: number,
    dstW: number,
    dstH: number,
  ): Float32Array {
    const channelSize = dstW * dstH;
    const chw = new Float32Array(3 * channelSize);
    const scaleX = srcW / dstW;
    const scaleY = srcH / dstH;

    for (let y = 0; y < dstH; y++) {
      const sy = Math.min(srcH - 1, Math.floor(y * scaleY));
      for (let x = 0; x < dstW; x++) {
        const sx = Math.min(srcW - 1, Math.floor(x * scaleX));
        const srcIdx = (sy * srcW + sx) * 4;
        const dstIdx = y * dstW + x;

        const r = rgba[srcIdx] / 255;
        const g = rgba[srcIdx + 1] / 255;
        const b = rgba[srcIdx + 2] / 255;

        chw[dstIdx] = (b - DET_MEAN[0]) / DET_STD[0];
        chw[channelSize + dstIdx] = (g - DET_MEAN[1]) / DET_STD[1];
        chw[2 * channelSize + dstIdx] = (r - DET_MEAN[2]) / DET_STD[2];
      }
    }
    return chw;
  }

  /**
   * Connected-component DB box extraction + unclip expansion.
   */
  private extractDbBoxes(
    prob: Float32Array,
    probW: number,
    probH: number,
    origW: number,
    origH: number,
  ): TextBox[] {
    const total = probW * probH;
    const visited = new Uint8Array(total);
    const queue = new Int32Array(total);
    const boxes: TextBox[] = [];
    const sx = origW / probW;
    const sy = origH / probH;

    for (let i = 0; i < total; i++) {
      if (visited[i] || prob[i] <= DET_THRESH) continue;

      let head = 0;
      let tail = 0;
      queue[tail++] = i;
      visited[i] = 1;

      let minX = i % probW;
      let maxX = minX;
      let minY = (i / probW) | 0;
      let maxY = minY;

      while (head < tail) {
        const idx = queue[head++];
        const cx = idx % probW;
        const cy = (idx / probW) | 0;

        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        // 4-connected neighbors
        if (cx > 0) {
          const n = idx - 1;
          if (!visited[n] && prob[n] > DET_THRESH) {
            visited[n] = 1;
            queue[tail++] = n;
          }
        }
        if (cx + 1 < probW) {
          const n = idx + 1;
          if (!visited[n] && prob[n] > DET_THRESH) {
            visited[n] = 1;
            queue[tail++] = n;
          }
        }
        if (cy > 0) {
          const n = idx - probW;
          if (!visited[n] && prob[n] > DET_THRESH) {
            visited[n] = 1;
            queue[tail++] = n;
          }
        }
        if (cy + 1 < probH) {
          const n = idx + probW;
          if (!visited[n] && prob[n] > DET_THRESH) {
            visited[n] = 1;
            queue[tail++] = n;
          }
        }
      }

      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (Math.min(bw, bh) < DET_MIN_SIZE) continue;

      // Mean probability inside bounding box
      let probSum = 0;
      for (let y = minY; y <= maxY; y++) {
        const rowOff = y * probW;
        for (let x = minX; x <= maxX; x++) {
          probSum += prob[rowOff + x];
        }
      }
      if (probSum / (bw * bh) < DET_BOX_THRESH) continue;

      // Unclip distance = area * ratio / perimeter
      const expand = (bw * bh * DET_UNCLIP) / (2 * (bw + bh));
      const x0 = Math.max(0, (minX - expand) * sx);
      const y0 = Math.max(0, (minY - expand) * sy);
      const x1 = Math.min(origW - 1, (maxX + 1 + expand) * sx);
      const y1 = Math.min(origH - 1, (maxY + 1 + expand) * sy);

      if (x1 - x0 >= 4 && y1 - y0 >= 4) {
        boxes.push({ x0, y0, x1, y1 });
      }
    }

    return boxes;
  }

  private sortBoxesIntoRows(boxes: TextBox[]): TextBox[][] {
    const sorted = [...boxes].sort((a, b) => a.y0 - b.y0);
    const rows: TextBox[][] = [];

    for (const box of sorted) {
      const boxMidY = (box.y0 + box.y1) / 2;
      let placed = false;

      for (const row of rows) {
        const ref = row[0];
        const overlap = Math.min(ref.y1, box.y1) - Math.max(ref.y0, box.y0);
        const minH = Math.min(ref.y1 - ref.y0, box.y1 - box.y0);
        if (overlap > 0.4 * minH || (boxMidY >= ref.y0 && boxMidY <= ref.y1)) {
          row.push(box);
          placed = true;
          break;
        }
      }

      if (!placed) {
        rows.push([box]);
      }
    }

    for (const row of rows) {
      row.sort((a, b) => a.x0 - b.x0);
    }

    return rows;
  }

  /**
   * Crops (with small padding), bilinearly resizes, flattens light paper background,
   * and normalizes to [-1, 1] CHW for rec.onnx without erasing Thai upper vowels/tones.
   */
  private prepareRecCropTensor(
    rgba: Uint8ClampedArray,
    srcW: number,
    srcH: number,
    box: TextBox,
    dstW: number,
    dstH: number,
  ): Float32Array {
    const padX = 4;
    const padY = 4;
    const cropX0 = Math.max(0, box.x0 - padX);
    const cropY0 = Math.max(0, box.y0 - padY);
    const cropX1 = Math.min(srcW - 1, box.x1 + padX);
    const cropY1 = Math.min(srcH - 1, box.y1 + padY);
    const cropW = Math.max(1, cropX1 - cropX0);
    const cropH = Math.max(1, cropY1 - cropY0);

    const gray = new Float32Array(dstW * dstH);
    for (let y = 0; y < dstH; y++) {
      const fy = cropY0 + ((y + 0.5) / dstH) * cropH - 0.5;
      const y0 = Math.max(0, Math.min(srcH - 1, Math.floor(fy)));
      const y1 = Math.max(0, Math.min(srcH - 1, y0 + 1));
      const wy = Math.max(0, Math.min(1, fy - y0));

      for (let x = 0; x < dstW; x++) {
        const fx = cropX0 + ((x + 0.5) / dstW) * cropW - 0.5;
        const x0 = Math.max(0, Math.min(srcW - 1, Math.floor(fx)));
        const x1 = Math.max(0, Math.min(srcW - 1, x0 + 1));
        const wx = Math.max(0, Math.min(1, fx - x0));

        const lum = (px: number, py: number) => {
          const i = (py * srcW + px) * 4;
          return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
        };

        const l00 = lum(x0, y0);
        const l10 = lum(x1, y0);
        const l01 = lum(x0, y1);
        const l11 = lum(x1, y1);
        const top = l00 + (l10 - l00) * wx;
        const bot = l01 + (l11 - l01) * wx;
        gray[y * dstW + x] = top + (bot - top) * wy;
      }
    }

    // Estimate paper background per column using max luminance of top/bottom 2px edge
    // so bold Thai upper vowels/tone marks never invert the background estimate.
    const diff = new Float32Array(dstW * dstH);
    let maxDiff = 48;

    for (let x = 0; x < dstW; x++) {
      let colBg = Math.max(
        gray[x],
        gray[dstW + x],
        gray[(dstH - 2) * dstW + x],
        gray[(dstH - 1) * dstW + x],
      );
      if (colBg < 160) {
        let colMax = colBg;
        for (let y = 0; y < dstH; y++) {
          if (gray[y * dstW + x] > colMax) colMax = gray[y * dstW + x];
        }
        colBg = colMax;
      }
      for (let y = 0; y < dstH; y++) {
        const d = Math.max(0, colBg - gray[y * dstW + x]);
        diff[y * dstW + x] = d;
        if (d > maxDiff) maxDiff = d;
      }
    }

    const channelSize = dstW * dstH;
    const chw = new Float32Array(3 * channelSize);
    const invScale = 255 / maxDiff;

    for (let i = 0; i < channelSize; i++) {
      const flattened = Math.max(0, Math.min(255, 255 - diff[i] * invScale));
      const norm = flattened / 127.5 - 1.0;
      chw[i] = norm;
      chw[channelSize + i] = norm;
      chw[2 * channelSize + i] = norm;
    }

    return chw;
  }

  private ctcGreedyDecode(
    recOutputs: ort.InferenceSession.OnnxValueMapType,
  ): { text: string; confidence: number } {
    const firstKey = Object.keys(recOutputs)[0];
    const tensor = firstKey ? recOutputs[firstKey] : undefined;
    if (!tensor || !(tensor.data instanceof Float32Array) || tensor.dims.length < 3) {
      return { text: '', confidence: 0 };
    }

    const [, timeSteps, numClasses] = tensor.dims;
    const logits = tensor.data;
    const chars: string[] = [];
    let confSum = 0;
    let confCount = 0;
    let prevIdx = 0;

    for (let t = 0; t < timeSteps; t++) {
      const offset = t * numClasses;
      let maxIdx = 0;
      let maxVal = logits[offset];
      for (let c = 1; c < numClasses; c++) {
        if (logits[offset + c] > maxVal) {
          maxVal = logits[offset + c];
          maxIdx = c;
        }
      }

      if (maxIdx !== 0 && maxIdx !== prevIdx) {
        const ch = this.charDict[maxIdx];
        if (ch !== undefined) {
          let prob = maxVal;
          if (maxVal < 0 || maxVal > 1) {
            let sumExp = 0;
            for (let c = 0; c < numClasses; c++) {
              sumExp += Math.exp(logits[offset + c] - maxVal);
            }
            prob = sumExp > 0 ? 1 / sumExp : 0;
          }
          chars.push(ch);
          confSum += prob;
          confCount++;
        }
      }
      prevIdx = maxIdx;
    }

    return {
      text: chars.join('').trim(),
      confidence: confCount > 0 ? confSum / confCount : 0,
    };
  }

  private escapeHtmlCell(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Checks if there is a horizontal divider rule between two y coordinates in the page RGBA.
   */
  private detectHorizontalRuleBetween(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    yStart: number,
    yEnd: number,
  ): boolean {
    const top = Math.max(0, Math.floor(yStart));
    const bottom = Math.min(height - 1, Math.ceil(yEnd));
    if (bottom - top < 2) return false;

    const x0 = Math.floor(width * 0.12);
    const x1 = Math.ceil(width * 0.88);
    const span = x1 - x0;
    if (span <= 0) return false;

    for (let y = top; y <= bottom; y++) {
      let darkCount = 0;
      for (let x = x0; x < x1; x += 2) {
        const idx = (y * width + x) * 4;
        const gray = 0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2];
        if (gray < 175) darkCount++;
      }
      if (darkCount / (span / 2) >= 0.55) {
        return true;
      }
    }
    return false;
  }

  /**
   * Detects a centered top emblem/figure (e.g. Thai Garuda / ตราครุฑ) above firstTextY
   * and crops it into a PNG data URL using OffscreenCanvas when available.
   */
  private async extractTopEmblemDataUrl(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    firstTextY: number,
  ): Promise<string | null> {
    if (typeof OffscreenCanvas === 'undefined') return null;
    const maxY = Math.min(Math.floor(firstTextY) - 6, Math.floor(height * 0.28));
    if (maxY < 24) return null;

    const xMinBound = Math.floor(width * 0.3);
    const xMaxBound = Math.ceil(width * 0.7);
    let minX = width;
    let maxX = 0;
    let minY = maxY;
    let maxFoundY = 0;
    let darkPixels = 0;

    for (let y = Math.floor(height * 0.02); y < maxY; y += 2) {
      for (let x = xMinBound; x < xMaxBound; x += 2) {
        const idx = (y * width + x) * 4;
        const gray = 0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2];
        if (gray < 185) {
          darkPixels++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxFoundY) maxFoundY = y;
        }
      }
    }

    const boxW = maxX - minX;
    const boxH = maxFoundY - minY;
    if (darkPixels < 120 || boxW < 28 || boxH < 28 || boxW > width * 0.42) {
      return null;
    }

    const pad = 6;
    const cx0 = Math.max(0, minX - pad);
    const cy0 = Math.max(0, minY - pad);
    const cw = Math.min(width - cx0, boxW + pad * 2);
    const ch = Math.min(height - cy0, boxH + pad * 2);

    const canvas = new OffscreenCanvas(cw, ch);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const imgData = ctx.createImageData(cw, ch);
    for (let row = 0; row < ch; row++) {
      const srcOffset = ((cy0 + row) * width + cx0) * 4;
      const dstOffset = row * cw * 4;
      imgData.data.set(rgba.subarray(srcOffset, srcOffset + cw * 4), dstOffset);
    }
    ctx.putImageData(imgData, 0, 0);

    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let k = 0; k < bytes.length; k++) {
      binary += String.fromCharCode(bytes[k]);
    }
    return `data:image/png;base64,${btoa(binary)}`;
  }

  /**
   * Reconstructs Garuda/top emblem, headers, centered titles/page numbers,
   * horizontal dividers, committee lists, signature blocks, and data tables.
   */
  private async buildHybridStructuredMarkdown(
    rows: RecognizedBox[][],
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
  ): Promise<string> {
    const out: string[] = [];
    if (rows.length > 0) {
      const firstTextY = Math.min(...rows[0].map((r) => r.box.y0));
      const emblemUrl = await this.extractTopEmblemDataUrl(rgba, width, height, firstTextY);
      if (emblemUrl) {
        out.push(`![emblem](${emblemUrl})`);
      }
    }

    let i = 0;
    while (i < rows.length) {
      const row = rows[i];
      const rowTop = Math.min(...row.map((r) => r.box.y0));

      if (i > 0) {
        const prevBottom = Math.max(...rows[i - 1].map((r) => r.box.y1));
        if (
          rowTop - prevBottom >= 4 &&
          this.detectHorizontalRuleBetween(rgba, width, height, prevBottom + 1, rowTop - 1)
        ) {
          out.push('---');
        }
      }

      // Top-of-page 2-3 column header (e.g. เล่ม ... | ราชกิจจานุเบกษา | วันที่ ...)
      if (rowTop < height * 0.18 && row.length >= 2 && row.length <= 3) {
        const leftMost = row[0].box.x0;
        const rightMost = row[row.length - 1].box.x1;
        if (leftMost < width * 0.35 && rightMost > width * 0.65) {
          const left = this.escapeHtmlCell(row[0].text);
          const mid = row.length === 3 ? this.escapeHtmlCell(row[1].text) : '';
          const right = this.escapeHtmlCell(row[row.length - 1].text);
          out.push(
            `<table data-layout="header"><tbody><tr><td>${left}</td><td>${mid}</td><td>${right}</td></tr></tbody></table>`,
          );
          i++;
          continue;
        }
      }

      // Multi-column rows: committee list, 2-col signature block, or data table
      if (row.length >= 2) {
        let j = i;
        while (j + 1 < rows.length && rows[j + 1].length >= 2) {
          j++;
        }

        const blockRows = rows.slice(i, j + 1);
        const maxCols = Math.max(...blockRows.map((r) => r.length));
        const isCommitteeBlock =
          maxCols === 2 &&
          blockRows.some((r) =>
            /^[๑-๙0-9]+\./.test(r[0].text.trim()) ||
            /(ประธาน|รองประธาน|กรรมการ|เลขานุการ)/.test(r[r.length - 1].text),
          );

        if (isCommitteeBlock) {
          const trHtml = blockRows
            .map(
              (br) =>
                `<tr><td>${this.escapeHtmlCell(br[0]?.text ?? '')}</td><td>${this.escapeHtmlCell(br.slice(1).map((x) => x.text).join(' '))}</td></tr>`,
            )
            .join('');
          out.push(`<table data-layout="committee"><tbody>${trHtml}</tbody></table>`);
          i = j + 1;
          continue;
        }

        const hasSigKeywords = blockRows.some((r) =>
          r.some((c) => /date|signature|ลงชื่อ|ตำแหน่ง|director|minister|president|governor/i.test(c.text)),
        );

        if (maxCols === 2 && (hasSigKeywords || rowTop > height * 0.45)) {
          const leftLines: string[] = [];
          const rightLines: string[] = [];
          for (const br of blockRows) {
            for (const cell of br) {
              const cx = (cell.box.x0 + cell.box.x1) / 2;
              if (cx < width * 0.5) leftLines.push(this.escapeHtmlCell(cell.text));
              else rightLines.push(this.escapeHtmlCell(cell.text));
            }
          }
          if (leftLines.length > 0 && rightLines.length > 0) {
            out.push(
              `<table data-layout="signature"><tbody><tr><td>${leftLines.join('<br />')}</td><td>${rightLines.join('<br />')}</td></tr></tbody></table>`,
            );
            i = j + 1;
            continue;
          }
        }

        if (blockRows.length >= 2 && maxCols >= 2) {
          // Align cells into detected X column bands
          const allX0 = blockRows.flatMap((r) => r.map((c) => c.box.x0)).sort((a, b) => a - b);
          const colStarts: number[] = [];
          for (const x of allX0) {
            if (colStarts.length === 0 || x - colStarts[colStarts.length - 1] > width * 0.08) {
              colStarts.push(x);
            }
          }
          const numCols = Math.max(maxCols, colStarts.length);
          const trHtml = blockRows
            .map((br, idx) => {
              const tag = idx === 0 ? 'th' : 'td';
              const rowArr = Array<string>(numCols).fill('');
              for (const cell of br) {
                let bestCol = 0;
                let bestDist = Infinity;
                for (let c = 0; c < colStarts.length; c++) {
                  const d = Math.abs(cell.box.x0 - colStarts[c]);
                  if (d < bestDist) {
                    bestDist = d;
                    bestCol = c;
                  }
                }
                rowArr[bestCol] = rowArr[bestCol]
                  ? `${rowArr[bestCol]} ${cell.text}`
                  : cell.text;
              }
              return `<tr>${rowArr.map((txt) => `<${tag}>${this.escapeHtmlCell(txt)}</${tag}>`).join('')}</tr>`;
            })
            .join('');
          out.push(`<table><tbody>${trHtml}</tbody></table>`);
          i = j + 1;
          continue;
        }
      }

      // Single-box line: centered title / page number, right-aligned catchword, or signature line
      if (row.length === 1) {
        const box = row[0].box;
        const txt = row[0].text.trim();
        const boxCenter = (box.x0 + box.x1) / 2;
        const boxWidth = box.x1 - box.x0;

        // Right-aligned catchword at bottom of page (e.g. "คณะกรรมการ...")
        if (rowTop > height * 0.8 && box.x0 > width * 0.62) {
          out.push(`<p align="right">${txt}</p>`);
          i++;
          continue;
        }

        // Indented Thai official signature / order date block in lower half
        if (
          rowTop > height * 0.45 &&
          box.x0 > width * 0.3 &&
          (/^(สั่ง\s+ณ\s+วันที่|\(.*\)|คณบดี|อธิการบดี|รัฐมนตรี|ปลัด|ผู้อำนวยการ)/.test(txt) ||
            boxCenter > width * 0.56)
        ) {
          out.push(`<p align="signature">${txt}</p>`);
          i++;
          continue;
        }

        const isCentered =
          Math.abs(boxCenter - width / 2) < width * 0.14 && boxWidth < width * 0.78;
        if (isCentered) {
          const isPageNum = /^(หน้า\s*[\d๐-๙]+|-\s*[\d๐-๙]+\s*-|page\s*\d+)$/i.test(txt);
          out.push(
            isPageNum ? `<p align="center">${txt}</p>` : `<p align="center">**${txt}**</p>`,
          );
          i++;
          continue;
        }
      }

      // Standard prose line (bold+underline "หน้าที่" prefix if present)
      let lineText = row.map((r) => r.text).join('  ');
      lineText = lineText.replace(/^หน้าที่\s+/, '**<u>หน้าที่</u>** ');
      out.push(lineText);
      i++;
    }

    // Check bottom rule after last row
    if (rows.length > 0) {
      const lastBottom = Math.max(...rows[rows.length - 1].map((r) => r.box.y1));
      if (
        lastBottom < height - 6 &&
        this.detectHorizontalRuleBetween(
          rgba,
          width,
          height,
          lastBottom + 1,
          Math.min(height - 1, lastBottom + 24),
        )
      ) {
        out.push('---');
      }
    }

    return out.join('\n\n');
  }

  async dispose(): Promise<void> {
    await this.detSession?.release();
    await this.recSession?.release();
    this.detSession = null;
    this.recSession = null;
  }
}
