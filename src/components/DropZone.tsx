import React, { useRef, useState } from 'react';
import {
  FileText,
  Image as ImageIcon,
  SlidersHorizontal,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import type { Translations } from '../i18n/translations';
import type { NormalizedDocument } from '../types/ocr';
import { formatBytes } from '../utils/modelCache';

interface DropZoneProps {
  t: Translations;
  selectedFile: File | null;
  normalizedDoc: NormalizedDocument | null;
  pdfScale: number;
  disabled: boolean;
  onPdfScaleChange: (scale: number) => void;
  onFileSelected: (file: File) => void;
  onClearFile: () => void;
}

export const DropZone: React.FC<DropZoneProps> = ({
  t,
  selectedFile,
  normalizedDoc,
  pdfScale,
  disabled,
  onPdfScaleChange,
  onFileSelected,
  onClearFile,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) onFileSelected(file);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileSelected(file);
    e.target.value = '';
  };

  return (
    <section className="rounded-2xl border border-[#222226] bg-[#0c0c0d]/90 p-3.5 shadow-lg backdrop-blur-sm">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleInputChange}
        disabled={disabled}
      />

      {!selectedFile ? (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !disabled && inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
              inputRef.current?.click();
            }
          }}
          className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-4 text-center transition-all ${
            isDragging
              ? 'border-[#ff7300] bg-[#ff7300]/10 shadow-[0_0_24px_rgba(255,115,0,0.2)]'
              : 'border-[#222226] bg-[#050505]/70 hover:border-[#ff7300]/70 hover:bg-[#141416]/70'
          } ${disabled ? 'pointer-events-none opacity-60' : ''}`}
        >
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl border border-[#222226] bg-[#0c0c0d] text-[#ff7300] transition-transform group-hover:scale-105">
            <UploadCloud className="h-5 w-5" />
          </div>

          <p className="text-sm font-semibold text-[#ffffff]">{t.dropzoneTitle}</p>
          <p className="mt-0.5 max-w-md text-[11px] text-[#d4d4d8]">{t.dropzoneSubtitle}</p>

          <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2">
            <span className="rounded-lg border border-[#222226] bg-[#0c0c0d] px-2.5 py-0.5 text-[11px] font-medium text-[#d4d4d8]">
              {t.dropzoneFormats}
            </span>
            <span className="rounded-lg bg-[#ff7300] px-3 py-0.5 text-[11px] font-semibold text-[#050505] transition-colors group-hover:bg-[#ff8826]">
              {t.browseFiles}
            </span>
          </div>
        </div>
      ) : (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`rounded-xl border p-2.5 transition-all ${
            isDragging
              ? 'border-[#ff7300] bg-[#ff7300]/10'
              : 'border-[#222226] bg-[#050505]/80'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div
              onClick={() => !disabled && inputRef.current?.click()}
              className="flex min-w-0 cursor-pointer items-center gap-2.5"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#ff7300]/15 text-[#ff7300]">
                {selectedFile.type === 'application/pdf' ||
                selectedFile.name.toLowerCase().endsWith('.pdf') ? (
                  <FileText className="h-4 w-4" />
                ) : (
                  <ImageIcon className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-[#ffffff]">
                  {selectedFile.name}
                </p>
                <p className="text-[11px] text-[#d4d4d8]">
                  {formatBytes(selectedFile.size)}
                  {normalizedDoc
                    ? ` • ${t.pagesCount(normalizedDoc.pages.length)}`
                    : ''}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClearFile}
              disabled={disabled}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#222226] bg-[#0c0c0d] px-2 py-1 text-[11px] font-medium text-[#d4d4d8] transition-colors hover:border-red-500/60 hover:text-red-400 disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" />
              {t.clearFile}
            </button>
          </div>

          {normalizedDoc && normalizedDoc.pages.length > 0 && (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-0.5">
              {normalizedDoc.pages.map((page) => (
                <div
                  key={page.pageNumber}
                  className="w-14 shrink-0 overflow-hidden rounded-md border border-[#222226] bg-[#0c0c0d]"
                >
                  {page.previewUrl ? (
                    <img
                      src={page.previewUrl}
                      alt={t.pageLabel(page.pageNumber)}
                      className="h-16 w-full object-cover object-top"
                    />
                  ) : (
                    <div className="flex h-16 items-center justify-center text-[10px] text-[#8a8a93]">
                      {page.width}×{page.height}
                    </div>
                  )}
                  <div className="border-t border-[#222226] px-1 py-0.5 text-center text-[9px] font-medium text-[#d4d4d8]">
                    {t.pageLabel(page.pageNumber)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* PDF Scale Control */}
      <div className="mt-2.5 flex items-center justify-between gap-3 rounded-xl border border-[#222226] bg-[#050505]/70 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-[#ff7300]" />
          <span className="text-[11px] font-semibold text-[#ffffff]">
            {t.pdfScaleLabel}:{' '}
            <span className="font-mono-code text-[#ff7300]">{pdfScale.toFixed(2)}x</span>
          </span>
        </div>
        <input
          type="range"
          min={2.5}
          max={3.0}
          step={0.25}
          value={pdfScale}
          disabled={disabled}
          onChange={(e) => onPdfScaleChange(parseFloat(e.target.value))}
          className="h-1.5 w-32 cursor-pointer appearance-none rounded-lg bg-[#222226] accent-[#ff7300] sm:w-36"
        />
      </div>
    </section>
  );
};

