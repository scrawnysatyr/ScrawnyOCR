import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  FileDown,
  FileText,
  Image as ImageIcon,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { Translations } from '../i18n/translations';
import type { Language, NormalizedPage } from '../types/ocr';

interface PreviewPaneProps {
  t: Translations;
  lang: Language;
  selectedPage: NormalizedPage | null;
  pageMarkdown: string;
  hasAnyOcrResult: boolean;
  isExportingDocx: boolean;
  onChangePageMarkdown: (value: string) => void;
  onExportDocx: () => void;
  onExportMd: () => void;
  onExportTxt: () => void;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatInlineMarkdown(line: string): string {
  return escapeHtml(line)
    .replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/gi, '<u>$1</u>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="rounded bg-[#222226] px-1.5 py-0.5 text-xs">$1</code>');
}

/**
 * Safely renders Unified Intermediate Format (Markdown + HTML <table>)
 * into clean HTML for the preview pane.
 */
function renderUnifiedPreviewHtml(source: string): string {
  const tableRegex = /<table[\s\S]*?<\/table>/gi;
  const parts: string[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  const renderMarkdownChunk = (chunk: string) => {
    const lines = chunk.split(/\r?\n/);
    const htmlLines: string[] = [];
    let inUl = false;
    let inOl = false;

    const closeLists = () => {
      if (inUl) {
        htmlLines.push('</ul>');
        inUl = false;
      }
      if (inOl) {
        htmlLines.push('</ol>');
        inOl = false;
      }
    };

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) {
        closeLists();
        continue;
      }

      if (/^-{3,}$/.test(trimmed)) {
        closeLists();
        htmlLines.push('<hr class="my-4 border-[#222226]" />');
        continue;
      }

      const emblemMatch = trimmed.match(/^!\[emblem\]\((data:image\/[^)]+)\)$/i);
      if (emblemMatch) {
        closeLists();
        htmlLines.push(
          `<div class="my-2 flex justify-center"><img src="${emblemMatch[1]}" alt="Document Emblem" class="h-20 w-auto object-contain" /></div>`,
        );
        continue;
      }

      const indentMatch = trimmed.match(/^<p\s+indent="first">([\s\S]*)<\/p>$/i);
      if (indentMatch) {
        closeLists();
        htmlLines.push(
          `<p class="indent-8 text-justify">${formatInlineMarkdown(indentMatch[1])}</p>`,
        );
        continue;
      }

      const centerMatch = trimmed.match(/^<p\s+align="center">([\s\S]*)<\/p>$/i);
      if (centerMatch) {
        closeLists();
        htmlLines.push(`<p class="text-center">${formatInlineMarkdown(centerMatch[1])}</p>`);
        continue;
      }

      const rightMatch = trimmed.match(/^<p\s+align="right">([\s\S]*)<\/p>$/i);
      if (rightMatch) {
        closeLists();
        htmlLines.push(`<p class="text-right">${formatInlineMarkdown(rightMatch[1])}</p>`);
        continue;
      }

      const sigMatch = trimmed.match(/^<p\s+align="signature">([\s\S]*)<\/p>$/i);
      if (sigMatch) {
        closeLists();
        htmlLines.push(
          `<p class="ml-[40%] text-center">${formatInlineMarkdown(sigMatch[1])}</p>`,
        );
        continue;
      }

      if (trimmed.startsWith('### ')) {
        closeLists();
        htmlLines.push(`<h3>${formatInlineMarkdown(trimmed.slice(4))}</h3>`);
        continue;
      }
      if (trimmed.startsWith('## ')) {
        closeLists();
        htmlLines.push(`<h2>${formatInlineMarkdown(trimmed.slice(3))}</h2>`);
        continue;
      }
      if (trimmed.startsWith('# ')) {
        closeLists();
        htmlLines.push(`<h1>${formatInlineMarkdown(trimmed.slice(2))}</h1>`);
        continue;
      }

      const ulMatch = trimmed.match(/^[-*•]\s+(.*)$/);
      if (ulMatch) {
        if (inOl) {
          htmlLines.push('</ol>');
          inOl = false;
        }
        if (!inUl) {
          htmlLines.push('<ul>');
          inUl = true;
        }
        htmlLines.push(`<li>${formatInlineMarkdown(ulMatch[1])}</li>`);
        continue;
      }

      const olMatch = trimmed.match(/^\d+[.)]\s+(.*)$/);
      if (olMatch) {
        if (inUl) {
          htmlLines.push('</ul>');
          inUl = false;
        }
        if (!inOl) {
          htmlLines.push('<ol>');
          inOl = true;
        }
        htmlLines.push(`<li>${formatInlineMarkdown(olMatch[1])}</li>`);
        continue;
      }

      closeLists();
      htmlLines.push(`<p>${formatInlineMarkdown(trimmed)}</p>`);
    }

    closeLists();
    return htmlLines.join('\n');
  };

  while ((match = tableRegex.exec(source)) !== null) {
    if (match.index > lastIdx) {
      parts.push(renderMarkdownChunk(source.slice(lastIdx, match.index)));
    }
    // Strip inline event handlers for safety while keeping rowspan/colspan
    const safeTable = match[0].replace(/\son\w+="[^"]*"/gi, '');
    parts.push(`<div class="overflow-x-auto">${safeTable}</div>`);
    lastIdx = tableRegex.lastIndex;
  }

  if (lastIdx < source.length) {
    parts.push(renderMarkdownChunk(source.slice(lastIdx)));
  }

  return parts.join('\n');
}

