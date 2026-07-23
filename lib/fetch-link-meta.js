import * as cheerio from "cheerio";

const FETCH_TIMEOUT_MS = 12000;
const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; KeepPoint/1.0; +https://keeppoint.app)",
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"
};

function resolveImageUrl(raw, pageUrl) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    return new URL(value, pageUrl).href;
  } catch {
    return value.startsWith("http") ? value : "";
  }
}

export function parseLinkMetaFromHtml(html, pageUrl) {
  const $ = cheerio.load(html || "", { decodeEntities: false });
  const title =
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $('meta[name="twitter:title"]').attr("content")?.trim() ||
    $("h1").first().text().trim() ||
    $("title").first().text().trim()?.replace(/\s*[-|·].*$/, "").trim() ||
    "";
  const description =
    $('meta[property="og:description"]').attr("content")?.trim() ||
    $('meta[name="description"]').attr("content")?.trim() ||
    "";
  const sourceName =
    $('meta[property="og:site_name"]').attr("content")?.trim() ||
    (() => {
      try {
        return new URL(pageUrl).hostname.replace(/^www\./, "");
      } catch {
        return "";
      }
    })();
  const ogImage = resolveImageUrl(
    $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content") ||
      "",
    pageUrl
  );
  return { title, description, sourceName, ogImage };
}

export async function fetchLinkMeta(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: FETCH_HEADERS,
      redirect: "follow"
    });
    if (!res.ok) {
      return fallbackMeta(url);
    }
    const html = await res.text();
    if (!html || html.length < 80) {
      return fallbackMeta(url);
    }
    const parsed = parseLinkMetaFromHtml(html, url);
    return {
      originalUrl: url,
      title: parsed.title,
      description: parsed.description,
      sourceName: parsed.sourceName,
      ogImage: parsed.ogImage
    };
  } catch {
    return fallbackMeta(url);
  } finally {
    clearTimeout(timer);
  }
}

function fallbackMeta(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return {
      originalUrl: url,
      title: host,
      description: "",
      sourceName: host,
      ogImage: ""
    };
  } catch {
    return {
      originalUrl: url,
      title: "새 링크",
      description: "",
      sourceName: "",
      ogImage: ""
    };
  }
}
