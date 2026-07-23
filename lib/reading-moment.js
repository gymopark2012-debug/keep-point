export const MOMENT_STATUS = {
  FORMING: "forming",
  READY: "ready",
  STALE: "stale"
};

export const CUE_TYPES = {
  KEYWORD: "keyword",
  VISUAL: "visual",
  EXCERPT: "excerpt",
  TITLE: "title"
};

export function createRecallCue(type, value, { weight = 50, assetRef = null } = {}) {
  return {
    type,
    value: String(value || "").trim(),
    weight,
    ...(assetRef ? { assetRef } : {})
  };
}

export function createReadingMoment({ linkId, url = "", title = "", siteName = "" } = {}) {
  const now = new Date().toISOString();
  const fallbackKeyword = title.slice(0, 16) || siteName.slice(0, 16) || "읽던 순간";
  return {
    id: `moment_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    linkId: linkId || "",
    recall: {
      primary: createRecallCue(CUE_TYPES.KEYWORD, fallbackKeyword, { weight: 80 }),
      secondary: []
    },
    context: {
      momentAt: now,
      savedAt: now,
      siteName,
      pageTitle: title,
      originalUrl: url
    },
    provenance: {
      method: "auto",
      sources: [],
      confidence: "low"
    },
    status: MOMENT_STATUS.FORMING
  };
}

export function normalizeReadingMoment(raw, link) {
  if (!raw || typeof raw !== "object") {
    return createReadingMoment({
      linkId: link?.id,
      url: link?.originalUrl || link?.url,
      title: link?.title,
      siteName: link?.sourceName
    });
  }

  const now = new Date().toISOString();
  const primary = raw.recall?.primary || raw.recall?.Primary;
  const secondaryRaw = raw.recall?.secondary || raw.recall?.Secondary || [];

  const normalizeCue = (cue) => {
    if (!cue || typeof cue !== "object") return null;
    const type = cue.type || CUE_TYPES.KEYWORD;
    const value = String(cue.value || "").trim();
    if (!value && !cue.assetRef) return null;
    return {
      type,
      value,
      weight: Number(cue.weight) || 50,
      ...(cue.assetRef ? { assetRef: String(cue.assetRef) } : {})
    };
  };

  const secondary = Array.isArray(secondaryRaw)
    ? secondaryRaw.map(normalizeCue).filter(Boolean).slice(0, 3)
    : [];

  const normalizedPrimary =
    normalizeCue(primary) ||
    createRecallCue(CUE_TYPES.KEYWORD, link?.title?.slice(0, 16) || "읽던 순간", { weight: 80 });

  return {
    id: String(raw.id || createReadingMoment().id),
    linkId: String(raw.linkId || link?.id || ""),
    recall: { primary: normalizedPrimary, secondary },
    context: {
      momentAt: raw.context?.momentAt || raw.context?.savedAt || now,
      savedAt: raw.context?.savedAt || now,
      siteName: String(raw.context?.siteName || link?.sourceName || ""),
      pageTitle: String(raw.context?.pageTitle || link?.title || ""),
      originalUrl: String(raw.context?.originalUrl || link?.originalUrl || link?.url || "")
    },
    provenance: {
      method: raw.provenance?.method || "auto",
      sources: Array.isArray(raw.provenance?.sources) ? raw.provenance.sources : [],
      confidence: raw.provenance?.confidence || "medium"
    },
    status: [MOMENT_STATUS.FORMING, MOMENT_STATUS.READY, MOMENT_STATUS.STALE].includes(raw.status)
      ? raw.status
      : MOMENT_STATUS.READY
  };
}

export function getPrimaryKeyword(moment) {
  if (!moment?.recall?.primary) return "";
  const p = moment.recall.primary;
  if (p.type === CUE_TYPES.KEYWORD || p.type === CUE_TYPES.TITLE) return p.value;
  return p.value.slice(0, 24);
}

export function getExcerptCue(moment) {
  return moment?.recall?.secondary?.find((c) => c.type === CUE_TYPES.EXCERPT) || null;
}

export function getVisualCue(moment) {
  return moment?.recall?.secondary?.find((c) => c.type === CUE_TYPES.VISUAL) || null;
}

export function upsertSecondaryCue(moment, cue) {
  if (!moment.recall) moment.recall = { primary: createRecallCue(CUE_TYPES.KEYWORD, ""), secondary: [] };
  if (!Array.isArray(moment.recall.secondary)) moment.recall.secondary = [];
  const idx = moment.recall.secondary.findIndex((c) => c.type === cue.type);
  if (idx >= 0) moment.recall.secondary[idx] = cue;
  else moment.recall.secondary.push(cue);
  moment.recall.secondary.sort((a, b) => (b.weight || 0) - (a.weight || 0));
  return moment;
}
