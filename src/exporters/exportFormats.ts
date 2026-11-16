import { generateDocxBlob } from './exportDocx';

function stripExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx > 0 ? fileName.slice(0, idx) : fileName;
}

export function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Exports Unified Intermediate Format as a native Word (.docx) file.
 */
export async function downloadAsDocx(
  unifiedMarkdown: string,
  originalFileName: string,
): Promise<void> {
  const blob = await generateDocxBlob(unifiedMarkdown);
  const baseName = stripExtension(originalFileName || 'document');
  triggerBrowserDownload(blob, `${baseName}.docx`);
}

/**
 * Exports raw Unified Intermediate Format as Markdown (.md).
 */
export function downloadAsMarkdown(
  unifiedMarkdown: string,
  originalFileName: string,
): void {
  const blob = new Blob([unifiedMarkdown], {
    type: 'text/markdown;charset=utf-8',
  });
  const baseName = stripExtension(originalFileName || 'document');
  triggerBrowserDownload(blob, `${baseName}.md`);
}

/**
 * Converts HTML tables to readable tab-delimited rows, strips Markdown/HTML
 * markup, and preserves paragraph breaks for Plain Text (.txt) export.
 */
export function convertUnifiedToPlainText(unifiedMarkdown: string): string {
  let output = unifiedMarkdown;

  // Convert HTML <table> blocks to tab-separated plain text rows
  output = output.replace(/<table[\s\S]*?<\/table>/gi, (tableHtml) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(tableHtml, 'text/html');
    const rows = Array.from(doc.querySelectorAll('tr'));
    const lines = rows.map((tr) => {
      const cells = Array.from(tr.querySelectorAll('th, td')).map((cell) =>
        (cell.textContent || '').replace(/\s+/g, ' ').trim(),
      );
      return cells.join('\t');
    });
    return `\n${lines.join('\n')}\n`;
  });

  // Strip remaining HTML tags
  output = output.replace(/<[^>]+>/g, '');

  // Strip Markdown heading markers, bold/italic/code, links
  output = output
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*]\s+/gm, '• ')
    .replace(/^-{3,}$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return output;
}

/**
 * Exports cleaned Plain Text (.txt).
 */
export function downloadAsText(
  unifiedMarkdown: string,
  originalFileName: string,
): void {
  const plainText = convertUnifiedToPlainText(unifiedMarkdown);
  const blob = new Blob([plainText], {
    type: 'text/plain;charset=utf-8',
  });
  const baseName = stripExtension(originalFileName || 'document');
  triggerBrowserDownload(blob, `${baseName}.txt`);
}

