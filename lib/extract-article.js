import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import * as cheerio from "cheerio";

const MIN_CONTENT_LENGTH = 80;
const FETCH_TIMEOUT_MS = 20000;
const BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre"]);

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
};

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

function pickTitleFromHtml(html) {
  const $ = cheerio.load(html, { decodeEntities: false });
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

function assignParagraphIds(html) {
  if (!html || !String(html).trim()) return "";
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

function extractWithReadability(html, pageUrl) {
  try {
    const dom = new JSDOM(html, { url: pageUrl });
    const reader = new Readability(dom.window.document, {
      charThreshold: 0,
      keepClasses: false
    });
    const parsed = reader.parse();
    if (!parsed) return null;
    const plain = String(parsed.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    if (plain.length < MIN_CONTENT_LENGTH) return null;
    const contentHtml = parsed.content || "";
    const content = assignParagraphIds(contentHtml);
    if (stripText(content).length < MIN_CONTENT_LENGTH) {
      return {
        title: (parsed.title || "").trim(),
        content: plainTextToReaderHtml(plain),
        method: "readability-text"
      };
    }
    return {
      title: (parsed.title || "").trim(),
      content,
      method: "readability"
    };
  } catch {
    return null;
  }
}

function extractWithHeuristic(html) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const title = pickTitleFromHtml(html);

  const candidates = [];
  const pushCandidate = (el, bonus = 0) => {
    if (!el || !el.length) return;
    el.find("script, style, noscript, iframe, svg, nav, footer, header, form, aside").remove();
    const text = stripText(el.html() || "");
    if (text.length < MIN_CONTENT_LENGTH) return;
    const pCount = el.find("p").length;
    const linkCount = el.find("a").length;
    const linkDensity = linkCount / Math.max(1, text.length / 100);
    const score = text.length + pCount * 120 - linkDensity * 80 + bonus;
    candidates.push({ el, score, text });
  };

  $("article").each((_, node) => pushCandidate($(node), 200));
  $("main, [role='main']").each((_, node) => pushCandidate($(node), 100));
  $("body").each((_, node) => {
    pushCandidate($(node), 0);
    $(node)
      .find("div, section")
      .each((__, child) => pushCandidate($(child), 0));
  });

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return null;

  const content = assignParagraphIds(best.el.html()?.trim() || "");
  if (stripText(content).length < MIN_CONTENT_LENGTH) return null;

  return { title, content, method: "heuristic" };
}

export function extractArticleFromHtml(html, pageUrl) {
  const readability = extractWithReadability(html, pageUrl);
  if (readability?.content) {
    return {
      title: readability.title || pickTitleFromHtml(html),
      content: readability.content,
      originalUrl: pageUrl || "",
      status: "ready",
      method: readability.method
    };
  }

  const heuristic = extractWithHeuristic(html);
  if (heuristic?.content) {
    return {
      title: heuristic.title || pickTitleFromHtml(html),
      content: heuristic.content,
      originalUrl: pageUrl || "",
      status: "ready",
      method: heuristic.method
    };
  }

  return {
    title: pickTitleFromHtml(html),
    content: "",
    originalUrl: pageUrl || "",
    status: "failed",
    method: "none"
  };
}

export async function extractArticleFromUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: FETCH_HEADERS,
      redirect: "follow"
    });
    if (!res.ok) {
      return { title: "", content: "", originalUrl: url, status: "failed", method: "fetch-error" };
    }
    const html = await res.text();
    if (!html || html.length < 200) {
      return { title: "", content: "", originalUrl: url, status: "failed", method: "empty-html" };
    }
    return extractArticleFromHtml(html, url);
  } catch {
    return { title: "", content: "", originalUrl: url, status: "failed", method: "fetch-error" };
  } finally {
    clearTimeout(timer);
  }
}

export { plainTextToReaderHtml, MIN_CONTENT_LENGTH };
