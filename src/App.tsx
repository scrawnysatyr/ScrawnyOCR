import { useCallback, useEffect, useRef, useState } from 'react';
import { Globe, Play, ScanText, ShieldCheck } from 'lucide-react';
import { checkWebGpuSupport, MODEL_REGISTRY } from './ai/modelRegistry';
import { OcrWorkerClient } from './ai/ocrClient';
import { DropZone } from './components/DropZone';
import { ModelSelector } from './components/ModelSelector';
import { PreviewPane } from './components/PreviewPane';
import { ProgressPanel } from './components/ProgressPanel';
import {
  downloadAsDocx,
  downloadAsMarkdown,
  downloadAsText,
} from './exporters/exportFormats';
import { TRANSLATIONS } from './i18n/translations';
import type {
  CachedModelInfo,
  Language,
  ModelDefinition,
  ModelMode,
  NormalizedDocument,
  OcrProgressEvent,
} from './types/ocr';
import {
  clearAllModelCaches,
  deleteModelCache,
  downloadAndCacheModel,
  getModelCacheStatus,
  getTotalCacheBytes,
  importLocalModelFiles,
  isPersistentStorageGranted,
} from './utils/modelCache';
import { normalizeInputFile } from './utils/pdfToImages';

const SAMPLE_THAI_UNIFIED_DOC = `# รายงานสรุปผลการดำเนินงานประจำไตรมาสที่ 3

เอกสารฉบับนี้จัดทำขึ้นเพื่อทดสอบการจัดรูปแบบภาษาไทยทั้ง **สระบน-ล่าง** และ **วรรณยุกต์ (เอก โท ตรี จัตวา)** รวมถึงการผสานเซลล์ตารางในไฟล์ Word (.docx) ด้วยฟอนต์มาตรฐาน **TH Sarabun New**

## 1. หัวข้อสำคัญในการประมวลผล
- รองรับไฟล์ภาพ (JPG, PNG, WEBP) และเอกสาร PDF หลายหน้า
- แปลงข้อความและตารางให้อยู่ในรูปแบบมาตรฐานกลาง **Markdown + HTML Table**
- ข้อความไหลข้ามหน้าอัตโนมัติ (Auto Reflow) โดยไม่ใช้ Text Box ลอยๆ

1. ขั้นตอนที่หนึ่ง: เตรียมภาพความละเอียดสูง (Scale 2.75x)
2. ขั้นตอนที่สอง: ประมวลผลผ่าน Web Worker บนเบราว์เซอร์ 100%
3. ขั้นตอนที่สาม: ส่งออกเป็นไฟล์ .docx, .md หรือ .txt

## 2. ตารางสรุปข้อมูลเปรียบเทียบ (ทดสอบ rowspan และ colspan)

<table>
  <thead>
    <tr>
      <th rowspan="2">รายการ</th>
      <th colspan="2">โหมดการทำงานบนเบราว์เซอร์</th>
      <th rowspan="2">หมายเหตุ</th>
    </tr>
    <tr>
      <th>Fast Mode (WASM)</th>
      <th>High Accuracy (WebGPU)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>เอนจินหลัก</td>
      <td>onnxruntime-web (CPU)</td>
      <td>Vision-Language (GPU)</td>
      <td>ทำงานออฟไลน์หลังแคชโมเดล</td>
    </tr>
    <tr>
      <td>การอ่านตารางซับซ้อน</td>
      <td>โครงสร้างพื้นฐาน</td>
      <td>รองรับ rowspan / colspan เต็มรูปแบบ</td>
      <td>ส่งออกเป็น Native Table ใน Word</td>
    </tr>
  </tbody>
</table>`;

