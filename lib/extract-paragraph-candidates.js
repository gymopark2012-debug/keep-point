import {
  cleanHeadingText,
  getContentRoot,
  isInsideExcluded,
  isNoiseHeading,
  loadPage,
  uniqueTitles
} from "./content-root.js";
import { clampLabel, isGenericReadingPoint } from "./reading-point-quality.js";

function phraseFromParagraph(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length < 48) return "";

  const firstClause = normalized.split(/[.!?…]\s+/)[0]?.trim() || normalized;
  const candidate = clampLabel(firstClause.slice(0, 28));
  if (candidate.length < 3 || isGenericReadingPoint(candidate)) return "";

  const words = candidate.split(/\s+/);
  if (words.length > 4) {
    return clampLabel(words.slice(0, 3).join(" "));
  }
  return candidate;
}

export function extractParagraphCandidates(html) {
  const $ = loadPage(html);
  const root = getContentRoot($);
  const candidates = [];

  root.find("p, li").each((_, el) => {
    if (isInsideExcluded($, el)) return;
    const tag = el.tagName?.toLowerCase?.() || "";
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length < 48) return;

    if (tag === "li") {
      const label = clampLabel(text.slice(0, 24));
      if (label.length >= 3 && !isGenericReadingPoint(label)) candidates.push(label);
      return;
    }

    const phrase = phraseFromParagraph(text);
    if (phrase) candidates.push(phrase);
  });

  return uniqueTitles(candidates).slice(0, 8);
}

export function descriptionPhraseCandidates(description) {
  const desc = String(description || "").trim();
  if (desc.length < 16) return [];

  const phrases = desc
    .split(/[.!?…]\s+|[,;|/]\s+/)
    .map((chunk) => clampLabel(cleanHeadingText(chunk)))
    .filter((chunk) => chunk.length >= 3 && chunk.length <= 16 && !isGenericReadingPoint(chunk));

  return uniqueTitles(phrases).slice(0, 6);
}
