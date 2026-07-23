import {
  cleanHeadingText,
  getContentRoot,
  isInsideExcluded,
  isNoiseHeading,
  loadPage,
  uniqueTitles
} from "./content-root.js";

function headingLevel(tagName) {
  const match = String(tagName || "").match(/^h([1-3])$/i);
  if (!match) return null;
  return Number(match[1]);
}

function siblingTextLength($, el) {
  let length = 0;
  let node = $(el).next();
  let steps = 0;
  while (node.length && steps < 8) {
    const tag = node.prop("tagName")?.toLowerCase?.() || "";
    if (/^h[1-3]$/.test(tag)) break;
    length += node.text().replace(/\s+/g, " ").trim().length;
    node = node.next();
    steps += 1;
  }
  return length;
}

function collectHeadingsInScope($, scope, inMainContent) {
  const headings = [];
  scope.find("h1, h2, h3").each((_, el) => {
    if (isInsideExcluded($, el)) return;
    const level = headingLevel(el.tagName);
    if (!level) return;
    const text = cleanHeadingText($(el).text());
    if (isNoiseHeading(text) || text.length > 80) return;
    headings.push({
      id: `h-${headings.length}`,
      level,
      text,
      order: headings.length,
      inMainContent,
      textLengthHint: siblingTextLength($, el)
    });
  });
  return headings;
}

export function extractHeadings(html) {
  const $ = loadPage(html);
  const contentRoot = getContentRoot($);
  const inMain = !contentRoot.is("body");
  let headings = collectHeadingsInScope($, contentRoot, inMain);

  if (headings.length === 0) {
    headings = collectHeadingsInScope($, $("body"), false);
  }

  return headings;
}

/** @deprecated use extractHeadings */
export function extractHeadingsFromHtml(html) {
  return extractHeadings(html).map((h) => h.text);
}
