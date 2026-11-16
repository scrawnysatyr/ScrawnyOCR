import React, { useMemo, useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  Eye,
  FileCode,
  FileDown,
  FileText,
  Sparkles,
} from 'lucide-react';
import type { Translations } from '../i18n/translations';
import type { Language } from '../types/ocr';

interface PreviewPaneProps {
  t: Translations;
  lang: Language;
  markdown: string;
  isExportingDocx: boolean;
  onChangeMarkdown: (value: string) => void;
  onExportDocx: () => void;
  onExportMd: () => void;
  onExportTxt: () => void;
  onLoadSample?: () => void;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatInlineMarkdown(line: string): string {
  return escapeHtml(line)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="rounded bg-[#2c2c36] px-1.5 py-0.5 text-xs">$1</code>');
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
        htmlLines.push('<hr class="my-4 border-[#2c2c36]" />');
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
  markdown,
  isExportingDocx,
  onChangeMarkdown,
  onExportDocx,
  onExportMd,
  onExportTxt,
  onLoadSample,
}) => {
  const [activeTab, setActiveTab] = useState<'rendered' | 'source'>('rendered');
  const [copied, setCopied] = useState(false);

  const renderedHtml = useMemo(
    () => (markdown.trim() ? renderUnifiedPreviewHtml(markdown) : ''),
    [markdown],
  );

  const handleCopy = async () => {
    if (!markdown.trim()) return;
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const hasContent = markdown.trim().length > 0;

  return (
    <section className="flex h-full min-h-0 flex-col rounded-2xl border border-[#2c2c36] bg-[#1c1c22]/90 p-5 shadow-lg backdrop-blur-sm">
      {/* Header & Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#2c2c36] pb-3.5">
        <div>
          <h2 className="text-sm font-bold text-[#f4f4f5]">{t.previewTitle}</h2>
          <p className="text-[11px] text-[#71717a]">{t.editableHint}</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-[#2c2c36] bg-[#141418] p-0.5">
            <button
              type="button"
              onClick={() => setActiveTab('rendered')}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                activeTab === 'rendered'
                  ? 'bg-[#ff7300] text-[#141418]'
                  : 'text-[#a1a1aa] hover:text-[#f4f4f5]'
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
              {t.tabRendered}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('source')}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                activeTab === 'source'
                  ? 'bg-[#ff7300] text-[#141418]'
                  : 'text-[#a1a1aa] hover:text-[#f4f4f5]'
              }`}
            >
              <Code2 className="h-3.5 w-3.5" />
              {t.tabMarkdown}
            </button>
          </div>

          <button
            type="button"
            disabled={!hasContent}
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#2c2c36] bg-[#141418] px-2.5 py-1.5 text-xs font-medium text-[#a1a1aa] transition-colors hover:border-[#ff7300]/60 hover:text-[#f4f4f5] disabled:opacity-40"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? t.copied : t.copyText}
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="mt-4 flex min-h-[260px] flex-1 flex-col">
        {!hasContent ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-[#2c2c36] bg-[#141418]/50 px-6 text-center">
            <p className="max-w-md text-xs text-[#71717a]">{t.emptyPreview}</p>
            {onLoadSample && (
              <button
                type="button"
                onClick={onLoadSample}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-[#ff7300]/40 bg-[#ff7300]/10 px-3 py-1.5 text-xs font-medium text-[#ff9440] transition-colors hover:bg-[#ff7300] hover:text-[#141418]"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {lang === 'th'
                  ? 'โหลดตัวอย่างเอกสารไทย + ตาราง (ทดสอบ Export)'
                  : 'Load Sample Thai + Table Doc (Test Export)'}
              </button>
            )}
          </div>
        ) : activeTab === 'rendered' ? (
          <div
            className="ocr-preview-prose font-thai-preview min-h-0 flex-1 overflow-y-auto rounded-xl border border-[#2c2c36] bg-[#141418]/80 p-5 text-[15px]"
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        ) : (
          <textarea
            value={markdown}
            onChange={(e) => onChangeMarkdown(e.target.value)}
            spellCheck={false}
            className="font-mono-code min-h-0 w-full flex-1 resize-none rounded-xl border border-[#2c2c36] bg-[#141418] p-4 text-xs leading-relaxed text-[#f4f4f5] focus:border-[#ff7300] focus:outline-none"
          />
        )}
      </div>

      {/* Export Bar */}
      <div className="mt-4 flex flex-col gap-3 border-t border-[#2c2c36] pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] text-[#a1a1aa]">{t.docxHint}</p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!hasContent || isExportingDocx}
            onClick={onExportDocx}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#ff7300] px-4 py-2 text-xs font-bold text-[#141418] shadow-[0_0_20px_rgba(255,115,0,0.25)] transition-all hover:bg-[#ff8826] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <FileDown className="h-4 w-4" />
            {t.exportDocx}
          </button>

          <button
            type="button"
            disabled={!hasContent}
            onClick={onExportMd}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#2c2c36] bg-[#141418] px-3.5 py-2 text-xs font-semibold text-[#f4f4f5] transition-colors hover:border-[#ff7300] hover:text-[#ff9440] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <FileCode className="h-4 w-4" />
            {t.exportMd}
          </button>

          <button
            type="button"
            disabled={!hasContent}
            onClick={onExportTxt}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#2c2c36] bg-[#141418] px-3.5 py-2 text-xs font-semibold text-[#f4f4f5] transition-colors hover:border-[#ff7300] hover:text-[#ff9440] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <FileText className="h-4 w-4" />
            {t.exportTxt}
          </button>
        </div>
      </div>
    </section>
  );
};

