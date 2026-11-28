import { useCallback, useEffect, useRef, useState } from 'react';
import { Megaphone, Play } from 'lucide-react';
import {
  checkModelResourceGuard,
  checkWebGpuSupport,
  MODEL_REGISTRY,
} from './ai/modelRegistry';
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
import { useTranslatedPack } from './utils/autoTranslate';
import { LanguageSelector } from './components/LanguageSelector';
import { LeftAdBanner } from './components/LeftAdBanner';
import type {
  CachedModelInfo,
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

export function App() {
  const [lang, setLang] = useState<string>(() => {
    try {
      return localStorage.getItem('scrawny-ocr-lang') || 'th';
    } catch {
      return 'th';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('scrawny-ocr-lang', lang);
    } catch {
      // Ignore
    }
    document.documentElement.lang = lang;
  }, [lang]);

  const { t: rawT, translateTemplate } = useTranslatedPack(lang, TRANSLATIONS, 'scrawny_ocr', {
    pagesCount: '{{n}} pages',
    progressInferring: 'Running OCR page {{cur}}/{{total}}...',
    pageLabel: 'Page {{n}}',
  });
  const t =
    lang === 'en' || lang === 'th'
      ? rawT
      : {
          ...rawT,
          pagesCount: (n: number) => translateTemplate('{{n}} pages', { n }),
          progressInferring: (cur: number, total: number) =>
            translateTemplate('Running OCR page {{cur}}/{{total}}...', { cur, total }),
          pageLabel: (n: number) => translateTemplate('Page {{n}}', { n }),
        };

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [normalizedDoc, setNormalizedDoc] = useState<NormalizedDocument | null>(null);
  const [pdfScale, setPdfScale] = useState<number>(2.75);

  const [selectedMode, setSelectedMode] = useState<ModelMode>('fast');
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
  const [selectedPageNumber, setSelectedPageNumber] = useState<number | null>(null);
  const [pageMarkdowns, setPageMarkdowns] = useState<Record<number, string>>({});

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
        setSelectedPageNumber(doc.pages[0]?.pageNumber ?? null);
        setPageMarkdowns({});
        setResultMarkdown('');
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
    setSelectedPageNumber(null);
    setPageMarkdowns({});
    setResultMarkdown('');
    setProgress({ stage: 'idle', percent: 0, message: '' });
  };

  const ensureResourcesOk = async (model: ModelDefinition): Promise<boolean> => {
    const guard = await checkModelResourceGuard(model);
    if (!guard.ok) {
      setProgress({
        stage: 'error',
        percent: 0,
        message: guard.reason ?? 'Insufficient device RAM or storage.',
      });
      return false;
    }
    return true;
  };

  const handleDownloadModel = async (model: ModelDefinition) => {
    if (!(await ensureResourcesOk(model))) return;
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
    if (!(await ensureResourcesOk(model))) return;
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
    if (model.onnxReady === false && !cacheStatuses[model.id]?.isCached) {
      setProgress({
        stage: 'error',
        percent: 0,
        message:
          lang === 'th'
            ? 'Typhoon OCR2 2B ยังไม่มีไฟล์ ONNX ให้โหลดอัตโนมัติ (กรุณานำเข้าไฟล์ .onnx จากเครื่อง หรือเลือก "โหมดจัดหน้า + ตาราง + Text OCR (WebGPU)")'
            : 'Typhoon OCR2 2B has no pre-converted ONNX download. Import local .onnx weights or use "Layout + Table + Text OCR (WebGPU)".',
      });
      return;
    }

    if (!(await ensureResourcesOk(model))) return;
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
      const perPageMap: Record<number, string> = {};
      for (const p of result.pages) {
        perPageMap[p.pageNumber] = p.markdown;
      }
      setPageMarkdowns(perPageMap);
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
    <div className="relative min-h-screen bg-[#050505] text-[#ffffff] lg:h-dvh lg:overflow-hidden">
      <div className="bg-grid" />
      <div className="bg-glow" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full flex-col gap-3 px-3 py-3 sm:px-5 lg:h-full">
        {/* Topbar */}
        <header className="relative z-20 flex shrink-0 flex-wrap items-center justify-between gap-3 py-1">
          <a href="https://scrawny.site" className="flex items-center group">
            <span className="text-base sm:text-lg font-extrabold tracking-tight text-[#ffffff] leading-none">
              <span className="text-[#ff7300]">ocr</span>.scrawny<span className="text-[#ff7300]">.site</span>
            </span>
          </a>

          <div className="flex items-center flex-wrap gap-2">
            <a
              href="https://www.buymeacoffee.com/scrawnysatyr"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex items-center transition-transform hover:scale-[1.03]"
              title="Buy Me Some Oranges"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 56" className="h-8 w-auto">
                <rect x="2" y="2" width="256" height="52" rx="12" fill="#FFDD00" />
                <g transform="translate(15, 9) scale(0.58)" fill="none">
                  <path d="M33 17C38 10 47 10 50 15C45 20 37 20 33 17Z" fill="#4CAF50" stroke="#000000" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M32 18C32 13 33.5 9 36 6" stroke="#000000" strokeWidth="3.5" strokeLinecap="round" />
                  <path d="M32 18C18.5 18 10 27 10 39.5C10 52 19.5 58 32 58C44.5 58 54 52 54 39.5C54 27 45.5 18 32 18Z" fill="#FF9800" stroke="#000000" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M27 21C29.5 22.5 34.5 22.5 37 21" stroke="#000000" strokeWidth="3" strokeLinecap="round" />
                  <path d="M17.5 35C18.5 29 22.5 25.5 27.5 24.5" stroke="#000000" strokeWidth="3" strokeLinecap="round" />
                  <circle cx="44" cy="43" r="1.8" fill="#000000" />
                  <circle cx="39.5" cy="48.5" r="1.6" fill="#000000" />
                  <circle cx="46" cy="37" r="1.5" fill="#000000" />
                </g>
                <text x="58" y="34" fontFamily="'Cookie', cursive, sans-serif" fontSize="23" fontWeight="bold" fill="#000000">
                  Buy Me Some Oranges
                </text>
              </svg>
            </a>

            <a
              href="https://github.com/scrawnysatyr"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden md:inline-flex items-center gap-1.5 rounded-[10px] border border-white/10 bg-[#27272c] px-3 py-1.5 text-xs font-medium text-[#d4d4d8] transition-colors hover:border-[#ff7300] hover:bg-[#303036] hover:text-white"
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
                <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11.02 11.02 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.62 1.59.23 2.76.11 3.05.74.8 1.18 1.83 1.18 3.09 0 4.42-2.69 5.4-5.26 5.68.41.36.78 1.06.78 2.14 0 1.55-.01 2.8-.01 3.18 0 .31.21.66.79.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
              </svg>
              <span>@scrawnysatyr</span>
            </a>

            {/* Language Switcher */}
            <LanguageSelector lang={lang} onChange={setLang} />
          </div>
        </header>

        {/* Full-Height Left & Right Ad Rails + Symmetrical 50/50 Center Workspace */}
        <div className="flex min-h-0 flex-1 gap-3.5">
          {/* Left Full-Height Ad Banner */}
          <aside className="hidden xl:flex w-[180px] shrink-0 rounded-2xl border border-white/10 bg-[#18181b]/95 p-3 shadow-lg backdrop-blur-xl flex-col gap-2">
            <div className="flex items-center justify-between px-1">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[#ff9440]">
                <Megaphone className="h-3 w-3 text-[#ff7300]" />
                Sponsored
              </span>
              <span className="text-[10px] text-[#8a8a93]">Ad</span>
            </div>
            <div className="flex flex-1 min-h-0 flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-[#202024]/70 p-3 text-center">
              <LeftAdBanner />
            </div>
          </aside>

          {/* Split Workspace: Symmetrical 50/50 Left & Right Panels */}
          <main className="grid min-h-0 flex-1 gap-3.5 lg:grid-cols-2">
            {/* Left Column: Input */}
            <div className="flex min-h-0 flex-col gap-3">
            <DropZone
              t={t}
              selectedFile={selectedFile}
              normalizedDoc={normalizedDoc}
              selectedPageNumber={selectedPageNumber}
              ocrCompletedPages={Object.fromEntries(
                Object.entries(pageMarkdowns).map(([k, v]) => [Number(k), v.trim().length > 0]),
              )}
              pdfScale={pdfScale}
              disabled={isProcessing}
              onSelectPage={setSelectedPageNumber}
              onPdfScaleChange={handlePdfScaleChange}
              onFileSelected={(file) => void handleNormalizeFile(file, pdfScale)}
              onClearFile={handleClearFile}
            />

            <ModelSelector
              t={t}
              lang={lang === 'th' ? 'th' : 'en'}
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
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff7300] px-6 py-2.5 text-sm font-bold text-[#050505] shadow-[0_0_24px_rgba(255,115,0,0.28)] transition-all hover:bg-[#ff8826] disabled:cursor-not-allowed disabled:opacity-40"
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
          <div className="flex min-h-0 flex-col">
            <PreviewPane
              t={t}
              lang={lang === 'th' ? 'th' : 'en'}
              selectedPage={
                normalizedDoc?.pages.find((p) => p.pageNumber === selectedPageNumber) ?? null
              }
              pageMarkdown={
                selectedPageNumber !== null ? pageMarkdowns[selectedPageNumber] ?? '' : ''
              }
              hasAnyOcrResult={resultMarkdown.trim().length > 0}
              isExportingDocx={isExportingDocx}
              onChangePageMarkdown={(val) => {
                if (selectedPageNumber === null) return;
                const nextMap = { ...pageMarkdowns, [selectedPageNumber]: val };
                setPageMarkdowns(nextMap);
                const combined = (normalizedDoc?.pages ?? [])
                  .map((p) => (nextMap[p.pageNumber] ?? '').trim())
                  .filter(Boolean)
                  .join('\n\n---\n\n');
                setResultMarkdown(combined);
              }}
              onExportDocx={() => void handleExportDocx()}
              onExportMd={handleExportMd}
              onExportTxt={handleExportTxt}
            />
          </div>
          </main>

          {/* Right Full-Height Ad Banner */}
          <aside className="hidden xl:flex w-[180px] shrink-0 rounded-2xl border border-white/10 bg-[#18181b]/95 p-3 shadow-lg backdrop-blur-xl flex-col gap-2">
            <div className="flex items-center justify-between px-1">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[#ff9440]">
                <Megaphone className="h-3 w-3 text-[#ff7300]" />
                Sponsored
              </span>
              <span className="text-[10px] text-[#8a8a93]">Ad</span>
            </div>
            <div className="flex flex-1 min-h-0 flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-[#202024]/70 p-3 text-center">
              <LeftAdBanner />
            </div>
          </aside>
        </div>

        {/* Footer */}
        <footer className="shrink-0 border-t border-[#222226]/70 pt-2 text-center text-[11px] text-[#8a8a93]">
          {t.privacyFooter}
        </footer>
      </div>
    </div>
  );
}

export default App;
