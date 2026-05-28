(() => {
  const proto = location.protocol;
  if (proto !== "http:" && proto !== "https:") return;

  const STORAGE_KEY = "keepPoint_extension_clips";
  const MAX_ITEMS = 300;
  const MAX_TEXT = 8000;

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
  fab.setAttribute("aria-label", "Save to KeepPoint");
  fab.textContent = "Save to KeepPoint";
  document.documentElement.appendChild(fab);

  function getSelectionText() {
    try {
      const s = window.getSelection()?.toString() || "";
      return String(s).trim().slice(0, MAX_TEXT);
    } catch {
      return "";
    }
  }

  async function saveClip() {
    const selectedText = getSelectionText();
    const memo = window.prompt("KeepPoint에 저장할 메모를 입력하세요.", "") || "";
    const progressText = window.prompt("읽은 퍼센트(0~100)를 입력하세요. (선택)", "") || "";
    const progressPercent = Math.max(0, Math.min(100, Number(progressText) || 0));
    return {
      url: location.href,
      title: document.title,
      progressPercent,
      memo: String(memo).trim().slice(0, MAX_TEXT),
      selectedText,
      updatedAt: new Date().toISOString()
    };
  }

  function updateFabStatus(text) {
    fab.textContent = text;
    fab.classList.add("visible");
    window.setTimeout(() => {
      fab.textContent = "Save to KeepPoint";
    }, 1500);
  }

  fab.classList.add("visible");
  fab.addEventListener("click", async () => {
    try {
      const item = await saveClip();
      const bag = await chrome.storage.local.get(STORAGE_KEY);
      const arr = Array.isArray(bag[STORAGE_KEY]) ? bag[STORAGE_KEY] : [];
      arr.unshift(item);
      const trimmed = arr.slice(0, MAX_ITEMS);
      await chrome.storage.local.set({ [STORAGE_KEY]: trimmed });
      updateFabStatus("KeepPoint 저장 완료");
    } catch {
      updateFabStatus("저장 실패");
    }
  });
})();
