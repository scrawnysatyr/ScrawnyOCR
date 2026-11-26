import {
  AlignmentType,
  BorderStyle,
  Document,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlign,
  VerticalMergeType,
  WidthType,
  type IParagraphOptions,
  type IRunOptions,
} from 'docx';

const THAI_FONT_FAMILY = 'TH Sarabun New';

const THAI_FONT_SPEC = {
  name: THAI_FONT_FAMILY,
  ascii: THAI_FONT_FAMILY,
  hAnsi: THAI_FONT_FAMILY,
  cs: THAI_FONT_FAMILY,
  eastAsia: THAI_FONT_FAMILY,
} as const;

const BODY_FONT_SIZE_HALF_PT = 32; // 16pt (standard Thai Sarabun body size)
const TABLE_FONT_SIZE_HALF_PT = 28; // 14pt inside tables for clean fit

const THAI_LINE_SPACING = {
  line: 264, // 1.1x line height for crisp Thai official documents
  lineRule: LineRuleType.AUTO,
  after: 40,
} as const;

/**
 * Parses inline Markdown (**bold**, *italic*, `code`) into native docx TextRuns
 * configured with TH Sarabun New across Complex Script (cs) & Latin ranges.
 */
function parseInlineRuns(
  text: string,
  baseOptions: Partial<IRunOptions> = {},
): TextRun[] {
  const runs: TextRun[] = [];
  const tokenRegex = /(<u>[\s\S]*?<\/u>|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(
        new TextRun({
          text: text.slice(lastIndex, match.index),
          font: THAI_FONT_SPEC,
          size: BODY_FONT_SIZE_HALF_PT,
          ...baseOptions,
        }),
      );
    }

    const token = match[0];
    if (/^<u>[\s\S]*<\/u>$/i.test(token)) {
      const inner = token.replace(/^<u>|<\/u>$/gi, '');
      runs.push(
        new TextRun({
          text: inner,
          font: THAI_FONT_SPEC,
          size: BODY_FONT_SIZE_HALF_PT,
          underline: { type: UnderlineType.SINGLE },
          ...baseOptions,
        }),
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      runs.push(
        new TextRun({
          text: token.slice(2, -2),
          font: THAI_FONT_SPEC,
          size: BODY_FONT_SIZE_HALF_PT,
          bold: true,
          ...baseOptions,
        }),
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      runs.push(
        new TextRun({
          text: token.slice(1, -1),
          font: THAI_FONT_SPEC,
          size: BODY_FONT_SIZE_HALF_PT,
          italics: true,
          ...baseOptions,
        }),
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      runs.push(
        new TextRun({
          text: token.slice(1, -1),
          font: THAI_FONT_SPEC,
          size: BODY_FONT_SIZE_HALF_PT,
          ...baseOptions,
        }),
      );
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    runs.push(
      new TextRun({
        text: text.slice(lastIndex),
        font: THAI_FONT_SPEC,
        size: BODY_FONT_SIZE_HALF_PT,
        ...baseOptions,
      }),
    );
  }

  if (runs.length === 0) {
    runs.push(
      new TextRun({
        text: '',
        font: THAI_FONT_SPEC,
        size: BODY_FONT_SIZE_HALF_PT,
        ...baseOptions,
      }),
    );
  }

  return runs;
}

interface GridCellEntry {
  text: string;
  isHeader: boolean;
  colSpan: number;
  verticalMerge?: (typeof VerticalMergeType)[keyof typeof VerticalMergeType];
}

/**
 * Converts an HTML <table> string (including rowspan and colspan) into a native
 * docx Table with percentage widths and generous cell margins for Thai text.
 */
function htmlTableToDocxTable(htmlTable: string): Table | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlTable, 'text/html');
  const tableEl = doc.querySelector('table');
  if (!tableEl) return null;

  const layoutType = tableEl.getAttribute('data-layout');
  const isBorderlessLayout =
    layoutType === 'header' || layoutType === 'signature' || layoutType === 'committee';

  const trElements = Array.from(tableEl.querySelectorAll('tr'));
  if (trElements.length === 0) return null;

  // Build 2D occupancy grid to resolve rowspan + colspan accurately
  const grid: Array<Array<GridCellEntry | null>> = [];
  let maxCols = 0;

  trElements.forEach((tr, rowIdx) => {
    if (!grid[rowIdx]) grid[rowIdx] = [];
    const cellElements = Array.from(tr.children).filter(
      (el) => el.tagName === 'TD' || el.tagName === 'TH',
    );

    let colIdx = 0;
    for (const cellEl of cellElements) {
      while (grid[rowIdx][colIdx] !== undefined) {
        colIdx++;
      }

      const rowSpan = Math.max(1, parseInt(cellEl.getAttribute('rowspan') || '1', 10) || 1);
      const colSpan = Math.max(1, parseInt(cellEl.getAttribute('colspan') || '1', 10) || 1);
      const isHeader =
        !isBorderlessLayout && (cellEl.tagName === 'TH' || cellEl.closest('thead') !== null);
      const rawHtml = cellEl.innerHTML.replace(/<br\s*\/?>/gi, '\n');
      const tmp = doc.createElement('div');
      tmp.innerHTML = rawHtml;
      const cellText = (tmp.textContent || '')
        .split('\n')
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .join('\n')
        .trim();

      for (let r = 0; r < rowSpan; r++) {
        const targetRow = rowIdx + r;
        if (!grid[targetRow]) grid[targetRow] = [];

        if (r === 0) {
          grid[targetRow][colIdx] = {
            text: cellText,
            isHeader,
            colSpan,
            verticalMerge: rowSpan > 1 ? VerticalMergeType.RESTART : undefined,
          };
        } else {
          grid[targetRow][colIdx] = {
            text: '',
            isHeader: false,
            colSpan,
            verticalMerge: VerticalMergeType.CONTINUE,
          };
        }

        // Mark horizontal span slots as occupied (null = covered by colSpan)
        for (let c = 1; c < colSpan; c++) {
          grid[targetRow][colIdx + c] = null;
        }
      }

      colIdx += colSpan;
      maxCols = Math.max(maxCols, colIdx);
    }
  });

  if (maxCols === 0) return null;

  const colWidthPct = 100 / maxCols;
  const tableRows: TableRow[] = [];

  for (let r = 0; r < grid.length; r++) {
    const rowCells = grid[r] || [];
    const docxCells: TableCell[] = [];
    let rowIsHeader = false;

    for (let c = 0; c < maxCols; c++) {
      const entry = rowCells[c];
      if (entry === null) {
        // Covered by a preceding cell's colspan
        continue;
      }

      const cellData: GridCellEntry = entry ?? {
        text: '',
        isHeader: false,
        colSpan: 1,
      };

      if (cellData.isHeader) rowIsHeader = true;

      const cellWidthPct =
        layoutType === 'committee' && maxCols === 2
          ? c === 0
            ? 72
            : 28
          : Math.round(colWidthPct * cellData.colSpan * 100) / 100;

      const cellLines = cellData.text ? cellData.text.split('\n') : [''];
      const cellAlignment =
        layoutType === 'header'
          ? c === 0
            ? AlignmentType.LEFT
            : c === maxCols - 1
              ? AlignmentType.RIGHT
              : AlignmentType.CENTER
          : cellData.isHeader
            ? AlignmentType.CENTER
            : AlignmentType.LEFT;

      docxCells.push(
        new TableCell({
          columnSpan: cellData.colSpan > 1 ? cellData.colSpan : undefined,
          verticalMerge: cellData.verticalMerge,
          verticalAlign: layoutType === 'signature' ? VerticalAlign.TOP : VerticalAlign.CENTER,
          width: {
            size: cellWidthPct,
            type: WidthType.PERCENTAGE,
          },
          margins: isBorderlessLayout
            ? { top: 80, bottom: 120, left: 100, right: 100 }
            : { top: 100, bottom: 100, left: 140, right: 140 },
          shading: cellData.isHeader
            ? {
                type: ShadingType.CLEAR,
                color: 'auto',
                fill: 'F3F4F6',
              }
            : undefined,
          children: cellLines.map(
            (lineText) =>
              new Paragraph({
                spacing: {
                  line: 288,
                  lineRule: LineRuleType.AUTO,
                  before: layoutType === 'signature' && lineText.includes('____') ? 320 : 20,
                  after: 20,
                },
                alignment: cellAlignment,
                children: parseInlineRuns(lineText, {
                  size: TABLE_FONT_SIZE_HALF_PT,
                  bold: cellData.isHeader,
                }),
              }),
          ),
        }),
      );
    }

    if (docxCells.length > 0) {
      tableRows.push(
        new TableRow({
          cantSplit: true,
          tableHeader: rowIsHeader,
          children: docxCells,
        }),
      );
    }
  }

  return new Table({
    width: {
      size: 100,
      type: WidthType.PERCENTAGE,
    },
    borders: isBorderlessLayout
      ? {
          top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
          bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
          left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
          right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
          insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
          insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        }
      : {
          top: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB' },
          bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB' },
          left: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB' },
          right: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB' },
          insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
          insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
        },
    rows: tableRows,
  });
}

type Segment =
  | { type: 'table'; content: string }
  | { type: 'markdown'; content: string };

/**
 * Splits Unified Intermediate Format (Markdown + HTML <table>) into ordered
 * segments so tables and prose are converted in exact reading order.
 */
function splitMarkdownAndTables(input: string): Segment[] {
  const segments: Segment[] = [];
  const tableRegex = /<table[\s\S]*?<\/table>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tableRegex.exec(input)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: 'markdown',
        content: input.slice(lastIndex, match.index),
      });
    }
    segments.push({
      type: 'table',
      content: match[0],
    });
    lastIndex = tableRegex.lastIndex;
  }

  if (lastIndex < input.length) {
    segments.push({
      type: 'markdown',
      content: input.slice(lastIndex),
    });
  }

  return segments;
}

