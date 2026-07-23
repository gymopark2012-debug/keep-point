import * as cheerio from "cheerio";

const CONCLUSION_PATTERNS = [
  /^결론$/,
  /^마무리$/,
  /^conclusion$/i,
  /^summary$/i,
  /^references$/i,
  /^참고\s*문헌$/,
  /^부록$/,
  /^appendix$/i
];

const INTRO_PATTERNS = [/^서론$/, /^introduction$/i, /^개요$/, /^들어가며$/];

function normalizeTitle(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isDuplicateTitle(a, b) {
  return normalizeTitle(a) === normalizeTitle(b);
}

function classifyKind(title, index, total) {
  if (INTRO_PATTERNS.some((re) => re.test(title.trim()))) return "intro";
  if (CONCLUSION_PATTERNS.some((re) => re.test(title.trim()))) return "conclusion";
  if (/^references$|^참고|^부록|^appendix/i.test(title.trim())) return "appendix";
  if (index === 0 && total > 1) return "intro";
  if (index === total - 1 && CONCLUSION_PATTERNS.some((re) => re.test(title.trim()))) {
    return "conclusion";
  }
  return "body";
}

function sectionWeight(heading, pageTitleText) {
  let weight = 0;
  if (heading.inMainContent) weight += 0.3;
  if (heading.level === 2) weight += 0.2;
  else if (heading.level === 1) weight += 0.15;
  else weight += 0.1;
  if ((heading.textLengthHint || 0) > 200) weight += 0.2;
  else if ((heading.textLengthHint || 0) > 80) weight += 0.1;
  else weight += 0.05;
  if (!isDuplicateTitle(heading.text, pageTitleText)) weight += 0.25;
  else weight += 0.05;
  return Math.min(1, weight);
}

function trimSections(sections, maxCount = 12) {
  if (sections.length <= maxCount) return sections;
  return [...sections]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxCount)
    .sort((a, b) => a.order - b.order);
}

export function analyzeSections(html, headings, pageTitle) {
  const pageTitleText = pageTitle?.text || "";
  const $ = cheerio.load(html || "", { decodeEntities: false });
  void $;

  if (!Array.isArray(headings) || headings.length === 0) {
    return [];
  }

  const candidates = [];
  let lastTitle = "";

  for (const heading of headings) {
    if (isDuplicateTitle(heading.text, lastTitle)) continue;
    if (isDuplicateTitle(heading.text, pageTitleText) && heading.level === 1) continue;

    lastTitle = heading.text;
    candidates.push(heading);
  }

  const rawSections = candidates.map((heading, index) => {
    const weight = sectionWeight(heading, pageTitleText);
    const kind = classifyKind(heading.text, index, candidates.length);
    return {
      id: `sec-${index}`,
      order: index,
      title: heading.text,
      headingLevel: heading.level,
      sourceHeadingIds: [heading.id],
      kind,
      weight,
      inMainContent: Boolean(heading.inMainContent),
      isMeaningful: weight >= 0.4 && kind !== "appendix"
    };
  });

  const trimmed = trimSections(rawSections);
  return trimmed.map((section, index) => ({
    ...section,
    id: `sec-${index}`,
    order: index
  }));
}

export function getMeaningfulSections(sections) {
  return (sections || []).filter((s) => s.isMeaningful);
}

export function sectionByOrder(sections, sectionOrder) {
  const index = Number(sectionOrder) - 1;
  if (!Number.isFinite(index) || index < 0) return null;
  return sections[index] || null;
}
