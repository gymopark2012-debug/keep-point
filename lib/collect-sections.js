import { analyzeSections, getMeaningfulSections } from "./analyze-sections.js";
import { extractHeadings } from "./extract-headings.js";
import {
  descriptionPhraseCandidates,
  extractParagraphCandidates
} from "./extract-paragraph-candidates.js";
import { extractMetaStructure } from "./extract-meta-structure.js";
import { MIN_POINTS } from "./reading-point-quality.js";
import { uniqueTitles } from "./content-root.js";

function sectionsFromTitles(html, pageTitle, titles, method, inMainContent = true) {
  const headings = titles.map((text, order) => ({
    id: `${method}-${order}`,
    level: 2,
    text,
    order,
    inMainContent,
    textLengthHint: 120
  }));
  const sections = analyzeSections(html, headings, pageTitle);
  const meaningful = getMeaningfulSections(sections);
  if (meaningful.length < MIN_POINTS) return null;
  return { sections: meaningful, method };
}

export function collectStructureCandidates(html, pageTitle, description = "") {
  const headingList = extractHeadings(html);
  const fromHeadings = analyzeSections(html, headingList, pageTitle);
  const headingSections = getMeaningfulSections(fromHeadings);
  if (headingSections.length >= MIN_POINTS) {
    return { sections: headingSections, method: "headings" };
  }

  const paragraphTitles = extractParagraphCandidates(html);
  const fromParagraphs = sectionsFromTitles(html, pageTitle, paragraphTitles, "paragraphs");
  if (fromParagraphs) return fromParagraphs;

  const metaTitles = uniqueTitles([
    ...extractMetaStructure(html),
    ...descriptionPhraseCandidates(description)
  ]);
  const fromMeta = sectionsFromTitles(html, pageTitle, metaTitles, "meta");
  if (fromMeta) return fromMeta;

  return { sections: [], method: "none" };
}