export function App() {
  const [lang, setLang] = useState<Language>('th');
  const t = TRANSLATIONS[lang];

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [normalizedDoc, setNormalizedDoc] = useState<NormalizedDocument | null>(null);
  const [pdfScale, setPdfScale] = useState<number>(2.75);

  const [selectedMode, setSelectedMode] = useState<ModelMode>('accurate');
  const [webGpuSupported, setWebGpuSupported] = useState<boolean>(false);

  const [persistentGranted, setPersistentGranted] = useState<boolean>(false);
  const [totalCacheBytes, setTotalCacheBytes] = useState<number>(0);
  const [cacheStatuses, setCacheStatuses] = useState<Record<string, CachedModelInfo>>({});
  const [downloadingModelId, setDownloadingModelId] = useState<string | null>(null);
  const [downloadPercent, setDownloadPercent] = useState<number>(0);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isExportingDocx, setIsExportingDocx] = useState<boolean>(false);
  const [progress, setProgress] = useState<OcrProgressEvent>({
    stage: 'idle',
    percent: 0,
    message: '',
  });
  const [resultMarkdown, setResultMarkdown] = useState<string>('');

  const workerClientRef = useRef<OcrWorkerClient | null>(null);

  const refreshCacheInfo = useCallback(async () => {
    const [fastStatus, accurateStatus, totalBytes, persisted] = await Promise.all([
      getModelCacheStatus(MODEL_REGISTRY.fast),
      getModelCacheStatus(MODEL_REGISTRY.accurate),
      getTotalCacheBytes(),
      isPersistentStorageGranted(),
    ]);

    setCacheStatuses({
      [MODEL_REGISTRY.fast.id]: fastStatus,
      [MODEL_REGISTRY.accurate.id]: accurateStatus,
    });
    setTotalCacheBytes(totalBytes);
    setPersistentGranted(persisted);
  }, []);

  useEffect(() => {
    checkWebGpuSupport().then((res) => setWebGpuSupported(res.supported));
    refreshCacheInfo();

    return () => {
      workerClientRef.current?.terminate();
    };
  }, [refreshCacheInfo]);

  const handleNormalizeFile = useCallback(
    async (file: File, scale: number) => {
      setSelectedFile(file);
      setProgress({
        stage: 'normalizing',
        percent: 15,
        message: t.progressNormalizing,
      });

      try {
        const doc = await normalizeInputFile(file, {
          pdfScale: scale,
          onPageProgress: (cur, total) => {
            setProgress({
              stage: 'normalizing',
              percent: Math.round((cur / total) * 100),
              currentPage: cur,
              totalPages: total,
              message: t.progressNormalizing,
            });
          },
        });
        setNormalizedDoc(doc);
        setProgress({ stage: 'idle', percent: 0, message: '' });
      } catch (err) {
        setNormalizedDoc(null);
        setProgress({
          stage: 'error',
          percent: 0,
          message: err instanceof Error ? err.message : 'Failed to read file.',
        });
      }
    },
    [t.progressNormalizing],
  );

  const handlePdfScaleChange = (newScale: number) => {
    setPdfScale(newScale);
    if (
      selectedFile &&
      (selectedFile.type === 'application/pdf' ||
        selectedFile.name.toLowerCase().endsWith('.pdf'))
    ) {
      void handleNormalizeFile(selectedFile, newScale);
    }
  };

  const handleClearFile = () => {
    setSelectedFile(null);
    setNormalizedDoc(null);
    setProgress({ stage: 'idle', percent: 0, message: '' });
  };

  const handleDownloadModel = async (model: ModelDefinition) => {
    setDownloadingModelId(model.id);
    setDownloadPercent(0);
    try {
      await downloadAndCacheModel(model, (loaded, total) => {
        const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
        setDownloadPercent(pct);
      });
      await refreshCacheInfo();
    } catch (err) {
      setProgress({
        stage: 'error',
        percent: 0,
        message:
          err instanceof Error
            ? err.message
            : 'Failed to download and cache model.',
      });
    } finally {
      setDownloadingModelId(null);
      setDownloadPercent(0);
    }
  };

  const handleImportLocalModel = async (
    model: ModelDefinition,
    files: FileList,
  ) => {
    try {
      await importLocalModelFiles(model, files);
      await refreshCacheInfo();
    } catch (err) {
      setProgress({
        stage: 'error',
        percent: 0,
        message:
          err instanceof Error
            ? err.message
            : 'Failed to import local model files.',
      });
    }
  };

  const handleDeleteModelCache = async (model: ModelDefinition) => {
    if (!window.confirm(t.confirmDeleteCache)) return;
    await deleteModelCache(model);
    await refreshCacheInfo();
  };

  const handleClearAllCache = async () => {
    if (!window.confirm(t.confirmDeleteCache)) return;
    await clearAllModelCaches();
    await refreshCacheInfo();
  };

  const handleRunOcr = async () => {
    if (!normalizedDoc) return;

    const model = MODEL_REGISTRY[selectedMode];
    setIsProcessing(true);
    setProgress({
      stage: 'initializing',
      percent: 5,
      message: t.progressInitializing,
    });

    if (!workerClientRef.current) {
      workerClientRef.current = new OcrWorkerClient();
    }

    try {
      const result = await workerClientRef.current.runDocumentOcr(
        normalizedDoc,
        model,
        (evt) => {
          setProgress(evt);
        },
      );
      setResultMarkdown(result.combinedMarkdown);
      setProgress({
        stage: 'done',
        percent: 100,
        message: t.progressDone,
      });
      await refreshCacheInfo();
    } catch (err) {
      setProgress({
        stage: 'error',
        percent: 0,
        message: err instanceof Error ? err.message : 'OCR processing failed.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancelOcr = () => {
    workerClientRef.current?.cancel();
    setIsProcessing(false);
  };

  const handleExportDocx = async () => {
    if (!resultMarkdown.trim()) return;
    setIsExportingDocx(true);
    try {
      await downloadAsDocx(
        resultMarkdown,
        selectedFile?.name ?? 'scrawny-ocr-document',
      );
    } finally {
      setIsExportingDocx(false);
    }
  };

  const handleExportMd = () => {
    if (!resultMarkdown.trim()) return;
    downloadAsMarkdown(
      resultMarkdown,
      selectedFile?.name ?? 'scrawny-ocr-document',
    );
  };

  const handleExportTxt = () => {
    if (!resultMarkdown.trim()) return;
    downloadAsText(
      resultMarkdown,
      selectedFile?.name ?? 'scrawny-ocr-document',
    );
  };

  return (
    <div className="relative min-h-screen bg-[#141418] text-[#f4f4f5] lg:h-dvh lg:overflow-hidden">
      <div className="bg-grid" />
      <div className="bg-glow" />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-[1600px] flex-col gap-3 px-4 py-3 sm:px-6 lg:h-full">
        {/* Topbar */}
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#2c2c36]/70 pb-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl border border-[#2c2c36] bg-[#1c1c22] text-[#ff7300] shadow-md">
              <ScanText className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-extrabold tracking-tight text-[#f4f4f5]">
                  Scrawny<span className="text-[#ff7300]">OCR</span>
                </span>
                <span className="hidden items-center gap-1 rounded-full border border-[#ff7300]/30 bg-[#ff7300]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#ff9440] sm:inline-flex">
                  <ShieldCheck className="h-3 w-3" />
                  {t.clientSideBadge}
                </span>
              </div>
              <p className="text-[11px] text-[#a1a1aa]">{t.brandSubtitle}</p>
            </div>
          </div>

          {/* Language Switcher TH / EN */}
          <button
            type="button"
            onClick={() => setLang((prev) => (prev === 'th' ? 'en' : 'th'))}
            className="inline-flex items-center gap-2 rounded-xl border border-[#2c2c36] bg-[#1c1c22] px-3 py-1.5 text-xs font-semibold text-[#f4f4f5] transition-colors hover:border-[#ff7300]"
          >
            <Globe className="h-3.5 w-3.5 text-[#ff7300]" />
            <span className={lang === 'th' ? 'text-[#ff7300]' : 'text-[#71717a]'}>
              TH
            </span>
            <span className="text-[#2c2c36]">/</span>
            <span className={lang === 'en' ? 'text-[#ff7300]' : 'text-[#71717a]'}>
              EN
            </span>
          </button>
        </header>

        {/* Split Workspace: Left = Input & Controls, Right = Preview & Export */}
        <main className="grid min-h-0 flex-1 gap-4 lg:grid-cols-12">
          {/* Left Column: Input */}
          <div className="flex min-h-0 flex-col gap-3 lg:col-span-5 lg:overflow-y-auto lg:pr-1">
            <DropZone
              t={t}
              selectedFile={selectedFile}
              normalizedDoc={normalizedDoc}
              pdfScale={pdfScale}
              disabled={isProcessing}
              onPdfScaleChange={handlePdfScaleChange}
              onFileSelected={(file) => void handleNormalizeFile(file, pdfScale)}
              onClearFile={handleClearFile}
            />

            <ModelSelector
              t={t}
              lang={lang}
              selectedMode={selectedMode}
              webGpuSupported={webGpuSupported}
              persistentGranted={persistentGranted}
              totalCacheBytes={totalCacheBytes}
              cacheStatuses={cacheStatuses}
              downloadingModelId={downloadingModelId}
              downloadPercent={downloadPercent}
              disabled={isProcessing}
              onSelectMode={setSelectedMode}
              onDownloadModel={(model) => void handleDownloadModel(model)}
              onImportLocalModel={(model, files) =>
                void handleImportLocalModel(model, files)
              }
              onDeleteModelCache={(model) => void handleDeleteModelCache(model)}
              onClearAllCache={() => void handleClearAllCache()}
            />

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={!normalizedDoc || isProcessing || downloadingModelId !== null}
                onClick={() => void handleRunOcr()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff7300] px-6 py-2.5 text-sm font-bold text-[#141418] shadow-[0_0_24px_rgba(255,115,0,0.28)] transition-all hover:bg-[#ff8826] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Play className="h-4 w-4 fill-current" />
                {isProcessing ? t.processingOcr : t.startOcr}
              </button>
            </div>

            <ProgressPanel
              t={t}
              progress={progress}
              isProcessing={isProcessing}
              onCancel={handleCancelOcr}
            />
          </div>

          {/* Right Column: Preview Output */}
          <div className="flex min-h-0 flex-col lg:col-span-7">
            <PreviewPane
              t={t}
              lang={lang}
              markdown={resultMarkdown}
              isExportingDocx={isExportingDocx}
              onChangeMarkdown={setResultMarkdown}
              onExportDocx={() => void handleExportDocx()}
              onExportMd={handleExportMd}
              onExportTxt={handleExportTxt}
              onLoadSample={() => setResultMarkdown(SAMPLE_THAI_UNIFIED_DOC)}
            />
          </div>
        </main>

        {/* Footer */}
        <footer className="shrink-0 border-t border-[#2c2c36]/70 pt-2 text-center text-[11px] text-[#71717a]">
          {t.privacyFooter}
        </footer>
      </div>
    </div>
  );
}

export default App;
