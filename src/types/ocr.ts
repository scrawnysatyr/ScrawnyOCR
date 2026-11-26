export type Language = 'th' | 'en';

export type ModelMode = 'fast' | 'hybrid' | 'accurate';

export type OcrBackend = 'wasm' | 'webgpu';

export interface ModelArtifact {
  /** Unique cache key for this artifact */
  key: string;
  /** Human-readable artifact name */
  label: string;
  /** Remote URL to fetch the model weights / tokenizer */
  url: string;
  /** Approximate size in bytes for progress & UI display */
  approxBytes: number;
}

export interface ModelDefinition {
  id: string;
  mode: ModelMode;
  backend: OcrBackend;
  name: string;
  nameTh: string;
  badge: string;
  badgeTh: string;
  description: string;
  descriptionTh: string;
  estimatedSizeMB: number;
  repoUrl?: string;
  /** True if official pre-converted ONNX weights are directly available for browser download */
  onnxReady?: boolean;
  artifacts: ModelArtifact[];
}

export interface CachedModelInfo {
  modelId: string;
  isCached: boolean;
  cachedBytes: number;
  cachedAt: number | null;
  artifactCount: number;
}

export interface NormalizedPage {
  pageNumber: number;
  width: number;
  height: number;
  imageData: ImageData;
  /** Lightweight JPEG data URL for UI thumbnail preview */
  previewUrl: string;
}

export interface NormalizedDocument {
  fileName: string;
  fileType: 'pdf' | 'image';
  fileSize: number;
  scaleUsed: number;
  pages: NormalizedPage[];
}

export interface OcrPageResult {
  pageNumber: number;
  /** Unified Intermediate Format: Markdown + HTML <table> */
  markdown: string;
  durationMs: number;
  engineUsed: string;
}

export interface UnifiedDocumentResult {
  fileName: string;
  mode: ModelMode;
  modelId: string;
  pages: OcrPageResult[];
  /** Combined Unified Intermediate Format across all pages */
  combinedMarkdown: string;
  totalDurationMs: number;
}

export type OcrStage =
  | 'idle'
  | 'normalizing'
  | 'downloading'
  | 'initializing'
  | 'inferring'
  | 'done'
  | 'error';

export interface OcrProgressEvent {
  stage: OcrStage;
  percent: number;
  currentPage?: number;
  totalPages?: number;
  message: string;
  bytesLoaded?: number;
  bytesTotal?: number;
}

/** Messages sent from Main Thread -> Web Worker */
export type WorkerRequest =
  | {
      type: 'INIT_MODEL';
      payload: {
        model: ModelDefinition;
      };
    }
  | {
      type: 'RUN_OCR';
      payload: {
        model: ModelDefinition;
        pages: Array<{
          pageNumber: number;
          width: number;
          height: number;
          /** Transferred ArrayBuffer of RGBA pixels */
          buffer: ArrayBuffer;
        }>;
        languageHint: 'th+en';
      };
    }
  | {
      type: 'CANCEL';
    };

/** Messages sent from Web Worker -> Main Thread */
export type WorkerResponse =
  | {
      type: 'PROGRESS';
      payload: OcrProgressEvent;
    }
  | {
      type: 'MODEL_READY';
      payload: {
        modelId: string;
        backendUsed: string;
      };
    }
  | {
      type: 'OCR_COMPLETE';
      payload: {
        pages: OcrPageResult[];
        totalDurationMs: number;
      };
    }
  | {
      type: 'ERROR';
      payload: {
        message: string;
      };
    };

