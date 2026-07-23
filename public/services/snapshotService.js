import { runOcr } from "./ocrService.js";
import { processSnapshotKeyword } from "./aiService.js";

const IDB_NAME = "keepPointDB";
const IDB_VERSION = 2;
const IDB_SNAPSHOT_STORE = "snapshots";

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("localPdfs")) {
        db.createObjectStore("localPdfs", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(IDB_SNAPSHOT_STORE)) {
        db.createObjectStore(IDB_SNAPSHOT_STORE, { keyPath: "id" });
      }
    };
  });
}

export async function saveScreenshotToIdb(linkId, dataUrl) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_SNAPSHOT_STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(IDB_SNAPSHOT_STORE).put({
      id: linkId,
      dataUrl,
      updatedAt: new Date().toISOString()
    });
  });
}

export async function loadScreenshotFromIdb(linkId) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_SNAPSHOT_STORE, "readonly");
    const req = tx.objectStore(IDB_SNAPSHOT_STORE).get(linkId);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result?.dataUrl || null);
  });
}

export async function deleteScreenshotFromIdb(linkId) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_SNAPSHOT_STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(IDB_SNAPSHOT_STORE).delete(linkId);
  });
}

const runtimeTasks = new Map();
const previewCache = new Map();

export function getScreenshotPreview(linkId) {
  return previewCache.get(linkId) || null;
}

function ensureSnapshot(link) {
  if (!link.readingSnapshot) {
    link.readingSnapshot = {
      id: `snap_${Date.now().toString(36)}`,
      linkId: link.id,
      screenshotRef: null,
      keyword: "",
      savedAt: new Date().toISOString(),
      status: "empty"
    };
  }
  return link.readingSnapshot;
}

export async function saveReadingSnapshot(link, dataUrl, { onUpdate } = {}) {
  if (!link || !dataUrl || runtimeTasks.get(link.id)) return;
  const snap = ensureSnapshot(link);
  snap.screenshotRef = link.id;
  snap.status = "processing";
  snap.savedAt = new Date().toISOString();
  previewCache.set(link.id, dataUrl);
  onUpdate?.();

  const task = (async () => {
    try {
      await saveScreenshotToIdb(link.id, dataUrl);
      const ocrText = await runOcr(dataUrl);
      const result = await processSnapshotKeyword({
        screenshot: ocrText ? "" : dataUrl,
        ocrText,
        title: link.title,
        url: link.originalUrl || link.url
      });
      snap.keyword = String(result.keyword || "").trim().slice(0, 16);
      snap.status = "ready";
      snap.savedAt = new Date().toISOString();
      onUpdate?.();
      return snap;
    } catch (err) {
      console.error("[snapshotService]", err);
      snap.status = "failed";
      onUpdate?.();
      return snap;
    } finally {
      runtimeTasks.delete(link.id);
    }
  })();

  runtimeTasks.set(link.id, task);
  await task;
}

export async function hydrateSnapshotScreenshot(link) {
  if (!link?.id) return null;
  if (previewCache.has(link.id)) return previewCache.get(link.id);
  if (!link.readingSnapshot?.screenshotRef) return null;
  const dataUrl = await loadScreenshotFromIdb(link.id);
  if (dataUrl) previewCache.set(link.id, dataUrl);
  return dataUrl;
}

export { deleteScreenshotFromIdb };
