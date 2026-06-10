import * as cheerio from "cheerio";

const MIN_CONTENT_LENGTH = 80;
const FETCH_TIMEOUT_MS = 18000;
const BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre"]);

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function stripText(html) {
  const $ = cheerio.load(`<div>${html || ""}</div>`);
  return $.root().text().replace(/\s+/g, " ").trim();
}

function plainTextToReaderHtml(text) {
  const blocks = String(text || "")
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!blocks.length) return "";
  return blocks
    .map((part, index) => `<p id="kp-p-${index}">${escapeHtml(part).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

function pickTitle($) {
  const og = $('meta[property="og:title"]').attr("content")?.trim();
  if (og) return og;
  const tw = $('meta[name="twitter:title"]').attr("content")?.trim();
  if (tw) return tw;
  const h1 = $("h1").first().text().trim();
  if (h1) return h1;
  const title = $("title").first().text().trim();
  if (title) return title.replace(/\s*[-|·].*$/, "").trim() || title;
  return "";
}

function cleanRoot($, root) {
  root.find("script, style, noscript, iframe, svg, nav, footer, header, form, aside").remove();
  return root;
}

function textLength($, el) {
  return stripText($(el).html() || "").length;
}

function findContentRoot($) {
  const article = $("article").first();
  if (article.length && textLength($, article) >= MIN_CONTENT_LENGTH) {
    return article;
  }
  const main = $("main").first();
  if (main.length && textLength($, main) >= MIN_CONTENT_LENGTH) {
    return main;
  }
  const body = $("body");
  return body.length ? body : $.root();
}

function assignParagraphIds(html) {
  const $ = cheerio.load(`<div id="kp-root">${html}</div>`, { decodeEntities: false });
  const root = $("#kp-root");
  let index = 0;
  root.find("*").each((_, el) => {
    const tag = el.tagName?.toLowerCase();
    if (!tag || !BLOCK_TAGS.has(tag)) return;
    const inner = $(el).html() || "";
    if (stripText(inner).length === 0) return;
    $(el).attr("id", `kp-p-${index}`);
    index += 1;
  });
  if (index === 0) {
    const text = stripText(root.html() || "");
    if (text.length >= MIN_CONTENT_LENGTH) {
      return plainTextToReaderHtml(text);
    }
    return "";
  }
  return root.html()?.trim() || "";
}

export function extractArticleFromHtml(html, pageUrl) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const title = pickTitle($);
  const contentRoot = cleanRoot($, findContentRoot($));
  const rawHtml = contentRoot.html()?.trim() || "";
  const content = assignParagraphIds(rawHtml);
  const plain = stripText(content);
  const status = plain.length >= MIN_CONTENT_LENGTH ? "ready" : "failed";
  return {
    title,
    content: status === "ready" ? content : "",
    originalUrl: pageUrl || "",
    status
  };
}

export async function extractArticleFromUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; KeepPointBot/1.0; +https://keeppoint.local/article-extractor)",
        Accept: "text/html,application/xhtml+xml"
      },
      redirect: "follow"
    });
    if (!res.ok) {
      return { title: "", content: "", originalUrl: url, status: "failed" };
    }
    const html = await res.text();
    if (!html || html.length < 200) {
      return { title: "", content: "", originalUrl: url, status: "failed" };
    }
    return extractArticleFromHtml(html, url);
  } catch {
    return { title: "", content: "", originalUrl: url, status: "failed" };
  } finally {
    clearTimeout(timer);
  }
}

export { plainTextToReaderHtml, MIN_CONTENT_LENGTH };
