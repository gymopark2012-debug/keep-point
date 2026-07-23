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

function resolveVisualSrc(moment, visualPreview) {
  const visual = moment?.recall?.secondary?.find((c) => c.type === "visual");
  if (!visual) return null;
  if (visualPreview) return visualPreview;
  if (visual.value && (visual.value.startsWith("http") || visual.value.startsWith("data:"))) {
    return visual.value;
  }
  return null;
}

function resolveExcerpt(moment) {
  const excerptCue = moment?.recall?.secondary?.find((c) => c.type === "excerpt");
  return excerptCue?.value || "";
}

export function renderReadingMomentCard(moment, { relativeTimeFn, visualPreview } = {}) {
  const status = moment?.status || "ready";
  const keyword = moment?.recall?.primary?.value || "읽던 순간";
  const excerpt = resolveExcerpt(moment);
  const momentAt = formatRelativeTime(moment?.context?.momentAt || moment?.context?.savedAt, relativeTimeFn);
  const visualSrc = resolveVisualSrc(moment, visualPreview);

  if (status === "forming") {
    return `
      <section class="reading-moment-card reading-moment-card--forming" aria-busy="true" aria-label="Reading Moment 생성 중">
        <div class="moment-skeleton moment-skeleton-line wide"></div>
        <div class="moment-skeleton moment-skeleton-line"></div>
        <p class="moment-forming-label">기억을 정리하는 중…</p>
      </section>`;
  }

  return `
    <section class="reading-moment-card" aria-label="Reading Moment">
      ${visualSrc
        ? `<img class="moment-visual" src="${escapeAttr(visualSrc)}" alt="" loading="lazy" />`
        : ""}
      <p class="moment-keyword">${escapeHtml(keyword)}</p>
      ${excerpt ? `<p class="moment-excerpt">${escapeHtml(excerpt)}</p>` : ""}
      ${momentAt ? `<p class="moment-time">${escapeHtml(momentAt)}</p>` : ""}
      <button type="button" class="btn resume-primary-cta" id="continueOriginalBtn">원문에서 이어 읽기</button>
      <details class="moment-boost" id="momentBoostPanel">
        <summary>기억이 흐릿해요 · 보강하기</summary>
        <div class="moment-boost-body">
          <p class="moment-boost-guide">스크린샷을 붙여넣거나 키워드 하나만 수정해 주세요.</p>
          <div class="moment-paste-zone" id="momentPasteZone" tabindex="0" role="button" aria-label="스크린샷 붙여넣기">
            <span>Ctrl+V로 스크린샷 붙여넣기</span>
            <input type="file" id="momentFileInput" accept="image/*" hidden />
          </div>
          <div class="moment-keyword-field">
            <input
              type="text"
              id="momentKeywordInput"
              class="moment-keyword-input"
              maxlength="16"
              placeholder="키워드 (예: 무신정권)"
              value="${escapeAttr(keyword !== "읽던 순간" ? keyword : "")}"
              aria-label="기억 키워드"
            />
            <button type="button" class="btn sm" id="momentKeywordSaveBtn">적용</button>
          </div>
        </div>
      </details>
    </section>`;
}