/**
 * Converts a Markdown prose block into native docx Paragraphs
 * (Headings H1-H3, Bullet lists, Numbered lists, and flowing Paragraphs).
 */
function markdownBlockToParagraphs(markdown: string): Paragraph[] {
  const lines = markdown.split(/\r?\n/);
  const paragraphs: Paragraph[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (!trimmed) {
      continue;
    }

    // Horizontal divider line (---) -> native Word bottom border divider
    if (/^-{3,}$/.test(trimmed)) {
      paragraphs.push(
        new Paragraph({
          spacing: { before: 80, after: 120 },
          border: {
            bottom: {
              style: BorderStyle.SINGLE,
              size: 8,
              color: '6B7280',
              space: 4,
            },
          },
          children: [],
        }),
      );
      continue;
    }

    // Embedded emblem / Garuda image (![emblem](data:image/png;base64,...))
    const emblemMatch = trimmed.match(/^!\[emblem\]\((data:image\/[^;]+;base64,([^)]+))\)$/i);
    if (emblemMatch) {
      try {
        const binStr = atob(emblemMatch[2]);
        const bytes = new Uint8Array(binStr.length);
        for (let b = 0; b < binStr.length; b++) {
          bytes[b] = binStr.charCodeAt(b);
        }
        paragraphs.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 160 },
            children: [
              new ImageRun({
                type: 'png',
                data: bytes,
                transformation: { width: 105, height: 105 },
              }),
            ],
          }),
        );
      } catch {
        // Ignore malformed image data URL
      }
      continue;
    }

    // First-line indented body paragraph (<p indent="first">...</p>) -> 0.5in indent + Thai Distribute
    const indentMatch = trimmed.match(/^<p\s+indent="first">([\s\S]*)<\/p>$/i);
    if (indentMatch) {
      paragraphs.push(
        new Paragraph({
          alignment: AlignmentType.THAI_DISTRIBUTE,
          indent: { firstLine: 720 },
          spacing: THAI_LINE_SPACING,
          children: parseInlineRuns(indentMatch[1]),
        }),
      );
      continue;
    }

    // Centered paragraph (<p align="center">...</p>) -> centered Word Paragraph
    const centerMatch = trimmed.match(/^<p\s+align="center">([\s\S]*)<\/p>$/i);
    if (centerMatch) {
      paragraphs.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: THAI_LINE_SPACING,
          children: parseInlineRuns(centerMatch[1]),
        }),
      );
      continue;
    }

    // Right-aligned paragraph (<p align="right">...</p>) -> right-aligned Word Paragraph
    const rightMatch = trimmed.match(/^<p\s+align="right">([\s\S]*)<\/p>$/i);
    if (rightMatch) {
      paragraphs.push(
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: THAI_LINE_SPACING,
          children: parseInlineRuns(rightMatch[1]),
        }),
      );
      continue;
    }

    // Signature / Order date block (<p align="signature">...</p>) -> indented centered block
    const sigMatch = trimmed.match(/^<p\s+align="signature">([\s\S]*)<\/p>$/i);
    if (sigMatch) {
      paragraphs.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          indent: { left: 3600 },
          spacing: { line: 312, lineRule: LineRuleType.AUTO, after: 40 },
          children: parseInlineRuns(sigMatch[1]),
        }),
      );
      continue;
    }

    // Headings H1 - H3
    if (trimmed.startsWith('### ')) {
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 100, line: 312, lineRule: LineRuleType.AUTO },
          children: parseInlineRuns(trimmed.slice(4), {
            size: 36, // 18pt
            bold: true,
          }),
        }),
      );
      continue;
    }

    if (trimmed.startsWith('## ')) {
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 120, line: 312, lineRule: LineRuleType.AUTO },
          children: parseInlineRuns(trimmed.slice(3), {
            size: 40, // 20pt
            bold: true,
          }),
        }),
      );
      continue;
    }

    if (trimmed.startsWith('# ')) {
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 280, after: 140, line: 324, lineRule: LineRuleType.AUTO },
          children: parseInlineRuns(trimmed.slice(2), {
            size: 44, // 22pt
            bold: true,
          }),
        }),
      );
      continue;
    }

    // Bullet list
    const bulletMatch = trimmed.match(/^[-*•]\s+(.*)$/);
    if (bulletMatch) {
      paragraphs.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: THAI_LINE_SPACING,
          children: parseInlineRuns(bulletMatch[1]),
        }),
      );
      continue;
    }

    // Numbered list
    const numberMatch = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (numberMatch) {
      paragraphs.push(
        new Paragraph({
          numbering: {
            reference: 'thai-numbered-list',
            level: 0,
          },
          spacing: THAI_LINE_SPACING,
          children: parseInlineRuns(numberMatch[1]),
        }),
      );
      continue;
    }

    // Standard flowing paragraph (no floating text boxes!)
    const useThaiDistribute = trimmed.length > 60;
    const paraOptions: IParagraphOptions = {
      alignment: useThaiDistribute ? AlignmentType.THAI_DISTRIBUTE : AlignmentType.LEFT,
      spacing: THAI_LINE_SPACING,
      children: parseInlineRuns(trimmed),
    };
    paragraphs.push(new Paragraph(paraOptions));
  }

  return paragraphs;
}

