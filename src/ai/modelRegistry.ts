import type { ModelDefinition, ModelMode } from '../types/ocr';

export const MODEL_REGISTRY: Record<ModelMode, ModelDefinition> = {
  fast: {
    id: 'fast-openthaigpt-ocr-text-onnx',
    mode: 'fast',
    backend: 'wasm',
    name: 'Fast Mode (CPU / WASM)',
    nameTh: 'โหมดเร็ว (CPU / WASM)',
    badge: 'iapp/OpenThai2.0-OCR-Text (ONNX)',
    badgeTh: 'iapp/OpenThai2.0-OCR-Text (ONNX)',
    description:
      'Ultra-lightweight (~4.3 MB) Thai & English printed-text ONNX model (det.onnx + rec.onnx). Downloads fast and runs on any CPU.',
    descriptionTh:
      'โมเดล ONNX ขนาดจิ๋ว (~4.3 MB) จาก iapp/OpenThai2.0-OCR-Text (det.onnx + rec.onnx) โหลดไว รันบน CPU ได้ทุกเครื่อง',
    estimatedSizeMB: 4.3,
    repoUrl: 'https://huggingface.co/iapp/OpenThai2.0-OCR-Text',
    onnxReady: true,
    artifacts: [
      {
        key: 'openthaigpt-ocr-text-det',
        label: 'det.onnx (PP-OCRv6-tiny)',
        url: 'https://huggingface.co/iapp/OpenThai2.0-OCR-Text/resolve/main/det.onnx',
        approxBytes: 1_850_000,
      },
      {
        key: 'openthaigpt-ocr-text-rec',
        label: 'rec.onnx (Thai CTC Recognizer)',
        url: 'https://huggingface.co/iapp/OpenThai2.0-OCR-Text/resolve/main/rec.onnx',
        approxBytes: 2_450_000,
      },
      {
        key: 'openthaigpt-ocr-text-dict',
        label: 'rec_dict.txt (528 Thai/EN chars)',
        url: 'https://huggingface.co/iapp/OpenThai2.0-OCR-Text/resolve/main/rec_dict.txt',
        approxBytes: 8_192,
      },
      {
        key: 'openthaigpt-ocr-text-cfg',
        label: 'config.json',
        url: 'https://huggingface.co/iapp/OpenThai2.0-OCR-Text/resolve/main/config.json',
        approxBytes: 2_048,
      },
    ],
  },
  accurate: {
    id: 'accurate-typhoon-ocr2-2b-webgpu',
    mode: 'accurate',
    backend: 'webgpu',
    name: 'High Accuracy Mode (WebGPU • Default)',
    nameTh: 'โหมดความแม่นยำสูง (WebGPU • ค่าเริ่มต้น)',
    badge: 'typhoon-ai/typhoon-ocr2-2b (alt: OpenThai2.0-OCR-Markdown)',
    badgeTh: 'typhoon-ai/typhoon-ocr2-2b (หรือ OpenThai2.0-OCR-Markdown)',
    description:
      'Default VLM preset using Typhoon OCR2 2B for complex Thai layouts, Markdown & HTML tables (requires ONNX-exported WebGPU weights).',
    descriptionTh:
      'ค่าเริ่มต้นโหมดแม่นยำสูงด้วย Typhoon OCR2 2B สำหรับเอกสารไทยซับซ้อนและตาราง HTML (ต้องแปลงเป็น ONNX สำหรับ WebGPU ก่อน)',
    estimatedSizeMB: 1450,
    repoUrl: 'https://huggingface.co/typhoon-ai/typhoon-ocr2-2b',
    onnxReady: false,
    artifacts: [
      {
        key: 'typhoon-ocr2-vision-webgpu',
        label: 'Typhoon OCR2 Vision Encoder (ONNX)',
        url: 'https://huggingface.co/typhoon-ai/typhoon-ocr2-2b/resolve/main/onnx/vision_encoder_q4.onnx',
        approxBytes: 420 * 1024 * 1024,
      },
      {
        key: 'typhoon-ocr2-decoder-webgpu',
        label: 'Typhoon OCR2 Decoder (ONNX)',
        url: 'https://huggingface.co/typhoon-ai/typhoon-ocr2-2b/resolve/main/onnx/decoder_model_q4f16.onnx',
        approxBytes: 1030 * 1024 * 1024,
      },
    ],
  },
};

export interface WebGpuCapability {
  supported: boolean;
  reason?: string;
}

export async function checkWebGpuSupport(): Promise<WebGpuCapability> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    return {
      supported: false,
      reason: 'navigator.gpu is not available in this browser.',
    };
  }

  try {
    const adapter = await (
      navigator as Navigator & {
        gpu: { requestAdapter: () => Promise<unknown | null> };
      }
    ).gpu.requestAdapter();
    if (!adapter) {
      return {
        supported: false,
        reason: 'No compatible WebGPU adapter found.',
      };
    }
    return { supported: true };
  } catch (err) {
    return {
      supported: false,
      reason: err instanceof Error ? err.message : 'WebGPU initialization failed.',
    };
  }
}
