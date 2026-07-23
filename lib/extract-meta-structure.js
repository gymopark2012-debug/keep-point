import { cleanHeadingText, isNoiseHeading, loadPage, uniqueTitles } from "./content-root.js";

function metaContents($, selector) {
  const values = [];
  $(selector).each((_, el) => {
    const content = $(el).attr("content")?.trim();
    if (content) values.push(content);
  });
  return values;
}

export function extractMetaStructure(html) {
  const $ = loadPage(html);
  const titles = [];

  metaContents($, 'meta[property="article:section"]').forEach((v) => titles.push(v));
  metaContents($, 'meta[name="article:section"]').forEach((v) => titles.push(v));
  metaContents($, 'meta[property="article:tag"]').forEach((v) => titles.push(v));

  const keywords = $('meta[name="keywords"]').attr("content") || "";
  if (keywords) {
    keywords
      .split(/[,;|]/)
      .map((k) => cleanHeadingText(k))
      .filter((k) => k.length >= 2 && k.length <= 24 && !isNoiseHeading(k))
      .forEach((k) => titles.push(k));
  }

  const sections = metaContents($, 'meta[property="og:article:section"]');
  sections.forEach((v) => titles.push(v));

  return uniqueTitles(titles);
}
