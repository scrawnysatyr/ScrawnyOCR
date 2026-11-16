import React from 'react';
import { Loader2, XCircle } from 'lucide-react';
import type { Translations } from '../i18n/translations';
import type { OcrProgressEvent } from '../types/ocr';

interface ProgressPanelProps {
  t: Translations;
  progress: OcrProgressEvent;
  isProcessing: boolean;
  onCancel: () => void;
}

export const ProgressPanel: React.FC<ProgressPanelProps> = ({
  t,
  progress,
  isProcessing,
  onCancel,
}) => {
  if (progress.stage === 'idle') return null;

  const clampedPct = Math.min(100, Math.max(0, Math.round(progress.percent)));

  const getLocalizedMessage = (): string => {
    switch (progress.stage) {
      case 'normalizing':
        return t.progressNormalizing;
      case 'downloading':
        return progress.message || t.progressDownloading;
      case 'initializing':
        return progress.message || t.progressInitializing;
      case 'inferring':
        if (progress.currentPage && progress.totalPages) {
          return t.progressInferring(progress.currentPage, progress.totalPages);
        }
        return progress.message;
      case 'done':
        return t.progressDone;
      case 'error':
        return `${t.errorPrefix}: ${progress.message}`;
      default:
        return progress.message;
    }
  };

  const isError = progress.stage === 'error';
  const isDone = progress.stage === 'done';

  return (
    <div
      className={`rounded-2xl border p-4 transition-all ${
        isError
          ? 'border-red-500/40 bg-red-500/10'
          : isDone
            ? 'border-emerald-500/40 bg-emerald-500/10'
            : 'border-[#ff7300]/40 bg-[#1c1c22]/90'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {isProcessing && (
            <Loader2 className="h-4 w-4 animate-spin text-[#ff7300]" />
          )}
          <span
            className={`text-sm font-medium ${
              isError
                ? 'text-red-300'
                : isDone
                  ? 'text-emerald-300'
                  : 'text-[#f4f4f5]'
            }`}
          >
            {getLocalizedMessage()}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="font-mono-code text-xs font-semibold text-[#ff7300]">
            {clampedPct}%
          </span>

          {isProcessing && (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1 rounded-lg border border-[#2c2c36] bg-[#141418] px-2.5 py-1 text-xs font-medium text-[#a1a1aa] transition-colors hover:border-red-500/60 hover:text-red-400"
            >
              <XCircle className="h-3.5 w-3.5" />
              {t.cancelOcr}
            </button>
          )}
        </div>
      </div>

      <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-[#141418]">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            isError
              ? 'bg-red-500'
              : isDone
                ? 'bg-emerald-500'
                : 'bg-gradient-to-r from-[#ff7300] to-[#ff9e4f]'
          }`}
          style={{ width: `${clampedPct}%` }}
        />
      </div>
    </div>
  );
};

