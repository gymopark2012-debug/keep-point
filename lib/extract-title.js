import * as cheerio from "cheerio";

function stripSiteSuffix(title) {
  return String(title || "")
    .trim()
    .replace(/\s*[-|·|:]\s*[^-|·|:]+$/, "")
    .trim();
}

function pickMainH1($) {
  const scoped = $("article h1, main h1, [role='main'] h1").first();
  if (scoped.length) return scoped.text().replace(/\s+/g, " ").trim();
  const first = $("h1").first();
  if (first.length) return first.text().replace(/\s+/g, " ").trim();
  return "";
}

export function extractTitle(html, pageUrl) {
  const $ = cheerio.load(html || "", { decodeEntities: false });
  const hostname = (() => {
    try {
      return new URL(pageUrl).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();

  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim() || "";
  if (ogTitle.length >= 2) {
    return { text: ogTitle.slice(0, 120), source: "og:title", confidence: "high" };
  }

  const twitterTitle = $('meta[name="twitter:title"]').attr("content")?.trim() || "";
  if (twitterTitle.length >= 2) {
    return { text: twitterTitle.slice(0, 120), source: "twitter:title", confidence: "high" };
  }

  const mainH1 = pickMainH1($);
  if (mainH1.length >= 2) {
    return { text: mainH1.slice(0, 120), source: "h1", confidence: "high" };
  }

  const docTitle = stripSiteSuffix($("title").first().text().replace(/\s+/g, " ").trim());
  if (docTitle.length >= 2 && docTitle.toLowerCase() !== hostname.toLowerCase()) {
    return { text: docTitle.slice(0, 120), source: "title", confidence: "medium" };
  }

  if (hostname) {
    return { text: hostname, source: "hostname", confidence: "low" };
  }

  return { text: "새 링크", source: "hostname", confidence: "low" };
}