/**
 * Generates a native Word (.docx) Blob from Unified Intermediate Format
 * (Markdown + HTML Table) with TH Sarabun New typography and full Thai support.
 */
export async function generateDocxBlob(unifiedMarkdown: string): Promise<Blob> {
  const segments = splitMarkdownAndTables(unifiedMarkdown);
  const children: Array<Paragraph | Table> = [];

  for (const segment of segments) {
    if (segment.type === 'table') {
      const table = htmlTableToDocxTable(segment.content);
      if (table) {
        children.push(table);
        // Add small breathing room after each table
        children.push(
          new Paragraph({
            spacing: { before: 60, after: 120 },
            children: [],
          }),
        );
      }
    } else {
      children.push(...markdownBlockToParagraphs(segment.content));
    }
  }

  if (children.length === 0) {
    children.push(
      new Paragraph({
        spacing: THAI_LINE_SPACING,
        children: parseInlineRuns(''),
      }),
    );
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: THAI_FONT_SPEC,
            size: BODY_FONT_SIZE_HALF_PT,
          },
          paragraph: {
            spacing: THAI_LINE_SPACING,
          },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: 'thai-numbered-list',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.START,
              style: {
                paragraph: {
                  indent: { left: 720, hanging: 360 },
                },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          titlePage: true,
          page: {
            margin: {
              top: 1440, // 1 inch
              bottom: 1440,
              left: 1440,
              right: 1440,
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: '-',
                    font: THAI_FONT_SPEC,
                    size: BODY_FONT_SIZE_HALF_PT,
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    font: THAI_FONT_SPEC,
                    size: BODY_FONT_SIZE_HALF_PT,
                  }),
                  new TextRun({
                    text: '-',
                    font: THAI_FONT_SPEC,
                    size: BODY_FONT_SIZE_HALF_PT,
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBlob(doc);
}

