(() => {
  const MIN_CONTENT_LENGTH = 80;
  const PROXY_TIMEOUT_MS = 18000;

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function stripTags(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return (tmp.textContent || tmp.innerText || "").replace(/\s+/g, " ").trim();
  }

  async function fetchHtml(url) {
    const proxyUrls = [
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      `https://corsproxy.io/?${encodeURIComponent(url)}`
    ];
    let lastError = null;
    for (const proxyUrl of proxyUrls) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
        const res = await fetch(proxyUrl, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) continue;
        const text = await res.text();
        if (text && text.length > 200) return text;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error("본문을 가져오지 못했습니다.");
  }

  function pickTitle(doc) {
    const og = doc.querySelector('meta[property="og:title"]')?.getAttribute("content");
    if (og && og.trim()) return og.trim();
    const tw = doc.querySelector('meta[name="twitter:title"]')?.getAttribute("content");
    if (tw && tw.trim()) return tw.trim();
    const h1 = doc.querySelector("h1")?.textContent?.trim();
    if (h1) return h1;
    const title = doc.querySelector("title")?.textContent?.trim();
    if (title) return title.replace(/\s*[-|·].*$/, "").trim() || title;
    return "";
  }

  function cloneAndClean(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll("script, style, noscript, iframe, svg, nav, footer, header, form, aside").forEach((el) => {
      el.remove();
    });
    return clone;
  }

  function scoreNode(node) {
    const text = (node.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length < MIN_CONTENT_LENGTH) return 0;
    const pCount = node.querySelectorAll("p").length;
    const linkCount = node.querySelectorAll("a").length;
    const linkDensity = linkCount / Math.max(1, text.length / 100);
    return text.length + pCount * 120 - linkDensity * 80;
  }

  function findMainContent(doc) {
    const selectors = ["article", "main", '[role="main"]', ".article", ".post-content", ".entry-content", "#content", ".content"];
    let best = null;
    let bestScore = 0;
    for (const sel of selectors) {
      for (const node of doc.querySelectorAll(sel)) {
        const score = scoreNode(node);
        if (score > bestScore) {
          bestScore = score;
          best = node;
        }
      }
    }
    if (best && bestScore >= MIN_CONTENT_LENGTH) return best;
    const body = doc.body;
    if (!body) return null;
    let candidate = body;
    for (const child of body.querySelectorAll("div, section")) {
      const score = scoreNode(child);
      if (score > bestScore) {
        bestScore = score;
        candidate = child;
      }
    }
    return bestScore >= MIN_CONTENT_LENGTH ? candidate : null;
  }

  function assignParagraphIds(html) {
    const doc = new DOMParser().parseFromString(`<div id="kp-root">${html}</div>`, "text/html");
    const root = doc.getElementById("kp-root");
    if (!root) return "";
    let index = 0;
    const blockTags = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "PRE"]);
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    while (node) {
      if (blockTags.has(node.tagName) && stripTags(node.innerHTML).length > 0) {
        node.id = `kp-p-${index}`;
        index += 1;
      }
      node = walker.nextNode();
    }
    if (index === 0) {
      const text = stripTags(root.innerHTML);
      if (text.length >= MIN_CONTENT_LENGTH) {
        return plainTextToReaderHtml(text);
      }
    }
    return root.innerHTML.trim();
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

  function extractFromDocument(doc) {
    const title = pickTitle(doc);
    const main = findMainContent(doc);
    if (!main) return { title, content: "", status: "failed" };
    const cleaned = cloneAndClean(main);
    const html = assignParagraphIds(cleaned.innerHTML);
    const plain = stripTags(html);
    if (plain.length < MIN_CONTENT_LENGTH) {
      return { title, content: "", status: "failed" };
    }
    return { title, content: html, status: "ready" };
  }

  async function extractFromUrl(url) {
    try {
      const html = await fetchHtml(url);
      const doc = new DOMParser().parseFromString(html, "text/html");
      return extractFromDocument(doc);
    } catch {
      return { title: "", content: "", status: "failed" };
    }
  }

  window.KeepPointContentExtract = {
    MIN_CONTENT_LENGTH,
    extractFromUrl,
    extractFromDocument,
    plainTextToReaderHtml,
    assignParagraphIds
  };
})();
