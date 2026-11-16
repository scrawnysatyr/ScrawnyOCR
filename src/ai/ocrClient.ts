import type {
  ModelDefinition,
  NormalizedDocument,
  OcrPageResult,
  OcrProgressEvent,
  UnifiedDocumentResult,
  WorkerRequest,
  WorkerResponse,
} from '../types/ocr';

export class OcrWorkerClient {
  private worker: Worker | null = null;

  private getOrCreateWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL('../workers/ocr.worker.ts', import.meta.url),
        { type: 'module' },
      );
    }
    return this.worker;
  }

  async runDocumentOcr(
    doc: NormalizedDocument,
    model: ModelDefinition,
    onProgress: (event: OcrProgressEvent) => void,
  ): Promise<UnifiedDocumentResult> {
    const worker = this.getOrCreateWorker();

    return new Promise<UnifiedDocumentResult>((resolve, reject) => {
      const handleMessage = (event: MessageEvent<WorkerResponse>) => {
        const res = event.data;

        if (res.type === 'PROGRESS') {
          onProgress(res.payload);
          return;
        }

        if (res.type === 'OCR_COMPLETE') {
          cleanup();
          const combinedMarkdown = res.payload.pages
            .map((p: OcrPageResult) => p.markdown.trim())
            .filter(Boolean)
            .join('\n\n---\n\n');

          resolve({
            fileName: doc.fileName,
            mode: model.mode,
            modelId: model.id,
            pages: res.payload.pages,
            combinedMarkdown,
            totalDurationMs: res.payload.totalDurationMs,
          });
          return;
        }

        if (res.type === 'ERROR') {
          cleanup();
          reject(new Error(res.payload.message));
        }
      };

      const handleError = (err: ErrorEvent) => {
        cleanup();
        reject(new Error(err.message || 'Web Worker crashed unexpectedly.'));
      };

      const cleanup = () => {
        worker.removeEventListener('message', handleMessage);
        worker.removeEventListener('error', handleError);
      };

      worker.addEventListener('message', handleMessage);
      worker.addEventListener('error', handleError);

      // Copy RGBA buffers so we can transfer ownership without mutating UI ImageData
      const transferables: ArrayBuffer[] = [];
      const payloadPages = doc.pages.map((page) => {
        const copy = page.imageData.data.slice().buffer;
        transferables.push(copy);
        return {
          pageNumber: page.pageNumber,
          width: page.width,
          height: page.height,
          buffer: copy,
        };
      });

      const request: WorkerRequest = {
        type: 'RUN_OCR',
        payload: {
          model,
          pages: payloadPages,
          languageHint: 'th+en',
        },
      };

      worker.postMessage(request, transferables);
    });
  }

  cancel(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'CANCEL' } satisfies WorkerRequest);
    }
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

