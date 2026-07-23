(() => {
  const proto = location.protocol;
  if (proto !== "http:" && proto !== "https:") return;

  const style = document.createElement("style");
  style.textContent = `
    .keeppoint-fab {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483646;
      padding: 10px 14px;
      border-radius: 10px;
      border: 1px solid #93c5fd;
      background: #eff6ff;
      color: #1d4ed8;
      font-family: system-ui, "Segoe UI", sans-serif;
      font-size: 13px;
      font-weight: 600;
      box-shadow: 0 4px 16px rgba(37, 99, 235, 0.2);
      cursor: default;
      pointer-events: none;
    }
  `;
  (document.head || document.documentElement).appendChild(style);

  const fab = document.createElement("div");
  fab.className = "keeppoint-fab";
  fab.setAttribute("role", "note");
  fab.textContent = "KeepPoint에서 읽기 포인트 선택";
  document.documentElement.appendChild(fab);
})();
