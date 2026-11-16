import type {
  CachedModelInfo,
  ModelArtifact,
  ModelDefinition,
} from '../types/ocr';

const CACHE_NAME = 'scrawny-ocr-models-v1';
const DB_NAME = 'scrawny-ocr-cache-meta';
const STORE_NAME = 'artifacts';

interface ArtifactMetaRecord {
  key: string;
  modelId: string;
  url: string;
  bytes: number;
  cachedAt: number;
}

function openMetaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('modelId', 'modelId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putArtifactMeta(record: ArtifactMetaRecord): Promise<void> {
  const db = await openMetaDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function deleteArtifactMeta(key: string): Promise<void> {
  const db = await openMetaDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function getAllArtifactMeta(): Promise<ArtifactMetaRecord[]> {
  const db = await openMetaDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      db.close();
      resolve((req.result as ArtifactMetaRecord[]) ?? []);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

/**
 * Requests persistent browser storage so cached AI models are not evicted
 * under normal disk pressure.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      const already = await navigator.storage.persisted();
      if (already) return true;
      return await navigator.storage.persist();
    }
  } catch {
    // Ignore in restricted contexts
  }
  return false;
}

export async function isPersistentStorageGranted(): Promise<boolean> {
  try {
    if (navigator.storage && typeof navigator.storage.persisted === 'function') {
      return await navigator.storage.persisted();
    }
  } catch {
    // Ignore
  }
  return false;
}

/**
 * Returns cache status and total cached bytes for a given model.
 */
export async function getModelCacheStatus(
  model: ModelDefinition,
): Promise<CachedModelInfo> {
  const records = await getAllArtifactMeta();
  const modelRecords = records.filter((r) => r.modelId === model.id);

  if (!('caches' in self)) {
    return {
      modelId: model.id,
      isCached: false,
      cachedBytes: 0,
      cachedAt: null,
      artifactCount: 0,
    };
  }

  const cache = await caches.open(CACHE_NAME);
  let verifiedBytes = 0;
  let verifiedCount = 0;
  let latestTimestamp: number | null = null;

  for (const artifact of model.artifacts) {
    const match = await cache.match(artifact.url);
    if (match) {
      verifiedCount++;
      const meta = modelRecords.find((r) => r.key === artifact.key);
      verifiedBytes += meta?.bytes ?? artifact.approxBytes;
      if (meta?.cachedAt) {
        latestTimestamp = Math.max(latestTimestamp ?? 0, meta.cachedAt);
      }
    }
  }

  return {
    modelId: model.id,
    isCached: verifiedCount === model.artifacts.length && model.artifacts.length > 0,
    cachedBytes: verifiedBytes,
    cachedAt: latestTimestamp,
    artifactCount: verifiedCount,
  };
}

export async function getTotalCacheBytes(): Promise<number> {
  const records = await getAllArtifactMeta();
  return records.reduce((sum, item) => sum + (item.bytes || 0), 0);
}

/**
 * Fetches an artifact with streaming progress and stores it permanently
 * in Cache Storage + IndexedDB metadata.
 */
async function fetchAndCacheArtifact(
  modelId: string,
  artifact: ModelArtifact,
  onChunk: (bytesReceived: number, totalBytes: number) => void,
): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  const existing = await cache.match(artifact.url);
  if (existing) {
    const buf = await existing.clone().arrayBuffer();
    onChunk(buf.byteLength, buf.byteLength);
    return;
  }

  const response = await fetch(artifact.url, { mode: 'cors' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while downloading ${artifact.label}`);
  }

  const contentLengthHeader = response.headers.get('content-length');
  const totalBytes = contentLengthHeader
    ? parseInt(contentLengthHeader, 10)
    : artifact.approxBytes;

  if (!response.body) {
    const buf = await response.arrayBuffer();
    await cache.put(
      artifact.url,
      new Response(buf, {
        headers: { 'Content-Type': 'application/octet-stream' },
      }),
    );
    await putArtifactMeta({
      key: artifact.key,
      modelId,
      url: artifact.url,
      bytes: buf.byteLength,
      cachedAt: Date.now(),
    });
    onChunk(buf.byteLength, buf.byteLength);
    return;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      onChunk(received, Math.max(totalBytes, received));
    }
  }

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  await cache.put(
    artifact.url,
    new Response(merged.buffer, {
      headers: { 'Content-Type': 'application/octet-stream' },
    }),
  );

  await putArtifactMeta({
    key: artifact.key,
    modelId,
    url: artifact.url,
    bytes: merged.byteLength,
    cachedAt: Date.now(),
  });
}

/**
 * Downloads and caches all artifacts for a model persistently on the device.
 */
export async function downloadAndCacheModel(
  model: ModelDefinition,
  onProgress?: (loaded: number, total: number, currentLabel: string) => void,
): Promise<void> {
  await requestPersistentStorage();

  const totalApprox = model.artifacts.reduce((acc, a) => acc + a.approxBytes, 0);
  let completedBytes = 0;

  for (const artifact of model.artifacts) {
    await fetchAndCacheArtifact(model.id, artifact, (received, artifactTotal) => {
      onProgress?.(
        completedBytes + received,
        Math.max(totalApprox, completedBytes + artifactTotal),
        artifact.label,
      );
    });
    completedBytes += artifact.approxBytes;
  }
}

/**
 * Reads a cached artifact from Cache Storage (usable inside Web Worker too).
 */
export async function getCachedArtifactBuffer(
  artifact: ModelArtifact,
): Promise<ArrayBuffer | null> {
  if (!('caches' in self)) return null;
  const cache = await caches.open(CACHE_NAME);
  const match = await cache.match(artifact.url);
  if (!match) return null;
  return match.arrayBuffer();
}

/**
 * Deletes cached artifacts for a single model.
 */
export async function deleteModelCache(model: ModelDefinition): Promise<void> {
  if ('caches' in self) {
    const cache = await caches.open(CACHE_NAME);
    for (const artifact of model.artifacts) {
      await cache.delete(artifact.url);
      await deleteArtifactMeta(artifact.key);
    }
  }
}

/**
 * Deletes the entire model cache storage and metadata database.
 */
export async function clearAllModelCaches(): Promise<void> {
  if ('caches' in self) {
    await caches.delete(CACHE_NAME);
  }
  const records = await getAllArtifactMeta();
  for (const rec of records) {
    await deleteArtifactMeta(rec.key);
  }
}

/**
 * Imports local .onnx / model files selected by the user directly into
 * persistent Cache Storage + IndexedDB metadata without needing a remote URL.
 */
export async function importLocalModelFiles(
  model: ModelDefinition,
  files: FileList | File[],
): Promise<number> {
  await requestPersistentStorage();
  const cache = await caches.open(CACHE_NAME);
  const fileArray = Array.from(files);
  let importedCount = 0;

  for (let i = 0; i < model.artifacts.length; i++) {
    const artifact = model.artifacts[i];
    // Match by filename substring or fallback to positional order
    const matchedFile =
      fileArray.find((f) => {
        const name = f.name.toLowerCase();
        if (artifact.key.includes('vision') || artifact.key.includes('det')) {
          return name.includes('vision') || name.includes('encoder') || name.includes('det');
        }
        if (artifact.key.includes('decoder') || artifact.key.includes('rec')) {
          return name.includes('decoder') || name.includes('rec');
        }
        return false;
      }) ?? fileArray[i];

    if (!matchedFile) continue;

    const buf = await matchedFile.arrayBuffer();
    await cache.put(
      artifact.url,
      new Response(buf, {
        headers: { 'Content-Type': 'application/octet-stream' },
      }),
    );
    await putArtifactMeta({
      key: artifact.key,
      modelId: model.id,
      url: artifact.url,
      bytes: buf.byteLength,
      cachedAt: Date.now(),
    });
    importedCount++;
  }

  return importedCount;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