export const PreviewPane: React.FC<PreviewPaneProps> = ({
  t,
  lang,
  selectedPage,
  pageMarkdown,
  hasAnyOcrResult,
  isExportingDocx,
  onChangePageMarkdown,
  onExportDocx,
  onExportTxt,
}) => {
  const [panelMode, setPanelMode] = useState<'original' | 'docx' | 'txt'>('original');
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [selectedPage?.pageNumber]);

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const clampZoom = (val: number) => Math.min(5, Math.max(0.5, Number(val.toFixed(2))));

  const renderedHtml = useMemo(
    () => (pageMarkdown.trim() ? renderUnifiedPreviewHtml(pageMarkdown) : ''),
    [pageMarkdown],
  );

  const handleCopy = async () => {
    if (!pageMarkdown.trim()) return;
    await navigator.clipboard.writeText(pageMarkdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const hasContent = pageMarkdown.trim().length > 0;

  return (
    <section className="flex h-full min-h-0 flex-col rounded-2xl border border-[#222226] bg-[#18181b]/90 p-5 shadow-lg backdrop-blur-sm">
      {/* Header & 3-Mode Switcher (Original / DOCX / TXT) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#222226] pb-3.5">
        <div>
          <h2 className="text-base font-bold text-[#ffffff]">
            {selectedPage
              ? `${lang === 'th' ? 'หน้า' : 'Page'} ${selectedPage.pageNumber}`
              : t.previewTitle}
          </h2>
          <p className="text-xs text-[#8a8a93]">
            {panelMode === 'original'
              ? lang === 'th'
                ? 'ดูภาพต้นฉบับของหน้าที่เลือก'
                : 'Original page preview'
              : panelMode === 'docx'
                ? lang === 'th'
                  ? 'ตัวอย่างหน้ากระดาษ Word (.docx)'
                  : 'Word (.docx) A4 paper preview'
                : t.editableHint}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-white/10 bg-[#27272c] p-1">
            <button
              type="button"
              onClick={() => setPanelMode('original')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
                panelMode === 'original'
                  ? 'bg-[#ff7300] text-[#050505]'
                  : 'text-[#d4d4d8] hover:text-[#ffffff]'
              }`}
            >
              <ImageIcon className="h-4 w-4" />
              {lang === 'th' ? 'ต้นฉบับ' : 'Original'}
            </button>
            <button
              type="button"
              onClick={() => setPanelMode('docx')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
                panelMode === 'docx'
                  ? 'bg-[#ff7300] text-[#050505]'
                  : 'text-[#d4d4d8] hover:text-[#ffffff]'
              }`}
            >
              <FileDown className="h-4 w-4" />
              DOCX
            </button>
            <button
              type="button"
              onClick={() => setPanelMode('txt')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
                panelMode === 'txt'
                  ? 'bg-[#ff7300] text-[#050505]'
                  : 'text-[#d4d4d8] hover:text-[#ffffff]'
              }`}
            >
              <FileText className="h-4 w-4" />
              TXT
            </button>
          </div>

          {/* Zoom Controls in Original Mode */}
          {panelMode === 'original' && selectedPage && (
            <div className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-[#27272c] p-1">
              <button
                type="button"
                onClick={() => setZoom((z) => clampZoom(z - 0.25))}
                title="Zoom Out"
                className="rounded-lg p-1.5 text-[#d4d4d8] transition-colors hover:bg-[#303036] hover:text-white cursor-pointer"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={resetView}
                title="Reset Zoom"
                className="min-w-[46px] rounded-lg px-1.5 py-1 text-center font-mono text-xs font-semibold text-[#ffffff] transition-colors hover:bg-[#303036] cursor-pointer"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => clampZoom(z + 0.25))}
                title="Zoom In"
                className="rounded-lg p-1.5 text-[#d4d4d8] transition-colors hover:bg-[#303036] hover:text-white cursor-pointer"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={resetView}
                title="Reset Pan & Zoom"
                className="rounded-lg p-1.5 text-[#d4d4d8] transition-colors hover:bg-[#303036] hover:text-[#ff7300] cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Copy in TXT Mode */}
          {panelMode === 'txt' && hasContent && (
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-[#27272c] px-3 py-1.5 text-xs font-medium text-[#d4d4d8] transition-colors hover:border-[#ff7300]/60 hover:text-[#ffffff] cursor-pointer"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? t.copied : t.copyText}
            </button>
          )}
        </div>
      </div>

      {/* Content Area */}
      <div className="mt-4 flex min-h-[260px] flex-1 flex-col overflow-hidden">
        {panelMode === 'original' ? (
          selectedPage ? (
            <div
              onWheel={(e) => {
                e.preventDefault();
                const delta = e.deltaY < 0 ? 0.15 : -0.15;
                setZoom((z) => clampZoom(z + delta));
              }}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                dragStartRef.current = {
                  x: e.clientX,
                  y: e.clientY,
                  panX: pan.x,
                  panY: pan.y,
                };
              }}
              onPointerMove={(e) => {
                if (!dragStartRef.current) return;
                const dx = e.clientX - dragStartRef.current.x;
                const dy = e.clientY - dragStartRef.current.y;
                setPan({
                  x: dragStartRef.current.panX + dx,
                  y: dragStartRef.current.panY + dy,
                });
              }}
              onPointerUp={() => {
                dragStartRef.current = null;
              }}
              onPointerCancel={() => {
                dragStartRef.current = null;
              }}
              className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-[#222226] bg-[#050505]/80 p-4 select-none touch-none cursor-grab active:cursor-grabbing"
            >
              <img
                src={selectedPage.previewUrl}
                alt={`Page ${selectedPage.pageNumber}`}
                draggable={false}
                style={{
                  transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
                }}
                className="max-h-full max-w-full rounded-lg object-contain shadow-lg transition-transform duration-75 will-change-transform pointer-events-none"
              />
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-[#222226] bg-[#050505]/50 px-6 text-center">
              <p className="max-w-md text-xs text-[#8a8a93]">
                {lang === 'th'
                  ? 'อัปโหลดไฟล์ PDF หรือรูปภาพทางซ้าย แล้วคลิกเลือกหน้าเพื่อดูต้นฉบับ'
                  : 'Upload a PDF or image on the left and click a page card to view it here.'}
              </p>
            </div>
          )
        ) : !hasContent ? (
          <div className="min-h-0 flex-1 rounded-xl border border-[#222226] bg-[#050505]/40" />
        ) : panelMode === 'docx' ? (
          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[#222226] bg-[#0c0c0f] p-4 sm:p-6">
            <div className="font-thai-preview mx-auto min-h-[960px] w-full max-w-[794px] rounded-sm bg-white px-8 py-9 text-[15px] leading-relaxed text-[#111827] shadow-2xl sm:px-14 sm:py-12 [&_hr]:my-3 [&_hr]:border-gray-500 [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table:not([data-layout])_td]:border [&_table:not([data-layout])_td]:border-gray-300 [&_table:not([data-layout])_td]:px-2.5 [&_table:not([data-layout])_td]:py-1.5 [&_table:not([data-layout])_th]:border [&_table:not([data-layout])_th]:border-gray-300 [&_table:not([data-layout])_th]:bg-gray-100 [&_table:not([data-layout])_th]:px-2.5 [&_table:not([data-layout])_th]:py-1.5 [&_table[data-layout=committee]_td:last-child]:w-[28%] [&_table[data-layout=header]_td:first-child]:text-left [&_table[data-layout=header]_td:last-child]:text-right [&_table[data-layout=header]_td:nth-child(2)]:text-center [&_table[data-layout=signature]_td]:align-top [&_table[data-layout=signature]_td]:py-2">
              {selectedPage && selectedPage.pageNumber > 1 && (
                <div className="mb-3 text-center text-sm text-gray-700">
                  -{selectedPage.pageNumber}-
                </div>
              )}
              <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />
            </div>
          </div>
        ) : (
          <textarea
            value={pageMarkdown}
            onChange={(e) => onChangePageMarkdown(e.target.value)}
            spellCheck={false}
            className="font-mono-code min-h-0 w-full flex-1 resize-none rounded-xl border border-[#222226] bg-[#050505] p-4 text-xs sm:text-sm leading-relaxed text-[#ffffff] focus:border-[#ff7300] focus:outline-none"
          />
        )}
      </div>

      {/* Mode-Specific Download Bar */}
      {panelMode !== 'original' && (
        <div className="mt-4 flex flex-col gap-3 border-t border-[#222226] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-[#d4d4d8]">
            {panelMode === 'docx' ? t.docxHint : t.editableHint}
          </p>

          <div className="flex items-center gap-2">
            {panelMode === 'docx' && (
              <button
                type="button"
                disabled={!hasAnyOcrResult || isExportingDocx}
                onClick={onExportDocx}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#ff7300] px-4 py-2.5 text-xs sm:text-sm font-bold text-[#050505] shadow-[0_0_20px_rgba(255,115,0,0.25)] transition-all hover:bg-[#ff8826] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
              >
                <FileDown className="h-4 w-4" />
                {t.exportDocx}
              </button>
            )}

            {panelMode === 'txt' && (
              <button
                type="button"
                disabled={!hasAnyOcrResult}
                onClick={onExportTxt}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#ff7300] px-4 py-2.5 text-xs sm:text-sm font-bold text-[#050505] shadow-[0_0_20px_rgba(255,115,0,0.25)] transition-all hover:bg-[#ff8826] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
              >
                <FileText className="h-4 w-4" />
                {t.exportTxt}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

