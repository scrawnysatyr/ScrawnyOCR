import type {
  ModelDefinition,
  OcrPageResult,
  WorkerRequest,
  WorkerResponse,
} from '../types/ocr';
import type { IOcrEngine } from '../ai/engines/baseEngine';
import { FastOnnxEngine } from '../ai/engines/fastOnnxEngine';
import { WebGpuVlmEngine } from '../ai/engines/webgpuVlmEngine';

let activeEngine: IOcrEngine | null = null;
let activeModelId: string | null = null;
let cancelled = false;

function post(response: WorkerResponse): void {
  self.postMessage(response);
}

async function ensureEngine(model: ModelDefinition): Promise<IOcrEngine> {
  if (activeEngine && activeModelId === model.id) {
    return activeEngine;
  }

  if (activeEngine) {
    await activeEngine.dispose();
    activeEngine = null;
    activeModelId = null;
  }

  const engine: IOcrEngine =
    model.mode === 'fast' || model.mode === 'hybrid'
      ? new FastOnnxEngine()
      : new WebGpuVlmEngine();

  await engine.initialize(model, (stage, message, percent) => {
    post({
      type: 'PROGRESS',
      payload: {
        stage,
        message,
        percent,
      },
    });
  });

  activeEngine = engine;
  activeModelId = model.id;
  return engine;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  if (msg.type === 'CANCEL') {
    cancelled = true;
    return;
  }

  if (msg.type === 'INIT_MODEL') {
    cancelled = false;
    try {
      const engine = await ensureEngine(msg.payload.model);
      post({
        type: 'MODEL_READY',
        payload: {
          modelId: msg.payload.model.id,
          backendUsed: engine.engineId,
        },
      });
    } catch (err) {
      post({
        type: 'ERROR',
        payload: {
          message: err instanceof Error ? err.message : 'Model initialization failed.',
        },
      });
    }
    return;
  }

  if (msg.type === 'RUN_OCR') {
    cancelled = false;
    const startAll = performance.now();

    try {
      const engine = await ensureEngine(msg.payload.model);
      const pages = msg.payload.pages;
      const results: OcrPageResult[] = [];

      for (let i = 0; i < pages.length; i++) {
        if (cancelled) {
          post({
            type: 'ERROR',
            payload: { message: 'OCR processing cancelled by user.' },
          });
          return;
        }

        const page = pages[i];
        const percent = Math.round(((i + 0.1) / pages.length) * 100);

        post({
          type: 'PROGRESS',
          payload: {
            stage: 'inferring',
            percent,
            currentPage: page.pageNumber,
            totalPages: pages.length,
            message: `Processing page ${page.pageNumber} of ${pages.length}...`,
          },
        });

        const pageResult = await engine.recognizePage(
          page.buffer,
          page.width,
          page.height,
          page.pageNumber,
        );
        results.push(pageResult);
      }

      post({
        type: 'OCR_COMPLETE',
        payload: {
          pages: results,
          totalDurationMs: Math.round(performance.now() - startAll),
        },
      });
    } catch (err) {
      post({
        type: 'ERROR',
        payload: {
          message: err instanceof Error ? err.message : 'OCR inference failed.',
        },
      });
    }
  }
};

