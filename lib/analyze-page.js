import { collectStructureCandidates } from "./collect-sections.js";
import { extractTitle } from "./extract-title.js";
import { extractParagraphs } from "./extract-paragraphs.js";
import { fetchPageHtml, siteNameFromUrl } from "./fetch-page.js";
import { generateReadingPoints } from "./generate-reading-points.js";
import { labelsFromPoints, MIN_POINTS } from "./reading-point-quality.js";
import { parseLinkMetaFromHtml } from "./fetch-link-meta.js";

export async function analyzePage(url, options = {}) {
  const html = options.html ?? (url ? await fetchPageHtml(url) : "");
  const siteName =
    options.siteName ||
    (html && url ? parseLinkMetaFromHtml(html, url).sourceName : "") ||
    siteNameFromUrl(url);

  const pageTitle = html
    ? extractTitle(html, url)
    : { text: siteName || "새 링크", source: "hostname", confidence: "low" };

  const parsedMeta = html && url ? parseLinkMetaFromHtml(html, url) : { description: "" };
  const collected = html
    ? collectStructureCandidates(html, pageTitle, parsedMeta.description || "")
    : { sections: [], method: "none" };
  const paragraphs = html ? extractParagraphs(html) : [];

  const pointResult = await generateReadingPoints({
    pageTitle,
    siteName,
    sections: collected.sections,
    paragraphs,
    structureMethod: collected.method,
    url,
    description: parsedMeta.description || ""
  });

  const readingPoints = pointResult.points;
  const ok = Boolean(pointResult.ok && readingPoints.length >= MIN_POINTS);
  const labels = labelsFromPoints(readingPoints);

  return {
    originalUrl: url || "",
    title: pageTitle,
    siteName,
    headings: collected.sections.map((s) => s.title),
    sections: collected.sections,
    readingPoints,
    meta: {
      siteName,
      analyzedAt: new Date().toISOString(),
      stage: ok ? "complete" : "partial",
      method: pointResult.method,
      structureMethod: collected.method
    },
    ok,
    points: labels,
    method: pointResult.method
  };
}

export async function analyzePageFromFields(body = {}) {
  const url = String(body?.url || "").trim();
  let title = String(body?.title || "").trim();
  let siteName = String(body?.siteName || "").trim();

  const result = await analyzePage(url);
  if (title && (!result.title.text || result.title.confidence === "low")) {
    result.title = { text: title, source: "client", confidence: "medium" };
  } else if (title) {
    result.title.text = title;
  }
  if (siteName) {
    result.siteName = siteName;
    result.meta.siteName = siteName;
  }

  return result;
}
