function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(text) {
  return escapeHtml(text);
}

function formatRelativeTime(iso, relativeTimeFn) {
  if (typeof relativeTimeFn === "function") return relativeTimeFn(iso);
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const day = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (day <= 0) return "오늘";
  if (day === 1) return "1일 전";
  return `${day}일 전`;
}

export function renderReadingSnapshotCard(snapshot, { relativeTimeFn, screenshotPreview } = {}) {
  const status = snapshot?.status || "empty";
  const keyword = snapshot?.keyword || "";
  const savedAt = formatRelativeTime(snapshot?.savedAt, relativeTimeFn);
  const screenshot = screenshotPreview || null;

  if (status === "empty" || !snapshot?.screenshotRef) {
    return `
      <section class="reading-snapshot-card reading-snapshot-card--empty" aria-label="Reading Snapshot">
        <div class="snapshot-paste-zone snapshot-paste-zone--hero" id="snapshotPasteZone" tabindex="0" role="button" aria-label="읽던 화면 붙여넣기">
          <p class="snapshot-paste-lead">읽던 화면을 붙여넣어 주세요</p>
          <p class="snapshot-paste-hint">Ctrl+V 또는 클릭해서 이미지 선택</p>
          <input type="file" id="snapshotFileInput" accept="image/*" hidden />
        </div>
        <button type="button" class="btn resume-primary-cta" id="continueOriginalBtn">원문에서 이어 읽기</button>
      </section>`;
  }

  if (status === "processing") {
    return `
      <section class="reading-snapshot-card reading-snapshot-card--processing" aria-busy="true" aria-label="스크린샷 처리 중">
        ${screenshot ? `<img class="snapshot-image" src="${escapeAttr(screenshot)}" alt="읽던 화면" />` : `<div class="snapshot-skeleton snapshot-skeleton-image"></div>`}
        <div class="snapshot-skeleton snapshot-skeleton-line wide"></div>
        <p class="snapshot-processing-label">키워드를 찾는 중…</p>
      </section>`;
  }

  if (status === "failed") {
    return `
      <section class="reading-snapshot-card reading-snapshot-card--failed" aria-label="스크린샷 처리 실패">
        ${screenshot ? `<img class="snapshot-image" src="${escapeAttr(screenshot)}" alt="읽던 화면" />` : ""}
        ${keyword ? `<p class="snapshot-keyword">${escapeHtml(keyword)}</p>` : ""}
        <p class="snapshot-meta">키워드를 찾지 못했어요. 스크린샷을 다시 붙여넣어 주세요.</p>
        <div class="snapshot-paste-zone" id="snapshotPasteZone" tabindex="0" role="button" aria-label="스크린샷 다시 붙여넣기">
          <span>Ctrl+V로 다시 붙여넣기</span>
          <input type="file" id="snapshotFileInput" accept="image/*" hidden />
        </div>
        <button type="button" class="btn resume-primary-cta" id="continueOriginalBtn">원문에서 이어 읽기</button>
      </section>`;
  }

  return `
    <section class="reading-snapshot-card" aria-label="Reading Snapshot">
      ${screenshot
        ? `<img class="snapshot-image" src="${escapeAttr(screenshot)}" alt="읽던 화면" loading="lazy" />`
        : `<div class="snapshot-skeleton snapshot-skeleton-image" aria-hidden="true"></div>`}
      ${keyword ? `<p class="snapshot-keyword">${escapeHtml(keyword)}</p>` : ""}
      ${savedAt ? `<p class="snapshot-meta">${escapeHtml(savedAt)}</p>` : ""}
      <button type="button" class="btn resume-primary-cta" id="continueOriginalBtn">원문에서 이어 읽기</button>
    </section>`;
}
