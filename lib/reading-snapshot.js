export const SNAPSHOT_STATUS = {
  EMPTY: "empty",
  PROCESSING: "processing",
  READY: "ready",
  FAILED: "failed"
};

export function createReadingSnapshot({ linkId = "" } = {}) {
  const now = new Date().toISOString();
  return {
    id: `snap_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    linkId,
    screenshotRef: null,
    keyword: "",
    savedAt: now,
    status: SNAPSHOT_STATUS.EMPTY
  };
}

export function normalizeReadingSnapshot(raw, link) {
  if (!raw || typeof raw !== "object") {
    return createReadingSnapshot({ linkId: link?.id || "" });
  }

  const keyword =
    String(raw.keyword || "").trim() ||
    (Array.isArray(raw.keywords) ? String(raw.keywords[0] || "").trim() : "");

  let status = raw.status;
  if (!Object.values(SNAPSHOT_STATUS).includes(status)) {
    if (status === "completed") status = SNAPSHOT_STATUS.READY;
    else if (status === "forming") status = SNAPSHOT_STATUS.PROCESSING;
    else status = raw.screenshotRef ? SNAPSHOT_STATUS.READY : SNAPSHOT_STATUS.EMPTY;
  }

  return {
    id: String(raw.id || createReadingSnapshot().id),
    linkId: String(raw.linkId || link?.id || ""),
    screenshotRef: raw.screenshotRef || null,
    keyword: keyword.slice(0, 16),
    savedAt: raw.savedAt || raw.updatedAt || raw.createdAt || new Date().toISOString(),
    status
  };
}

export function hasScreenshot(snapshot) {
  return Boolean(snapshot?.screenshotRef);
}

export function getSnapshotKeyword(snapshot) {
  return String(snapshot?.keyword || "").trim();
}
