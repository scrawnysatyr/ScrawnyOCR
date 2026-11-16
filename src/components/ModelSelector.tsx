import React, { useRef } from 'react';
import {
  CheckCircle2,
  Cpu,
  Download,
  FolderOpen,
  HardDrive,
  Sparkles,
  Trash2,
  Zap,
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
  persistentGranted,
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
  const models: ModelDefinition[] = [MODEL_REGISTRY.fast, MODEL_REGISTRY.accurate];
  const localInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  return (
    <section className="rounded-2xl border border-[#2c2c36] bg-[#1c1c22]/90 p-5 shadow-lg backdrop-blur-sm">
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-[#f4f4f5]">
          <Cpu className="h-4 w-4 text-[#ff7300]" />
          {t.modelSectionTitle}
        </h2>

        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
            webGpuSupported
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : 'border-[#2c2c36] bg-[#141418] text-[#a1a1aa]'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              webGpuSupported ? 'bg-emerald-400' : 'bg-[#71717a]'
            }`}
          />
          {webGpuSupported ? t.webgpuSupported : t.webgpuUnsupported}
        </span>
      </div>

      {/* Mode Cards */}
      <div className="grid gap-3 md:grid-cols-2">
        {models.map((model) => {
          const isSelected = selectedMode === model.mode;
          const cacheInfo = cacheStatuses[model.id];
          const isCached = cacheInfo?.isCached ?? false;
          const isDownloading = downloadingModelId === model.id;
          const isWebGpuBlocked = model.backend === 'webgpu' && !webGpuSupported;

          return (
            <div
              key={model.id}
              onClick={() => !disabled && onSelectMode(model.mode)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
                  onSelectMode(model.mode);
                }
              }}
              className={`flex flex-col justify-between rounded-xl border p-4 text-left transition-all ${
                isSelected
                  ? 'border-[#ff7300] bg-[#ff7300]/10 shadow-[0_0_20px_rgba(255,115,0,0.12)]'
                  : 'border-[#2c2c36] bg-[#141418]/75 hover:border-[#ff7300]/50 hover:bg-[#22222a]/70'
              } ${disabled ? 'pointer-events-none opacity-65' : 'cursor-pointer'}`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                        isSelected
                          ? 'bg-[#ff7300] text-[#141418]'
                          : 'bg-[#1c1c22] text-[#ff7300]'
                      }`}
                    >
                      {model.mode === 'fast' ? (
                        <Zap className="h-4 w-4" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-[#f4f4f5]">
                        {lang === 'th' ? model.nameTh : model.name}
                      </h3>
                      <p className="text-[11px] font-medium text-[#ff9440]">
                        {lang === 'th' ? model.badgeTh : model.badge}
                      </p>
                    </div>
                  </div>

                  <span className="font-mono-code rounded-md border border-[#2c2c36] bg-[#1c1c22] px-2 py-0.5 text-[11px] text-[#a1a1aa]">
                    ~{model.estimatedSizeMB} MB
                  </span>
                </div>

                <p className="mt-2.5 text-xs leading-relaxed text-[#a1a1aa]">
                  {lang === 'th' ? model.descriptionTh : model.description}
                </p>

                {isWebGpuBlocked && (
                  <p className="mt-2 text-[11px] font-medium text-amber-400">
                    ⚠ {t.webgpuUnsupported}
                  </p>
                )}
              </div>

              {/* Per-Model Cache Status & Actions */}
              <div
                className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#2c2c36]/80 pt-3"
                onClick={(e) => e.stopPropagation()}
              >
                {isCached ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {t.cachedBadge} ({formatBytes(cacheInfo.cachedBytes)})
                  </span>
                ) : (
                  <span className="text-[11px] text-[#71717a]">{t.notCachedBadge}</span>
                )}

                <div className="flex items-center gap-1.5">
                  <input
                    ref={(el) => {
                      localInputRefs.current[model.id] = el;
                    }}
                    type="file"
                    multiple
                    accept=".onnx,.txt,.json"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        onImportLocalModel(model, e.target.files);
                      }
                      e.target.value = '';
                    }}
                  />

                  {!isCached && (
                    <>
                      <button
                        type="button"
                        disabled={disabled || isDownloading}
                        onClick={() => localInputRefs.current[model.id]?.click()}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#2c2c36] bg-[#1c1c22] px-2.5 py-1 text-[11px] font-medium text-[#a1a1aa] transition-colors hover:border-[#ff7300]/60 hover:text-[#f4f4f5] disabled:opacity-50"
                      >
                        <FolderOpen className="h-3 w-3" />
                        {lang === 'th' ? 'นำเข้าจากเครื่อง' : 'Import Local'}
                      </button>

                      <button
                        type="button"
                        disabled={disabled || isDownloading}
                        onClick={() => onDownloadModel(model)}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#ff7300]/50 bg-[#ff7300]/15 px-2.5 py-1 text-[11px] font-semibold text-[#ff9440] transition-colors hover:bg-[#ff7300] hover:text-[#141418] disabled:opacity-50"
                      >
                        <Download className="h-3 w-3" />
                        {isDownloading
                          ? `${t.downloading} ${downloadPercent}%`
                          : t.downloadAndCache}
                      </button>
                    </>
                  )}

                  {isCached && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onDeleteModelCache(model)}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#2c2c36] bg-[#1c1c22] px-2.5 py-1 text-[11px] font-medium text-[#a1a1aa] transition-colors hover:border-red-500/60 hover:text-red-400 disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" />
                      {t.deleteModelCache}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Persistent Cache Summary Bar */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#2c2c36] bg-[#141418]/75 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-3 text-xs text-[#a1a1aa]">
          <span className="inline-flex items-center gap-1.5 font-medium text-[#f4f4f5]">
            <HardDrive className="h-3.5 w-3.5 text-[#ff7300]" />
            {t.cacheSectionTitle}:
          </span>
          <span>
            {t.cacheTotalUsed}:{' '}
            <strong className="font-mono-code text-[#ff7300]">
              {formatBytes(totalCacheBytes)}
            </strong>
          </span>
          <span className="rounded-md border border-[#2c2c36] bg-[#1c1c22] px-2 py-0.5 text-[11px]">
            {persistentGranted ? t.cachePersistentOn : t.cachePersistentOff}
          </span>
        </div>

        <button
          type="button"
          disabled={disabled || totalCacheBytes === 0}
          onClick={onClearAllCache}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#2c2c36] bg-[#1c1c22] px-3 py-1.5 text-xs font-medium text-[#a1a1aa] transition-colors hover:border-red-500/60 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t.deleteAllCache}
        </button>
      </div>
    </section>
  );
};

