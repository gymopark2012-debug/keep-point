(() => {
  const proto = location.protocol;
  if (proto !== "http:" && proto !== "https:") return;

  const SCROLL_SAVE_INTERVAL_MS = 1000;
  const SELECTION_DEBOUNCE_MS = 350;
  const MAX_TEXT_FIELD = 8000;
  const MAX_CENTER_LEN = 400;

  const storageKey = () => `keepPoint_ext_reading_${encodeURIComponent(location.href)}`;

  const style = document.createElement("style");
  style.textContent = `
    .keeppoint-fab {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483646;
      max-width: min(280px, calc(100vw - 32px));
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid #c7d2fe;
      background: #eef2ff;
      color: #1e3a8a;
      font-family: system-ui, "Segoe UI", sans-serif;
      font-size: 12px;
      line-height: 1.35;
      box-shadow: 0 6px 20px rgba(15, 23, 42, 0.18);
      cursor: pointer;
      display: none;
    }

    .keeppoint-fab.visible {
      display: block;
    }

    .keeppoint-fab:hover {
      background: #e0e7ff;
    }

    .keeppoint-fab .kp-line {
      margin-top: 4px;
      font-size: 11px;
      color: #334155;
      word-break: break-word;
    }
  `;
  (document.head || document.documentElement).appendChild(style);

  const fab = document.createElement("button");
  fab.type = "button";
  fab.className = "keeppoint-fab";
  fab.setAttribute("aria-label", "KeepPoint 마지막 위치로 이동");
  document.documentElement.appendChild(fab);

  let pending = null;
  let lastScrollPersistAt = 0;
  let scrollTimer = null;
  let selectionTimer = null;
  let restoreAttempts = 0;
  const MAX_AUTO_RESTORE = 3;

  function getScrollMetrics() {
    const root = document.scrollingElement || document.documentElement;
    const maxY = Math.max(0, root.scrollHeight - root.clientHeight);
    const scrollY = Math.min(Math.max(0, window.scrollY), maxY);
    const scrollPercent = maxY > 0 ? Math.round((scrollY / maxY) * 10000) / 100 : 0;
    return { scrollY, scrollPercent, maxY };
  }

  function getCenterText() {
    const x = Math.floor(window.innerWidth / 2);
    const y = Math.floor(window.innerHeight / 2);
    try {
      if (document.caretRangeFromPoint) {
        const range = document.caretRangeFromPoint(x, y);
        if (range && range.startContainer) {
          const sc = range.startContainer;
          if (sc.nodeType === Node.TEXT_NODE) {
            const t = sc.nodeValue || "";
            const off = range.startOffset;
            const start = Math.max(0, off - 70);
            const end = Math.min(t.length, off + 70);
            return t.slice(start, end).replace(/\s+/g, " ").trim().slice(0, MAX_CENTER_LEN);
          }
          const el = sc.nodeType === Node.ELEMENT_NODE ? sc : sc.parentElement;
          const chunk = (el && el.textContent) || "";
          return chunk.replace(/\s+/g, " ").trim().slice(0, MAX_CENTER_LEN);
        }
      }
    } catch {
      /* ignore */
    }
    return "";
  }

  function getLiveSelectionText() {
    try {
      const sel = window.getSelection();
      return (sel && sel.toString()) || "";
    } catch {
      return "";
    }
  }

  function buildRecord(prev) {
    const m = getScrollMetrics();
    const liveSel = getLiveSelectionText().trim();
    const selectedText = (liveSel || (prev && prev.selectedText) || "").trim().slice(0, MAX_TEXT_FIELD);
    let centerText = getCenterText();
    if (!centerText && prev && prev.centerText) centerText = String(prev.centerText);
    centerText = String(centerText).slice(0, MAX_CENTER_LEN);
    return {
      url: location.href,
      title: document.title,
      scrollY: m.scrollY,
      scrollPercent: m.scrollPercent,
      selectedText,
      centerText,
      updatedAt: new Date().toISOString()
    };
  }

  async function loadRecord() {
    const key = storageKey();
    const bag = await chrome.storage.local.get(key);
    return bag[key] || null;
  }

  async function saveRecord(rec) {
    const key = storageKey();
    await chrome.storage.local.set({ [key]: rec });
    pending = rec;
    updateFab(rec);
  }

  async function persistFromPrev(prevBag) {
    const prev = prevBag || pending || (await loadRecord());
    const rec = buildRecord(prev);
    await saveRecord(rec);
  }

  function scheduleScrollPersist() {
    const now = Date.now();
    const elapsed = now - lastScrollPersistAt;
    if (elapsed >= SCROLL_SAVE_INTERVAL_MS) {
      lastScrollPersistAt = now;
      clearTimeout(scrollTimer);
      scrollTimer = null;
      persistFromPrev(null).catch(() => {});
      return;
    }
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      lastScrollPersistAt = Date.now();
      scrollTimer = null;
      persistFromPrev(null).catch(() => {});
    }, SCROLL_SAVE_INTERVAL_MS - elapsed);
  }

  function scheduleSelectionPersist() {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      const t = getLiveSelectionText().trim();
      if (t.length < 1) return;
      persistFromPrev(null).catch(() => {});
    }, SELECTION_DEBOUNCE_MS);
  }

  function tryScrollToSelectedText(text, behavior) {
    const intoViewBehavior = behavior === "smooth" ? "smooth" : "auto";
    const raw = (text || "").trim();
    if (raw.length < 2) return false;
    const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const candidates = [
      raw.slice(0, 500),
      lines[0] || "",
      raw.replace(/\s+/g, " ").trim().slice(0, 200)
    ].filter((s) => s.length >= 2);
    for (const query of candidates) {
      try {
        window.getSelection()?.removeAllRanges();
        const found =
          typeof window.find === "function" &&
          window.find(query, false, false, true, false, false, false);
        if (found) {
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            const start = sel.getRangeAt(0).startContainer;
            const el =
              start.nodeType === Node.ELEMENT_NODE
                ? start
                : start.parentElement && start.parentElement.nodeType === Node.ELEMENT_NODE
                  ? start.parentElement
                  : null;
            if (el) {
              el.scrollIntoView({ block: "center", behavior: intoViewBehavior });
              return true;
            }
          }
        }
      } catch {
        /* try next candidate */
      }
    }
    return false;
  }

  function restoreFromRecord(rec, behavior) {
    if (!rec) return;
    const scrollBehavior = behavior === "smooth" ? "smooth" : "auto";
    const root = document.scrollingElement || document.documentElement;
    const maxY = Math.max(0, root.scrollHeight - root.clientHeight);

    if (rec.selectedText && tryScrollToSelectedText(rec.selectedText, scrollBehavior)) {
      return;
    }
    if (Number.isFinite(rec.scrollY) && rec.scrollY >= 0 && maxY >= 0) {
      window.scrollTo({
        top: Math.min(Math.max(0, rec.scrollY), maxY),
        behavior: scrollBehavior
      });
      return;
    }
    if (Number.isFinite(rec.scrollPercent) && rec.scrollPercent >= 0 && maxY > 0) {
      window.scrollTo({
        top: (Math.min(100, Math.max(0, rec.scrollPercent)) / 100) * maxY,
        behavior: scrollBehavior
      });
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function updateFab(rec) {
    if (!rec) {
      fab.classList.remove("visible");
      fab.innerHTML = "";
      return;
    }
    fab.innerHTML = `<div><strong>KeepPoint 마지막 위치로 이동</strong></div><div class="kp-line">${escapeHtml(rec.title || "")}</div>`;
    fab.classList.add("visible");
  }

  window.addEventListener("scroll", scheduleScrollPersist, { passive: true });

  document.addEventListener("selectionchange", () => {
    scheduleSelectionPersist();
  });

  document.addEventListener("mouseup", () => {
    scheduleSelectionPersist();
  });

  fab.addEventListener("click", () => {
    loadRecord()
      .then((rec) => {
        pending = rec;
        if (rec) restoreFromRecord(rec, "smooth");
      })
      .catch(() => {});
  });

  function scheduleInitialPersist() {
    const run = () => setTimeout(() => persistFromPrev(null).catch(() => {}), 400);
    if (document.readyState === "complete") run();
    else window.addEventListener("load", run, { once: true });
  }

  function scheduleAutoRestore(rec) {
    const delays = [450, 1400, 2800];
    delays.forEach((ms) => {
      setTimeout(() => {
        if (restoreAttempts >= MAX_AUTO_RESTORE) return;
        restoreAttempts += 1;
        restoreFromRecord(rec, "auto");
      }, ms);
    });
  }

  loadRecord()
    .then((rec) => {
      pending = rec;
      updateFab(rec);
      if (rec) scheduleAutoRestore(rec);
    })
    .catch(() => {});

  scheduleInitialPersist();
})();
