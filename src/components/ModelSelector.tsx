import React, { useRef } from 'react';
import {
  CheckCircle2,
  Cpu,
  Download,
  FolderOpen,
  HardDrive,
  Trash2,
} from 'lucide-react';
import type { Translations } from '../i18n/translations';
import { MODEL_REGISTRY } from '../ai/modelRegistry';
import type {
  CachedModelInfo,
  Language,
  ModelDefinition,
  ModelMode,
} from '../types/ocr';
import { formatBytes } from '../utils/modelCache';

interface ModelSelectorProps {
  t: Translations;
  lang: Language;
  selectedMode: ModelMode;
  webGpuSupported: boolean;
  persistentGranted: boolean;
  totalCacheBytes: number;
  cacheStatuses: Record<string, CachedModelInfo>;
  downloadingModelId: string | null;
  downloadPercent: number;
  disabled: boolean;
  onSelectMode: (mode: ModelMode) => void;
  onDownloadModel: (model: ModelDefinition) => void;
  onImportLocalModel: (model: ModelDefinition, files: FileList) => void;
  onDeleteModelCache: (model: ModelDefinition) => void;
  onClearAllCache: () => void;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  t,
  lang,
  selectedMode,
  webGpuSupported,
  persistentGranted: _persistentGranted,
  totalCacheBytes,
  cacheStatuses,
  downloadingModelId,
  downloadPercent,
  disabled,
  onSelectMode,
  onDownloadModel,
  onImportLocalModel,
  onDeleteModelCache,
  onClearAllCache,
}) => {
  const models: ModelDefinition[] = [
    MODEL_REGISTRY.fast,
    MODEL_REGISTRY.hybrid,
    MODEL_REGISTRY.accurate,
  ];
  const activeModel =
    models.find((m) => m.mode === selectedMode) ?? models[0];
  const cacheInfo = cacheStatuses[activeModel.id];
  const isCached = cacheInfo?.isCached ?? false;
  const isDownloading = downloadingModelId === activeModel.id;
  const isWebGpuBlocked = activeModel.backend === 'webgpu' && !webGpuSupported;
  const localInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <section className="rounded-xl border border-[#222226] bg-[#18181b]/90 px-3 py-2 shadow-lg backdrop-blur-sm space-y-1.5">
      {/* Row 1: Compact Model Select + WebGPU Status */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-1 min-w-0 items-center gap-2">
          <Cpu className="h-4 w-4 shrink-0 text-[#ff7300]" />
          <select
            value={selectedMode}
            disabled={disabled}
            aria-label={t.modelSectionTitle}
            onChange={(e) => onSelectMode(e.target.value as ModelMode)}
            className="min-w-0 flex-1 rounded-[10px] border border-[#222226] bg-[#0c0c0d] px-2.5 py-1.5 text-xs font-semibold text-white outline-none transition-colors focus:border-[#ff7300] disabled:opacity-60 cursor-pointer"
          >
            {models.map((m) => (
              <option key={m.id} value={m.mode}>
                {lang === 'th' ? m.nameTh : m.name} (~{m.estimatedSizeMB} MB)
              </option>
            ))}
          </select>
        </div>

        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-[8px] border px-2 py-1 text-[10px] font-medium ${
            webGpuSupported
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : 'border-[#222226] bg-[#0c0c0d] text-[#d4d4d8]'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              webGpuSupported ? 'bg-emerald-400' : 'bg-[#8a8a93]'
            }`}
          />
          {webGpuSupported ? t.webgpuSupported : t.webgpuUnsupported}
        </span>
      </div>

      {/* Row 2: Active Model Cache Status & Inline Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {isCached ? (
            <span className="inline-flex items-center gap-1 font-medium text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              {t.cachedBadge} ({formatBytes(cacheInfo.cachedBytes)})
            </span>
          ) : (
            <span className="text-[#8a8a93]">{t.notCachedBadge}</span>
          )}
          {isWebGpuBlocked && (
            <span className="text-[10px] font-medium text-amber-400">
              ⚠ {t.webgpuUnsupported}
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-[#8a8a93]">
            <HardDrive className="h-3 w-3 text-[#ff7300]" />
            <span className="font-mono-code text-[#d4d4d8]">{formatBytes(totalCacheBytes)}</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <input
            ref={localInputRef}
            type="file"
            multiple
            accept=".onnx,.txt,.json,.zip"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onImportLocalModel(activeModel, e.target.files);
              }
              e.target.value = '';
            }}
          />

          {!isCached ? (
            <>
              <button
                type="button"
                disabled={disabled || isDownloading}
                onClick={() => localInputRef.current?.click()}
                className="inline-flex items-center gap-1 rounded-[8px] border border-[#222226] bg-[#27272c] px-2 py-1 text-[11px] font-medium text-[#d4d4d8] transition-colors hover:border-[#ff7300] hover:text-[#ffffff] disabled:opacity-50 cursor-pointer"
              >
                <FolderOpen className="h-3 w-3" />
                {lang === 'th' ? 'นำเข้า' : 'Import'}
              </button>

              {activeModel.onnxReady !== false && (
                <button
                  type="button"
                  disabled={disabled || isDownloading}
                  onClick={() => onDownloadModel(activeModel)}
                  className="inline-flex items-center gap-1 rounded-[8px] border border-[#ff7300]/50 bg-[#ff7300]/15 px-2 py-1 text-[11px] font-semibold text-[#ff9440] transition-colors hover:bg-[#ff7300] hover:text-[#050505] disabled:opacity-50 cursor-pointer"
                >
                  <Download className="h-3 w-3" />
                  {isDownloading
                    ? `${t.downloading} ${downloadPercent}%`
                    : t.downloadAndCache}
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onDeleteModelCache(activeModel)}
              className="inline-flex items-center gap-1 rounded-[8px] border border-[#222226] bg-[#27272c] px-2 py-1 text-[11px] font-medium text-[#d4d4d8] transition-colors hover:border-red-500/60 hover:text-red-400 disabled:opacity-50 cursor-pointer"
            >
              <Trash2 className="h-3 w-3" />
              {t.deleteModelCache}
            </button>
          )}

          {totalCacheBytes > 0 && (
            <button
              type="button"
              disabled={disabled}
              onClick={onClearAllCache}
              title={t.deleteAllCache}
              className="inline-flex items-center gap-1 rounded-[8px] border border-[#222226] bg-[#27272c] px-2 py-1 text-[11px] font-medium text-[#d4d4d8] transition-colors hover:border-red-500/60 hover:text-red-400 disabled:opacity-50 cursor-pointer"
            >
              <Trash2 className="h-3 w-3" />
              {t.deleteAllCache}
            </button>
          )}
        </div>
      </div>
    </section>
  );
};
