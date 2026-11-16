import type { Language } from '../types/ocr';

export interface Translations {
  brandSubtitle: string;
  clientSideBadge: string;
  heroTitle: string;
  heroDesc: string;
  dropzoneTitle: string;
  dropzoneSubtitle: string;
  dropzoneFormats: string;
  browseFiles: string;
  clearFile: string;
  pdfScaleLabel: string;
  pdfScaleHint: string;
  pagesCount: (n: number) => string;
  modelSectionTitle: string;
  webgpuSupported: string;
  webgpuUnsupported: string;
  cacheSectionTitle: string;
  cachePersistentOn: string;
  cachePersistentOff: string;
  cacheTotalUsed: string;
  cachedBadge: string;
  notCachedBadge: string;
  downloadAndCache: string;
  downloading: string;
  deleteModelCache: string;
  deleteAllCache: string;
  confirmDeleteCache: string;
  cacheDeleted: string;
  startOcr: string;
  processingOcr: string;
  cancelOcr: string;
  progressNormalizing: string;
  progressDownloading: string;
  progressInitializing: string;
  progressInferring: (cur: number, total: number) => string;
  progressDone: string;
  previewTitle: string;
  tabRendered: string;
  tabMarkdown: string;
  copyText: string;
  copied: string;
  exportDocx: string;
  exportMd: string;
  exportTxt: string;
  docxHint: string;
  emptyPreview: string;
  errorPrefix: string;
  privacyFooter: string;
  pageLabel: (n: number) => string;
  editableHint: string;
}

