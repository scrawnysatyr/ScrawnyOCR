import * as ort from 'onnxruntime-web';
import type { ModelDefinition, OcrPageResult } from '../../types/ocr';
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

const DET_MEAN = [0.485, 0.456, 0.406] as const;
const DET_STD = [0.229, 0.224, 0.225] as const;

const DET_LIMIT = 1280;
const DET_THRESH = 0.3;
const DET_BOX_THRESH = 0.55;
const DET_UNCLIP = 1.5;
const DET_MIN_SIZE = 3;
const REC_HEIGHT = 48;
const REC_MAX_WIDTH = 3200;
const REC_DROP_BELOW = 0.65;
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

  async initialize(
    model: ModelDefinition,
    onProgress: EngineProgressCallback,
  ): Promise<void> {
    if (this.detSession && this.recSession) {
      return;
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

    onProgress('initializing', 'Initializing PP-OCRv6-tiny Detector (WASM)...', 80);
    this.detSession = await ort.InferenceSession.create(new Uint8Array(detBuf), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });

    onProgress('initializing', 'Initializing Thai CTC Recognizer (WASM)...', 92);
    this.recSession = await ort.InferenceSession.create(new Uint8Array(recBuf), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });

    onProgress('initializing', 'OpenThai2.0-OCR-Text Engine ready.', 100);
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
    const rowTexts: string[] = [];
    const recInputName = this.recSession.inputNames[0] ?? 'x';

    for (const row of orderedRows) {
      const parts: string[] = [];
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
          parts.push(text.normalize('NFC'));
        }
      }
      if (parts.length > 0) {
        rowTexts.push(parts.join('  '));
      }
    }

    const markdown =
      rowTexts.length > 0
        ? rowTexts.join('\n')
        : `<!-- Page ${pageNumber}: no readable text -->`;

    return {
      pageNumber,
      markdown,
      durationMs: Math.round(performance.now() - start),
      engineUsed: this.engineId,
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
   * Crops, grayscales, flattens background, and normalizes to [-1, 1] CHW for rec.onnx.
   */
  private prepareRecCropTensor(
    rgba: Uint8ClampedArray,
    srcW: number,
    srcH: number,
    box: TextBox,
    dstW: number,
    dstH: number,
  ): Float32Array {
    const cropX0 = box.x0;
    const cropY0 = box.y0;
    const cropW = Math.max(1, box.x1 - box.x0);
    const cropH = Math.max(1, box.y1 - box.y0);

    const gray = new Float32Array(dstW * dstH);
    for (let y = 0; y < dstH; y++) {
      const sy = Math.min(srcH - 1, Math.max(0, Math.floor(cropY0 + (y / dstH) * cropH)));
      for (let x = 0; x < dstW; x++) {
        const sx = Math.min(srcW - 1, Math.max(0, Math.floor(cropX0 + (x / dstW) * cropW)));
        const idx = (sy * srcW + sx) * 4;
        // Luminance
        gray[y * dstW + x] =
          0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2];
      }
    }

    // Flatten background per column (matches OpenThai2.0 config.json "color": "flatten")
    const marginRows = Math.max(2, Math.floor(dstH / 6));
    const diff = new Float32Array(dstW * dstH);
    let maxDiff = 24;

    for (let x = 0; x < dstW; x++) {
      let bgSum = 0;
      for (let y = 0; y < marginRows; y++) {
        bgSum += gray[y * dstW + x];
        bgSum += gray[(dstH - 1 - y) * dstW + x];
      }
      const bg = bgSum / (marginRows * 2);
      for (let y = 0; y < dstH; y++) {
        const d = Math.abs(gray[y * dstW + x] - bg);
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
          chars.push(ch);
          confSum += maxVal;
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

  async dispose(): Promise<void> {
    await this.detSession?.release();
    await this.recSession?.release();
    this.detSession = null;
    this.recSession = null;
  }
}
