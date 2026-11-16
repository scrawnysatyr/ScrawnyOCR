import * as ort from 'onnxruntime-web';
import type { ModelDefinition, OcrPageResult } from '../../types/ocr';
import {
  downloadAndCacheModel,
  getCachedArtifactBuffer,
} from '../../utils/modelCache';
import {
  rgbaToNormalizedChwTensor,
  type EngineProgressCallback,
  type IOcrEngine,
} from './baseEngine';

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
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/';
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
      // CTC blank at index 0, followed by dictionary lines
      this.charDict = ['<blank>', ...dictText.split(/\r?\n/).filter((l) => l.length > 0)];
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

    // 1. Run text detector (det.onnx) on 640x640 normalized input
    const detInputData = rgbaToNormalizedChwTensor(rgbaBuffer, width, height, 640, 640);
    const detTensor = new ort.Tensor('float32', detInputData, [1, 3, 640, 640]);
    const detInputName = this.detSession.inputNames[0] ?? 'x';
    const detOutputs = await this.detSession.run({ [detInputName]: detTensor });
    detTensor.dispose();

    // 2. Run line recognizer (rec.onnx) on 48x320 normalized crop/strip
    const recInputData = rgbaToNormalizedChwTensor(rgbaBuffer, width, height, 320, 48);
    const recTensor = new ort.Tensor('float32', recInputData, [1, 3, 48, 320]);
    const recInputName = this.recSession.inputNames[0] ?? 'x';
    const recOutputs = await this.recSession.run({ [recInputName]: recTensor });
    recTensor.dispose();

    const decodedLine = this.ctcGreedyDecode(recOutputs);
    const detSummary = Object.keys(detOutputs).length > 0 ? 'layout+det' : 'det';

    const markdown = decodedLine
      ? decodedLine
      : `<!-- Page ${pageNumber} (${detSummary} via ${this.engineId}) -->`;

    return {
      pageNumber,
      markdown,
      durationMs: Math.round(performance.now() - start),
      engineUsed: this.engineId,
    };
  }

  private ctcGreedyDecode(recOutputs: ort.InferenceSession.OnnxValueMapType): string {
    const firstKey = Object.keys(recOutputs)[0];
    const tensor = firstKey ? recOutputs[firstKey] : undefined;
    if (!tensor || !(tensor.data instanceof Float32Array) || tensor.dims.length < 3) {
      return '';
    }

    const [, timeSteps, numClasses] = tensor.dims;
    const logits = tensor.data;
    const chars: string[] = [];
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
        if (ch) chars.push(ch);
      }
      prevIdx = maxIdx;
    }

    return chars.join('').trim();
  }

  async dispose(): Promise<void> {
    await this.detSession?.release();
    await this.recSession?.release();
    this.detSession = null;
    this.recSession = null;
  }
}
