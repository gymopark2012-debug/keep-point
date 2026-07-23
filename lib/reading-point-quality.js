export const MIN_POINTS = 3;
export const MAX_POINTS = 8;
export const MIN_LABEL_LEN = 2;
export const MAX_LABEL_LEN = 16;

export const GENERIC_PATTERNS = [
  /^시작$/,
  /^마무리$/,
  /^(전|중|후)반(부)?$/,
  /^시작\s*부분$/,
  /^앞부분$/,
  /^배경과\s*전개$/,
  /^핵심\s*전환$/,
  /^중반\s*이야기$/,
  /^정리와\s*마무리$/,
  /^서론$/,
  /^본론$/,
  /^결론$/,
  /^introduction$/i,
  /^conclusion$/i,
  /^references$/i,
  /^목차$/,
  /^share$/i,
  /^related$/i
];

export function clampLabel(text) {
  return String(text || "")
    .replace(/^[\d.)\s\-•]+/, "")
    .replace(/^["'「『]|["'」』]$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LABEL_LEN);
}

export function isGenericReadingPoint(text) {
  const label = clampLabel(text);
  if (!label || label.length < MIN_LABEL_LEN) return true;
  return GENERIC_PATTERNS.some((re) => re.test(label));
}

export function sanitizeLabelList(labels) {
  const unique = [];
  for (const raw of labels || []) {
    const label = clampLabel(typeof raw === "string" ? raw : raw?.label || raw);
    if (!label || isGenericReadingPoint(label)) continue;
    if (unique.some((item) => item.toLowerCase() === label.toLowerCase())) continue;
    unique.push(label);
  }
  return unique.slice(0, MAX_POINTS);
}

export function validateReadingPoints(points, { requireSection = false } = {}) {
  if (!Array.isArray(points) || points.length < MIN_POINTS || points.length > MAX_POINTS) {
    return { ok: false, points: [] };
  }

  const cleaned = [];
  for (const raw of points) {
    const label = clampLabel(raw?.label);
    if (!label || isGenericReadingPoint(label)) continue;
    if (requireSection && !raw?.sectionId) continue;
    if (cleaned.some((p) => p.label.toLowerCase() === label.toLowerCase())) continue;
    cleaned.push({
      id: raw.id || `rp-${cleaned.length}`,
      label,
      order: typeof raw.order === "number" ? raw.order : cleaned.length,
      sectionId: raw.sectionId || "",
      source: raw.source || "ai"
    });
  }

  cleaned.sort((a, b) => a.order - b.order);
  cleaned.forEach((p, i) => {
    p.order = i;
  });

  if (cleaned.length < MIN_POINTS) {
    return { ok: false, points: [] };
  }

  return { ok: true, points: cleaned.slice(0, MAX_POINTS) };
}

export function labelsFromPoints(points) {
  return (points || []).map((p) => p.label);
}
