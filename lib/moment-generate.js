import {
  CUE_TYPES,
  MOMENT_STATUS,
  createRecallCue,
  createReadingMoment,
  upsertSecondaryCue
} from "./reading-moment.js";
import { refineMomentFromMeta } from "./moment-ai.js";

function cleanTitle(title) {
  return String(title || "")
    .replace(/\s*[|\-–—·:]\s*.+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function heuristicKeywordFromMeta({ title, siteName, url }) {
  const cleaned = cleanTitle(title);
  if (cleaned && cleaned.length >= 2) return cleaned.slice(0, 16);
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").split(".")[0];
    if (host) return host.slice(0, 16);
  } catch {
    /* ignore */
  }
  return String(siteName || "읽던 순간").slice(0, 16);
}

export function heuristicExcerptFromMeta(description, title) {
  const desc = String(description || "").replace(/\s+/g, " ").trim();
  if (desc.length >= 12) return desc.slice(0, 120);
  const t = cleanTitle(title);
  return t.length >= 8 ? t.slice(0, 120) : "";
}

export async function buildMomentPayload({ linkId, url, title, siteName, description, ogImage }) {
  const heuristicKeyword = heuristicKeywordFromMeta({ title, siteName, url });
  const heuristicExcerpt = heuristicExcerptFromMeta(description, title);

  const refined = await refineMomentFromMeta({
    title,
    url,
    siteName,
    description,
    heuristicKeyword,
    heuristicExcerpt
  });

  const moment = createReadingMoment({ linkId, url, title, siteName });
  moment.recall.primary = createRecallCue(CUE_TYPES.KEYWORD, refined.keyword || heuristicKeyword, {
    weight: 90
  });

  if (refined.excerpt || heuristicExcerpt) {
    upsertSecondaryCue(
      moment,
      createRecallCue(CUE_TYPES.EXCERPT, refined.excerpt || heuristicExcerpt, { weight: 70 })
    );
  }

  if (ogImage) {
    upsertSecondaryCue(moment, createRecallCue(CUE_TYPES.VISUAL, ogImage, { weight: 75 }));
  }

  moment.provenance = {
    method: "auto",
    sources: refined.source === "ai" ? ["meta", "title", "ai"] : ["meta", "title"],
    confidence: refined.excerpt || heuristicExcerpt ? "medium" : "low"
  };
  moment.status = MOMENT_STATUS.READY;
  moment.context.pageTitle = title || moment.context.pageTitle;
  moment.context.siteName = siteName || moment.context.siteName;
  moment.context.originalUrl = url || moment.context.originalUrl;

  return moment;
}
