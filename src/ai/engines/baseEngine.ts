import type { ModelDefinition, OcrPageResult } from '../../types/ocr';

export interface EngineProgressCallback {
  (stage: 'downloading' | 'initializing' | 'inferring', message: string, percent: number): void;
}

export interface IOcrEngine {
  readonly engineId: string;
  initialize(
    model: ModelDefinition,
    onProgress: EngineProgressCallback,
  ): Promise<void>;
  recognizePage(
    rgbaBuffer: ArrayBuffer,
    width: number,
    height: number,
    pageNumber: number,
  ): Promise<OcrPageResult>;
  dispose(): Promise<void>;
}

/**
 * Converts RGBA pixel buffer into a normalized CHW Float32Array tensor
 * suitable for ONNX vision/layout models (e.g. PP-DocLayout / VLM vision encoder).
 */
export function rgbaToNormalizedChwTensor(
  rgbaBuffer: ArrayBuffer,
  srcWidth: number,
  srcHeight: number,
  targetWidth: number,
  targetHeight: number,
): Float32Array {
  const src = new Uint8ClampedArray(rgbaBuffer);
  const channelSize = targetWidth * targetHeight;
  const chw = new Float32Array(3 * channelSize);

  const scaleX = srcWidth / targetWidth;
  const scaleY = srcHeight / targetHeight;

  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];

  for (let y = 0; y < targetHeight; y++) {
    const sy = Math.min(srcHeight - 1, Math.floor(y * scaleY));
    for (let x = 0; x < targetWidth; x++) {
      const sx = Math.min(srcWidth - 1, Math.floor(x * scaleX));
      const srcIdx = (sy * srcWidth + sx) * 4;
      const dstIdx = y * targetWidth + x;

      const r = src[srcIdx] / 255;
      const g = src[srcIdx + 1] / 255;
      const b = src[srcIdx + 2] / 255;

      chw[dstIdx] = (r - mean[0]) / std[0];
      chw[channelSize + dstIdx] = (g - mean[1]) / std[1];
      chw[2 * channelSize + dstIdx] = (b - mean[2]) / std[2];
    }
  }

  return chw;
}