export const TRANSLATIONS: Record<Language, Translations> = {
  th: {
    brandSubtitle: 'แปลงเอกสารไทย-อังกฤษ 100% บนเบราว์เซอร์',
    clientSideBadge: 'ประมวลผลในเครื่อง 100% • ไม่อัปโหลดไฟล์',
    heroTitle: 'แปลงภาพและ PDF เป็น Word, Markdown และ Text',
    heroDesc:
      'อ่านภาษาไทยแม่นยำ พร้อมจัดโครงสร้างหัวข้อ ย่อหน้า และตารางอัตโนมัติ ส่งออกเป็นไฟล์ .docx ที่ใช้ฟอนต์ TH Sarabun New ไม่เกิดสระลอยหรือตารางเพี้ยน',
    dropzoneTitle: 'ลากไฟล์มาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์',
    dropzoneSubtitle: 'รองรับเอกสารหลายหน้าและภาพความละเอียดสูง ประมวลผลบนอุปกรณ์ของคุณเท่านั้น',
    dropzoneFormats: 'รองรับ PDF, JPG, PNG, WEBP',
    browseFiles: 'เลือกไฟล์',
    clearFile: 'ล้างไฟล์',
    pdfScaleLabel: 'ความคมชัดในการเรนเดอร์ PDF',
    pdfScaleHint: 'แนะนำ 2.5x–3.0x เพื่อให้อ่านสระและวรรณยุกต์ภาษาไทยได้คมชัด',
    pagesCount: (n) => `${n} หน้า`,
    modelSectionTitle: 'เลือกโหมด AI และจัดการแคชโมเดล',
    webgpuSupported: 'พร้อมใช้งาน WebGPU',
    webgpuUnsupported: 'เบราว์เซอร์นี้ไม่รองรับ WebGPU (ใช้โหมด Fast ได้)',
    cacheSectionTitle: 'แคชโมเดลถาวรบนเครื่อง',
    cachePersistentOn: 'บันทึกถาวร (Persistent Storage)',
    cachePersistentOff: 'บันทึกในเบราว์เซอร์ (Cache API)',
    cacheTotalUsed: 'พื้นที่แคชที่ใช้',
    cachedBadge: 'แคชแล้วพร้อมใช้',
    notCachedBadge: 'ยังไม่ได้โหลดแคช',
    downloadAndCache: 'โหลดเก็บในเครื่อง',
    downloading: 'กำลังดาวน์โหลด...',
    deleteModelCache: 'ลบแคชรุ่นนี้',
    deleteAllCache: 'ลบแคชทั้งหมด',
    confirmDeleteCache: 'ต้องการลบไฟล์แคชโมเดลออกจากเครื่องใช่หรือไม่?',
    cacheDeleted: 'ลบแคชโมเดลเรียบร้อยแล้ว',
    startOcr: 'เริ่มแปลงเอกสาร',
    processingOcr: 'กำลังประมวลผล...',
    cancelOcr: 'ยกเลิก',
    progressNormalizing: 'กำลังเตรียมภาพความละเอียดสูง...',
    progressDownloading: 'กำลังดาวน์โหลดและแคชโมเดลลงเครื่อง...',
    progressInitializing: 'กำลังโหลดโมเดลเข้าสู่ Web Worker...',
    progressInferring: (cur, total) => `กำลังอ่านหน้า ${cur} จาก ${total}...`,
    progressDone: 'แปลงเอกสารเสร็จสมบูรณ์!',
    previewTitle: 'ผลลัพธ์เอกสาร (แก้ไขข้อความก่อนดาวน์โหลดได้)',
    tabRendered: 'มุมมองเอกสาร & ตาราง',
    tabMarkdown: 'โค้ด Markdown + HTML',
    copyText: 'คัดลอก',
    copied: 'คัดลอกแล้ว',
    exportDocx: 'ดาวน์โหลด Word (.docx)',
    exportMd: 'ดาวน์โหลด .md',
    exportTxt: 'ดาวน์โหลด .txt',
    docxHint: 'ฟอนต์ TH Sarabun New • รองรับ rowspan/colspan • ข้อความไหลข้ามหน้าอัตโนมัติ',
    emptyPreview: 'อัปโหลดไฟล์แล้วกด "เริ่มแปลงเอกสาร" เพื่อดูผลลัพธ์และส่งออกไฟล์ที่นี่',
    errorPrefix: 'เกิดข้อผิดพลาด',
    privacyFooter:
      'ScrawnyOCR ทำงานแบบ Offline-capable 100% ไฟล์ของคุณไม่เคยถูกส่งออกจากเบราว์เซอร์',
    pageLabel: (n) => `หน้า ${n}`,
    editableHint: 'คุณสามารถแก้ไขข้อความในแท็บ Markdown ก่อนกดส่งออกได้ทันที',
  },
  en: {
    brandSubtitle: '100% Client-Side Thai & English Document OCR',
    clientSideBadge: '100% Local Processing • Zero Server Upload',
    heroTitle: 'Convert Images & PDFs to Word, Markdown & Text',
    heroDesc:
      'Accurate Thai & English OCR with layout & table preservation. Exports native .docx files using TH Sarabun New with proper line spacing and merged table cells.',
    dropzoneTitle: 'Drag & drop your file here, or click to browse',
    dropzoneSubtitle: 'Supports multi-page PDFs and high-res images. Everything stays on your device.',
    dropzoneFormats: 'Supports PDF, JPG, PNG, WEBP',
    browseFiles: 'Choose File',
    clearFile: 'Clear',
    pdfScaleLabel: 'PDF Render Scale',
    pdfScaleHint: '2.5x–3.0x recommended for crisp Thai vowels and tone marks',
    pagesCount: (n) => `${n} ${n === 1 ? 'page' : 'pages'}`,
    modelSectionTitle: 'AI Mode & Persistent Model Cache',
    webgpuSupported: 'WebGPU Ready',
    webgpuUnsupported: 'WebGPU unavailable (Use Fast Mode)',
    cacheSectionTitle: 'Local Persistent Model Cache',
    cachePersistentOn: 'Persistent Storage Granted',
    cachePersistentOff: 'Browser Cache API Active',
    cacheTotalUsed: 'Total Cache Used',
    cachedBadge: 'Cached Locally',
    notCachedBadge: 'Not Cached',
    downloadAndCache: 'Download & Cache',
    downloading: 'Downloading...',
    deleteModelCache: 'Delete Cache',
    deleteAllCache: 'Clear All Cache',
    confirmDeleteCache: 'Delete cached model files from this device?',
    cacheDeleted: 'Model cache cleared.',
    startOcr: 'Run OCR',
    processingOcr: 'Processing...',
    cancelOcr: 'Cancel',
    progressNormalizing: 'Preparing high-resolution page images...',
    progressDownloading: 'Downloading & caching model locally...',
    progressInitializing: 'Initializing AI engine in Web Worker...',
    progressInferring: (cur, total) => `Reading page ${cur} of ${total}...`,
    progressDone: 'Document conversion complete!',
    previewTitle: 'Extracted Document (Editable before export)',
    tabRendered: 'Rendered Preview',
    tabMarkdown: 'Markdown + HTML Source',
    copyText: 'Copy',
    copied: 'Copied',
    exportDocx: 'Download Word (.docx)',
    exportMd: 'Download .md',
    exportTxt: 'Download .txt',
    docxHint: 'TH Sarabun New • Native rowspan/colspan • Auto-reflow paragraphs',
    emptyPreview: 'Upload a PDF or image and click "Run OCR" to preview and export here.',
    errorPrefix: 'Error',
    privacyFooter:
      'ScrawnyOCR runs 100% in your browser. Your documents never leave your device.',
    pageLabel: (n) => `Page ${n}`,
    editableHint: 'You can edit the Markdown source directly before exporting.',
  },
};

