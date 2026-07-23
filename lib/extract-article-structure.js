import {
  cleanHeadingText,
  getContentRoot,
  isInsideExcluded,
  isNoiseHeading,
  loadPage,
  uniqueTitles
} from "./content-root.js";

function titleFromSection($, el) {
  const node = $(el);
  const aria = node.attr("aria-label")?.trim();
  if (aria && !isNoiseHeading(aria)) return cleanHeadingText(aria);

  const labelledBy = node.attr("aria-labelledby");
  if (labelledBy) {
    const label = labelledBy
      .split(/\s+/)
      .map((id) => $(`#${id}`).text().replace(/\s+/g, " ").trim())
      .find(Boolean);
    if (label && !isNoiseHeading(label)) return cleanHeadingText(label);
  }

  const heading = node.find("h1, h2, h3, h4").first().text();
  if (heading && !isNoiseHeading(heading)) return cleanHeadingText(heading);

  const legend = node.find("legend").first().text();
  if (legend && !isNoiseHeading(legend)) return cleanHeadingText(legend);

  const dataTitle = node.attr("data-title") || node.attr("data-section-title");
  if (dataTitle && !isNoiseHeading(dataTitle)) return cleanHeadingText(dataTitle);

  return "";
}

export function extractArticleStructure(html) {
  const $ = loadPage(html);
  const root = getContentRoot($);
  const titles = [];

  root.find("section").each((_, el) => {
    if (isInsideExcluded($, el)) return;
    const title = titleFromSection($, el);
    if (title) titles.push(title);
  });

  root.find('[class*="section"], [class*="chapter"], [data-section]').each((_, el) => {
    if (isInsideExcluded($, el)) return;
    const tag = el.tagName?.toLowerCase?.() || "";
    if (tag === "section") return;
    const title = titleFromSection($, el);
    if (title) titles.push(title);
  });

  if (root.is("article, main, [role='main']")) {
    root.children("div, section").each((_, el) => {
      if (isInsideExcluded($, el)) return;
      const title = titleFromSection($, el);
      if (title && title.length <= 48) titles.push(title);
    });
  }

  return uniqueTitles(titles);
}
