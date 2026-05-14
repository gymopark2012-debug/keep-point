(() => {
  if (location.protocol !== "http:" && location.protocol !== "https:") return;

  const style = document.createElement("style");
  style.textContent = `
    .kp-verify-fab {
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
      font-family: system-ui, sans-serif;
      font-size: 12px;
      line-height: 1.35;
      box-shadow: 0 6px 20px rgba(15, 23, 42, 0.18);
      cursor: pointer;
      display: none;
    }
    .kp-verify-fab.visible { display: block; }
    .kp-verify-fab:hover { background: #e0e7ff; }
  `;
  document.head.appendChild(style);

  const storageKey = () => "keepPoint_verify_ext_" + encodeURIComponent(location.href);

  const fab = document.createElement("button");
  fab.type = "button";
  fab.className = "kp-verify-fab";
  fab.setAttribute("aria-label", "KeepPoint 마지막 위치로 이동");
  fab.innerHTML = "<strong>KeepPoint 마지막 위치로 이동</strong>";
  document.documentElement.appendChild(fab);

  const THROTTLE_MS = 800;
  let lastSave = 0;
  let scrollTimer = null;
  let pending = null;

  function metrics() {
    const root = document.scrollingElement || document.documentElement;
    const maxY = Math.max(0, root.scrollHeight - root.clientHeight);
    const scrollY = Math.min(Math.max(0, window.scrollY), maxY);
    const scrollPercent = maxY > 0 ? Math.round((scrollY / maxY) * 10000) / 100 : 0;
    return { scrollY, scrollPercent, maxY };
  }

  async function saveNow() {
    const key = storageKey();
    const m = metrics();
    const rec = {
      scrollY: m.scrollY,
      scrollPercent: m.scrollPercent,
      title: document.title,
      url: location.href,
      timestamp: new Date().toISOString()
    };
    await chrome.storage.local.set({ [key]: rec });
    pending = rec;
    fab.classList.add("visible");
    console.log("[verify ext] 저장", { key, scrollY: rec.scrollY, scrollPercent: rec.scrollPercent });
    return rec;
  }

  function scheduleSave() {
    const now = Date.now();
    if (now - lastSave < THROTTLE_MS) {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        lastSave = Date.now();
        saveNow().catch((e) => console.log("[verify ext] 저장 실패", e));
      }, THROTTLE_MS - (now - lastSave));
      return;
    }
    lastSave = Date.now();
    saveNow().catch((e) => console.log("[verify ext] 저장 실패", e));
  }

  function restore(rec) {
    if (!rec || !Number.isFinite(rec.scrollY)) return;
    const root = document.scrollingElement || document.documentElement;
    const maxY = Math.max(0, root.scrollHeight - root.clientHeight);
    const y = Math.min(Math.max(0, rec.scrollY), maxY);
    window.scrollTo({ top: y, behavior: "auto" });
    console.log("[verify ext] 복원 scrollY", y, "maxY", maxY);
  }

  fab.addEventListener("click", () => {
    if (pending) restore(pending);
  });

  window.addEventListener("scroll", scheduleSave, { passive: true });

  chrome.storage.local
    .get(storageKey())
    .then((bag) => {
      const key = storageKey();
      const rec = bag[key];
      if (!rec) {
        console.log("[verify ext] 복원: 저장된 기록 없음", key);
        return;
      }
      pending = rec;
      fab.classList.add("visible");
      setTimeout(() => {
        restore(rec);
        console.log("[verify ext] 자동 복원 완료", rec.timestamp);
      }, 300);
    })
    .catch((e) => console.log("[verify ext] 로드 실패", e));

  setTimeout(() => {
    saveNow().catch(() => {});
  }, 400);
})();
