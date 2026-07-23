import { clampLabel, isGenericReadingPoint, MIN_POINTS, sanitizeLabelList } from "./reading-point-quality.js";

function splitTitleWords(title) {
  return String(title || "")
    .replace(/[^\p{L}\p{N}\s\-·]/gu, " ")
    .split(/[\s\-·/|:]+/)
    .map((w) => clampLabel(w))
    .filter((w) => w.length >= 2);
}

function pathSegments(url) {
  try {
    return new URL(url)
      .pathname.split("/")
      .map((part) => decodeURIComponent(part).replace(/[-_]+/g, " "))
      .map((part) => clampLabel(part))
      .filter((part) => part.length >= 2 && !/^\d+$/.test(part));
  } catch {
    return [];
  }
}

function descriptionPhrases(description) {
  const desc = String(description || "").trim();
  if (desc.length < 12) return [];
  return desc
    .split(/[.!?…]\s+|[,;|/]\s+/)
    .map((chunk) => clampLabel(chunk))
    .filter((chunk) => chunk.length >= 3 && !isGenericReadingPoint(chunk));
}

export function fallbackMemoryAnchors({ pageTitle, url, description, siteName }) {
  const candidates = [];
  const titleText = pageTitle?.text || "";

  splitTitleWords(titleText).forEach((w) => candidates.push(w));

  if (titleText.includes(":")) {
    titleText
      .split(":")
      .map((part) => clampLabel(part))
      .filter(Boolean)
      .forEach((part) => candidates.push(part));
  }

  pathSegments(url).forEach((part) => candidates.push(part));
  descriptionPhrases(description).slice(0, 4).forEach((part) => candidates.push(part));

  if (siteName && siteName.length >= 3) {
    candidates.push(clampLabel(siteName));
  }

  const labels = sanitizeLabelList(candidates);
  return labels.length >= MIN_POINTS ? labels.slice(0, 8) : [];
}

export function anchorsToReadingPoints(labels) {
  return labels.map((label, index) => ({
    id: `rp-${index}`,
    label,
    order: index,
    sectionId: "",
    source: "fallback-anchor"
  }));
}
