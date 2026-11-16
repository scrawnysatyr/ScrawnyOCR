import * as pdfjsLib from 'pdfjs-dist';
import type { NormalizedDocument, NormalizedPage } from '../types/ocr';

// Configure PDF.js worker using Vite-compatible ES module URL
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

export interface NormalizeOptions {
  /** PDF render scale (recommended 2.5 - 3.0 for crisp Thai vowels & tone marks) */
  pdfScale?: number;
  /** Optional callback invoked as each page is rasterized */
  onPageProgress?: (currentPage: number, totalPages: number) => void;
}

/**
 * Generates a lightweight thumbnail data URL from a source canvas
 * without retaining full-resolution DOM canvas elements.
 */
function createThumbnailUrl(
  sourceCanvas: HTMLCanvasElement,
  maxThumbWidth = 420,
): string {
  const ratio = Math.min(1, maxThumbWidth / sourceCanvas.width);
  const thumbW = Math.max(1, Math.round(sourceCanvas.width * ratio));
  const thumbH = Math.max(1, Math.round(sourceCanvas.height * ratio));

  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = thumbW;
  thumbCanvas.height = thumbH;

  const ctx = thumbCanvas.getContext('2d');
  if (!ctx) return '';

  ctx.drawImage(sourceCanvas, 0, 0, thumbW, thumbH);
  const dataUrl = thumbCanvas.toDataURL('image/jpeg', 0.78);

  thumbCanvas.width = 0;
  thumbCanvas.height = 0;
  return dataUrl;
}

/**
 * Converts a single image file (JPG, PNG, WEBP) into a NormalizedDocument
 * using ImageBitmap + Canvas for crisp RGBA ImageData extraction.
 */
async function normalizeImageFile(
  file: File,
  onPageProgress?: (currentPage: number, totalPages: number) => void,
): Promise<NormalizedDocument> {
  onPageProgress?.(1, 1);

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    bitmap.close();
    throw new Error('Failed to acquire 2D canvas context for image normalization.');
  }

  // Paint white background first in case PNG/WEBP has transparent regions
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const previewUrl = createThumbnailUrl(canvas);

  canvas.width = 0;
  canvas.height = 0;

  return {
    fileName: file.name,
    fileType: 'image',
    fileSize: file.size,
    scaleUsed: 1,
    pages: [
      {
        pageNumber: 1,
        width: imageData.width,
        height: imageData.height,
        imageData,
        previewUrl,
      },
    ],
  };
}

/**
 * Renders every page of a PDF file into high-resolution ImageData
 * (default scale 2.75) so Thai upper/lower vowels and tone marks remain sharp.
 */
async function normalizePdfFile(
  file: File,
  scale: number,
  onPageProgress?: (currentPage: number, totalPages: number) => void,
): Promise<NormalizedDocument> {
  const clampedScale = Math.min(3.5, Math.max(1.5, scale));
  const arrayBuffer = await file.arrayBuffer();

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    useSystemFonts: true,
  });

  const pdfDoc = await loadingTask.promise;
  const totalPages = pdfDoc.numPages;
  const pages: NormalizedPage[] = [];

  try {
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      onPageProgress?.(pageNum, totalPages);

      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: clampedScale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        throw new Error(`Failed to acquire 2D canvas context on PDF page ${pageNum}.`);
      }

      // White paper background for clean OCR contrast
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: ctx,
        viewport,
        canvas,
      }).promise;

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const previewUrl = createThumbnailUrl(canvas);

      pages.push({
        pageNumber: pageNum,
        width: imageData.width,
        height: imageData.height,
        imageData,
        previewUrl,
      });

      page.cleanup();
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    await pdfDoc.destroy();
  }

  return {
    fileName: file.name,
    fileType: 'pdf',
    fileSize: file.size,
    scaleUsed: clampedScale,
    pages,
  };
}

/**
 * Normalizes an uploaded PDF or Image file (JPG, PNG, WEBP) into high-resolution
 * ImageData pages ready to be transferred to the OCR Web Worker.
 */
export async function normalizeInputFile(
  file: File,
  options: NormalizeOptions = {},
): Promise<NormalizedDocument> {
  const { pdfScale = 2.75, onPageProgress } = options;
  const mime = file.type.toLowerCase();
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

  if (mime === 'application/pdf' || ext === 'pdf') {
    return normalizePdfFile(file, pdfScale, onPageProgress);
  }

  if (
    SUPPORTED_IMAGE_TYPES.has(mime) ||
    ext === 'jpg' ||
    ext === 'jpeg' ||
    ext === 'png' ||
    ext === 'webp'
  ) {
    return normalizeImageFile(file, onPageProgress);
  }

  throw new Error(
    `Unsupported file format: "${file.name}". Please upload PDF, JPG, PNG, or WEBP.`,
  );
}

