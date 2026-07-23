import { cleanHeadingText, isNoiseHeading, uniqueTitles } from "./content-root.js";

function pushTitle(out, value) {
  if (typeof value !== "string") return;
  const text = cleanHeadingText(value);
  if (text && !isNoiseHeading(text)) out.push(text);
}

function pushMany(out, values) {
  if (!values) return;
  if (Array.isArray(values)) {
    values.forEach((v) => {
      if (typeof v === "string") pushTitle(out, v);
      else if (v && typeof v === "object") pushTitle(out, v.name || v.headline || v.text);
    });
    return;
  }
  pushTitle(out, values);
}

function walkJsonLd(node, out, depth = 0) {
  if (!node || depth > 8) return;
  if (Array.isArray(node)) {
    node.forEach((item) => walkJsonLd(item, out, depth + 1));
    return;
  }
  if (typeof node !== "object") return;

  pushMany(out, node.articleSection);
  if (node.headline && typeof node.headline === "string") pushTitle(out, node.headline);

  if (node["@type"] === "HowTo" || (Array.isArray(node["@type"]) && node["@type"].includes("HowTo"))) {
    pushMany(
      out,
      (node.step || []).map((s) => (typeof s === "string" ? s : s?.name))
    );
  }

  if (node["@type"] === "FAQPage" || (Array.isArray(node["@type"]) && node["@type"].includes("FAQPage"))) {
    pushMany(
      out,
      (node.mainEntity || []).map((q) => q?.name)
    );
  }

  pushMany(out, node.hasPart);
  pushMany(
    out,
    (node.itemListElement || []).map((item) => item?.name || item?.item?.name)
  );

  for (const value of Object.values(node)) {
    if (value && typeof value === "object") walkJsonLd(value, out, depth + 1);
  }
}

export function extractJsonLdStructure(html) {
  const titles = [];
  const matches = String(html || "").match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  if (!matches) return [];

  for (const block of matches) {
    const inner = block.replace(/^[\s\S]*?>/, "").replace(/<\/script>\s*$/i, "").trim();
    if (!inner) continue;
    try {
      const parsed = JSON.parse(inner);
      walkJsonLd(parsed, titles);
    } catch {
      /* ignore invalid JSON-LD */
    }
  }

  return uniqueTitles(titles);
}
