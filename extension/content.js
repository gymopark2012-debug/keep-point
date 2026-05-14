(() => {
  const proto = location.protocol;
  if (proto !== "http:" && proto !== "https:") return;

  const THROTTLE_MS = 1000;

  const storageKey = () => `keepPoint_ext_reading_${encodeURIComponent(location.href)}`;

  const el = document.createElement("button");
  el.type = "button";
  el.className = "keeppoint-fab";
  el.setAttribute("aria-label", "KeepPoint 마지막 위치로 이동");
  document.documentElement.appendChild(el);

  let lastScrollPersist = 0;
  let scrollTimer = null;
  let pending = null;
  let autoRestoreDone = false;

  function getScrollMetrics() {
    const root = document.scrollingElement || document.documentElement;
    const maxY = Math.max(0, root.scrollHeight - root.clientHeight);
    const scrollY = Math.min(Math.max(0, window.scrollY), maxY);
    const scrollPercent = maxY > 0 ? Math.round((scrollY / maxY) * 10000) / 100 : 0;
    return { scrollY, scrollPercent, maxY };
  }

  async function loadRecord() {
    const key = storageKey();
    const bag = await chrome.storage.local.get(key);
    return bag[key] || null;
  }

  async function saveScrollPosition() {
    const key = storageKey();
    const m = getScrollMetrics();
    const rec = {
      url: location.href,
      title: document.title,
      scrollY: m.scrollY,
      scrollPercent: m.scrollPercent
    };
    await chrome.storage.local.set({ [key]: rec });
    return rec;
  }

  function scheduleScrollSave() {
    const now = Date.now();
    if (now - lastScrollPersist < THROTTLE_MS) {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(flushScrollSave, THROTTLE_MS - (now - lastScrollPersist));
      return;
    }
    flushScrollSave();
  }

  function flushScrollSave() {
    lastScrollPersist = Date.now();
    saveScrollPosition()
      .then((rec) => {
        pending = rec;
        updateFab(rec);
      })
      .catch(() => {});
  }

  function scheduleInitialSave() {
    const run = () => setTimeout(flushScrollSave, 300);
    if (document.readyState === "complete") run();
    else window.addEventListener("load", run, { once: true });
  }

  function restoreFromRecord(rec) {
    if (!rec) return;
    const root = document.scrollingElement || document.documentElement;
    const maxY = Math.max(0, root.scrollHeight - root.clientHeight);
    if (Number.isFinite(rec.scrollY) && rec.scrollY >= 0 && maxY > 0) {
      window.scrollTo({ top: Math.min(rec.scrollY, maxY), behavior: "smooth" });
      return;
    }
    if (Number.isFinite(rec.scrollPercent) && rec.scrollPercent >= 0 && maxY > 0) {
      window.scrollTo({ top: (rec.scrollPercent / 100) * maxY, behavior: "smooth" });
    }
  }

  function updateFab(rec) {
    if (!rec) {
      el.classList.remove("visible");
      return;
    }
    el.innerHTML = `<div><strong>KeepPoint 마지막 위치로 이동</strong></div><div class="kp-line">${escapeHtml(rec.title || "")}</div>`;
    el.classList.add("visible");
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  window.addEventListener("scroll", scheduleScrollSave, { passive: true });

  scheduleInitialSave();

  el.addEventListener("click", () => {
    if (pending) restoreFromRecord(pending);
  });

  loadRecord()
    .then((rec) => {
      pending = rec;
      if (!rec) {
        updateFab(null);
        return;
      }
      updateFab(rec);
      if (!autoRestoreDone) {
        autoRestoreDone = true;
        setTimeout(() => restoreFromRecord(rec), 400);
      }
    })
    .catch(() => {});
})();
