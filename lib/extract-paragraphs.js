import { getContentRoot, isInsideExcluded, loadPage } from "./content-root.js";

export function extractParagraphs(html, { maxParagraphs = 12, maxTotalChars = 2800 } = {}) {
  const $ = loadPage(html);
  const root = getContentRoot($);
  const paragraphs = [];
  let total = 0;

  root.find("p").each((_, el) => {
    if (isInsideExcluded($, el)) return;
    if (paragraphs.length >= maxParagraphs || total >= maxTotalChars) return;

    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length < 48) return;

    const slice = text.slice(0, 420);
    paragraphs.push(slice);
    total += slice.length;
  });

  return paragraphs;
}
