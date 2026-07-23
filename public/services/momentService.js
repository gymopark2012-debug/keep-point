import { runOcr } from "./ocrService.js";
import { enrichMomentFromScreenshot, generateMomentFromApi } from "./momentApi.js";

const IDB_NAME = "keepPointDB";
const IDB_VERSION = 2;
const IDB_VISUAL_STORE = "snapshots";

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
      if (!db.objectStoreNames.contains(IDB_VISUAL_STORE)) {
        db.createObjectStore(IDB_VISUAL_STORE, { keyPath: "id" });
      }
    };
  });
}

export async function saveVisualToIdb(linkId, dataUrl) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_VISUAL_STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(IDB_VISUAL_STORE).put({
      id: linkId,
      dataUrl,
      updatedAt: new Date().toISOString()
    });
  });
}

export async function loadVisualFromIdb(linkId) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_VISUAL_STORE, "readonly");
    const req = tx.objectStore(IDB_VISUAL_STORE).get(linkId);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result?.dataUrl || null);
  });
}

export async function deleteVisualFromIdb(linkId) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_VISUAL_STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(IDB_VISUAL_STORE).delete(linkId);
  });
}

const runtimeTasks = new Map();
const visualPreviewCache = new Map();

export function getVisualPreview(linkId) {
  return visualPreviewCache.get(linkId) || null;
}

function ensureMoment(link) {
  if (!link.readingMoment) {
    link.readingMoment = {
      id: `moment_${Date.now().toString(36)}`,
      linkId: link.id,
      recall: {
        primary: { type: "keyword", value: link.title?.slice(0, 16) || "읽던 순간", weight: 80 },
        secondary: []
      },
      context: {
        momentAt: new Date().toISOString(),
        savedAt: new Date().toISOString(),
        siteName: link.sourceName || "",
        pageTitle: link.title || "",
        originalUrl: link.originalUrl || link.url || ""
      },
      provenance: { method: "auto", sources: [], confidence: "low" },
      status: "forming"
    };
  }
  return link.readingMoment;
}

function upsertVisualCue(moment, linkId) {
  const secondary = Array.isArray(moment.recall?.secondary) ? moment.recall.secondary : [];
  const withoutVisual = secondary.filter((c) => c.type !== "visual");
  withoutVisual.unshift({ type: "visual", value: "", assetRef: linkId, weight: 95 });
  moment.recall.secondary = withoutVisual;
}

export async function generateMomentForLink(link, { onUpdate } = {}) {
  if (!link || runtimeTasks.get(`gen_${link.id}`)) return link?.readingMoment;
  if (link.readingMoment?.status === "ready" && (link.readingMoment.provenance?.sources?.length || 0) > 0) {
    return link.readingMoment;
  }
  const taskKey = `gen_${link.id}`;
  const moment = ensureMoment(link);
  moment.status = "forming";
  onUpdate?.();

  const task = (async () => {
    try {
      const { moment: generated } = await generateMomentFromApi({
        linkId: link.id,
        url: link.originalUrl || link.url,
        title: link.title,
        siteName: link.sourceName,
        description: link.description,
        ogImage: link.ogImage
      });
      link.readingMoment = { ...generated, linkId: link.id };
      if (link.ogImage) {
        const hasOgVisual = link.readingMoment.recall?.secondary?.some(
          (c) => c.type === "visual" && c.value === link.ogImage
        );
        if (!hasOgVisual && link.readingMoment.recall) {
          link.readingMoment.recall.secondary = [
            ...(link.readingMoment.recall.secondary || []),
            { type: "visual", value: link.ogImage, weight: 75 }
          ];
        }
      }
      link.readingMoment.status = "ready";
      onUpdate?.();
      return link.readingMoment;
    } catch (err) {
      console.error("[momentService.generate]", err);
      moment.status = "ready";
      moment.recall.primary.value = link.title?.slice(0, 16) || moment.recall.primary.value;
      onUpdate?.();
      return moment;
    } finally {
      runtimeTasks.delete(taskKey);
    }
  })();

  runtimeTasks.set(taskKey, task);
  return task;
}

export async function enhanceMomentWithVisual(link, dataUrl, { onUpdate } = {}) {
  if (!link || !dataUrl || runtimeTasks.get(`vis_${link.id}`)) return;
  const taskKey = `vis_${link.id}`;
  const moment = ensureMoment(link);
  moment.status = "forming";
  upsertVisualCue(moment, link.id);
  visualPreviewCache.set(link.id, dataUrl);
  onUpdate?.();

  const task = (async () => {
    try {
      await saveVisualToIdb(link.id, dataUrl);
      const ocrText = await runOcr(dataUrl);
      const result = await enrichMomentFromScreenshot({ link, dataUrl, ocrText });
      if (result.keywords?.[0]) {
        moment.recall.primary = { type: "keyword", value: result.keywords[0], weight: 92 };
      }
      if (result.excerpt) {
        const secondary = (moment.recall.secondary || []).filter((c) => c.type !== "excerpt");
        secondary.push({ type: "excerpt", value: result.excerpt, weight: 82 });
        moment.recall.secondary = secondary;
      }
      moment.provenance.method = "paste";
      moment.provenance.sources = [...new Set([...(moment.provenance.sources || []), "screenshot", "ocr"])];
      moment.provenance.confidence = "high";
      moment.context.savedAt = new Date().toISOString();
      moment.status = "ready";
      onUpdate?.();
    } catch (err) {
      console.error("[momentService.enhanceVisual]", err);
      moment.status = "ready";
      onUpdate?.();
    } finally {
      runtimeTasks.delete(taskKey);
    }
  })();

  runtimeTasks.set(taskKey, task);
  await task;
}

export function boostMomentKeyword(link, keyword) {
  const label = String(keyword || "").trim().slice(0, 16);
  if (!label) return false;
  const moment = ensureMoment(link);
  moment.recall.primary = { type: "keyword", value: label, weight: 88 };
  moment.provenance.method = "manual";
  moment.provenance.sources = [...new Set([...(moment.provenance.sources || []), "user"])];
  moment.context.savedAt = new Date().toISOString();
  moment.status = "ready";
  return true;
}

export async function hydrateMomentVisual(link) {
  if (!link?.id) return null;
  if (visualPreviewCache.has(link.id)) return visualPreviewCache.get(link.id);

  const visualCue = link.readingMoment?.recall?.secondary?.find((c) => c.type === "visual");
  if (visualCue?.value && visualCue.value.startsWith("http")) return visualCue.value;
  if (visualCue?.assetRef) {
    const dataUrl = await loadVisualFromIdb(link.id);
    if (dataUrl) {
      visualPreviewCache.set(link.id, dataUrl);
      return dataUrl;
    }
  }
  return null;
}

export { deleteVisualFromIdb };
