import * as cheerio from "cheerio";

export const CONTENT_ROOT_SELECTORS = [
  "article",
  "[role='main']",
  "main",
  ".post-content",
  ".entry-content",
  ".article-body",
  ".article-content",
  ".markdown-body",
  "#content",
  ".content"
];

export const EXCLUDED_ANCESTOR_SELECTORS =
  "nav, footer, header.site-header, .sidebar, .widget, .comments, .comment-section, .related-posts, .share, [aria-hidden='true']";

export const NOISE_HEADING_PATTERNS = [
  /^share$/i,
  /^related$/i,
  /^목차$/,
  /^comments?$/i,
  /^댓글$/,
  /^footer$/i,
  /^sidebar$/i,
  /^navigation$/i,
  /^menu$/i,
  /^more\s+stories$/i,
  /^읽을거리$/,
  /^태그$/,
  /^카테고리$/,
  /^작성자$/,
  /^author$/i,
  /^table\s+of\s+contents$/i
];

export function loadPage(html) {
  return cheerio.load(html || "", { decodeEntities: false });
}

export function getContentRoot($) {
  for (const selector of CONTENT_ROOT_SELECTORS) {
    const node = $(selector).first();
    if (node.length) return node;
  }
  return $("body");
}

export function cleanHeadingText(text) {
  return String(text || "")
    .replace(/^[\d.)\s\-•]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isNoiseHeading(text) {
  const cleaned = cleanHeadingText(text);
  if (!cleaned || cleaned.length < 2) return true;
  if (NOISE_HEADING_PATTERNS.some((re) => re.test(cleaned))) return true;
  if (/^https?:\/\//i.test(cleaned)) return true;
  return false;
}

export function isInsideExcluded($, el) {
  return $(el).parents(EXCLUDED_ANCESTOR_SELECTORS).length > 0;
}

export function uniqueTitles(titles) {
  const seen = new Set();
  const out = [];
  for (const raw of titles || []) {
    const text = cleanHeadingText(raw);
    if (!text || isNoiseHeading(text) || text.length > 80) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}
