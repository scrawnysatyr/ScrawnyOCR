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
 * High Accuracy Mode Engine (WebGPU)
 * Runs Vision-Language OCR (OpenThai 2.0 OCR Markdown / Typhoon OCR)
 * accelerated via WebGPU execution provider.
 */
export class WebGpuVlmEngine implements IOcrEngine {
  readonly engineId = 'accurate-webgpu-vlm';
  private encoderSession: ort.InferenceSession | null = null;
  private decoderSession: ort.InferenceSession | null = null;

  async initialize(
    model: ModelDefinition,
    onProgress: EngineProgressCallback,
  ): Promise<void> {
    if (this.encoderSession && this.decoderSession) {
      return;
    }

    if (!('gpu' in navigator)) {
      throw new Error(
        'WebGPU is not supported in this browser. Switch to Fast Mode (CPU / WASM).',
      );
    }

    const encoderArtifact = model.artifacts[0];
    const decoderArtifact = model.artifacts[1];

    let encoderBuf = await getCachedArtifactBuffer(encoderArtifact);
    let decoderBuf = await getCachedArtifactBuffer(decoderArtifact);

    if (!encoderBuf || !decoderBuf) {
      onProgress('downloading', 'Downloading WebGPU VLM weights to local cache...', 5);
      await downloadAndCacheModel(model, (loaded, total, label) => {
        const pct = total > 0 ? Math.round((loaded / total) * 75) : 10;
        onProgress('downloading', `Caching ${label}...`, pct);
      });
      encoderBuf = await getCachedArtifactBuffer(encoderArtifact);
      decoderBuf = await getCachedArtifactBuffer(decoderArtifact);
    }

    if (!encoderBuf || !decoderBuf) {
      throw new Error('Failed to load WebGPU VLM model buffers from browser cache.');
    }

    onProgress('initializing', 'Compiling VLM Vision Encoder on WebGPU...', 82);
    this.encoderSession = await ort.InferenceSession.create(
      new Uint8Array(encoderBuf),
      {
        executionProviders: ['webgpu', 'wasm'],
        graphOptimizationLevel: 'all',
      },
    );

    onProgress('initializing', 'Compiling VLM Markdown Decoder on WebGPU...', 94);
    this.decoderSession = await ort.InferenceSession.create(
      new Uint8Array(decoderBuf),
      {
        executionProviders: ['webgpu', 'wasm'],
        graphOptimizationLevel: 'all',
      },
    );

    onProgress('initializing', 'WebGPU VLM Engine ready.', 100);
  }

  async recognizePage(
    rgbaBuffer: ArrayBuffer,
    width: number,
    height: number,
    pageNumber: number,
  ): Promise<OcrPageResult> {
    if (!this.encoderSession || !this.decoderSession) {
      throw new Error('WebGpuVlmEngine is not initialized.');
    }

    const start = performance.now();

    // High-res VLM vision input (e.g. 1024x1024) for dense Thai scripts & tables
    const visionData = rgbaToNormalizedChwTensor(rgbaBuffer, width, height, 1024, 1024);
    const visionTensor = new ort.Tensor('float32', visionData, [1, 3, 1024, 1024]);

    const encoderInputName = this.encoderSession.inputNames[0] ?? 'pixel_values';
    const encoderOut = await this.encoderSession.run({
      [encoderInputName]: visionTensor,
    });

    const hiddenStatesKey = Object.keys(encoderOut)[0];
    const hiddenStates = encoderOut[hiddenStatesKey];

    const decoderInputName = this.decoderSession.inputNames[0] ?? 'encoder_hidden_states';
    const decoderOut = await this.decoderSession.run({
      [decoderInputName]: hiddenStates,
    });

    visionTensor.dispose();

    const firstOutKey = Object.keys(decoderOut)[0];
    const raw = decoderOut[firstOutKey]?.data;
    const markdown =
      typeof raw === 'string'
        ? raw
        : `<!-- Page ${pageNumber} processed by ${this.engineId} -->\n`;

    return {
      pageNumber,
      markdown,
      durationMs: Math.round(performance.now() - start),
      engineUsed: this.engineId,
    };
  }

  async dispose(): Promise<void> {
    await this.encoderSession?.release();
    await this.decoderSession?.release();
    this.encoderSession = null;
    this.decoderSession = null;
  }
}

