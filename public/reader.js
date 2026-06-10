(() => {
  const STORAGE_KEY = "keepPointDataV2";
  const AUTH_KEY = "keepPointAuthV1";
  const CLOUD_KEY_PREFIX = "keepPointCloudV1_";

  const params = new URLSearchParams(window.location.search);
  const pathMatch = window.location.pathname.match(/\/reader\/([^/?#]+)/);
  const linkId = String(params.get("id") || (pathMatch ? pathMatch[1] : "") || "").trim();
  const restart = params.get("mode") === "restart";

  const backBtn = document.getElementById("backBtn");
  const readerTitle = document.getElementById("readerTitle");
  const originalLink = document.getElementById("originalLink");
  const readerScroll = document.getElementById("readerScroll");
  const readerArticle = document.getElementById("readerArticle");
  const readerEmpty = document.getElementById("readerEmpty");
  const readerEmptyText = document.getElementById("readerEmptyText");
  const goDetailBtn = document.getElementById("goDetailBtn");
  const openOriginalBtn = document.getElementById("openOriginalBtn");
  const readerProgress = document.getElementById("readerProgress");
  const readerSaveStatus = document.getElementById("readerSaveStatus");

  let saveTimer = null;
  let currentLink = null;

  function indexPageHref() {
    return "/";
  }

  function loadState() {
    try {
      const authRaw = localStorage.getItem(AUTH_KEY);
      const auth = authRaw ? JSON.parse(authRaw) : null;
      if (auth?.isLoggedIn && auth.userId) {
        const cloudRaw = localStorage.getItem(`${CLOUD_KEY_PREFIX}${encodeURIComponent(auth.userId)}`);
        if (cloudRaw) return JSON.parse(cloudRaw);
      }
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function persistState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    try {
      const authRaw = localStorage.getItem(AUTH_KEY);
      const auth = authRaw ? JSON.parse(authRaw) : null;
      if (auth?.isLoggedIn && auth.userId) {
        localStorage.setItem(`${CLOUD_KEY_PREFIX}${encodeURIComponent(auth.userId)}`, JSON.stringify(state));
      }
    } catch {
      /* ignore */
    }
  }

  function getOriginalUrl(link) {
    return link.originalUrl || link.url || "";
  }

  function getReaderState(link) {
    const rs = link.readerState;
    if (!rs || typeof rs !== "object") {
      return { scrollRatio: 0, lastParagraphId: null, updatedAt: null };
    }
    return {
      scrollRatio: Math.max(0, Math.min(1, Number(rs.scrollRatio) || 0)),
      lastParagraphId: rs.lastParagraphId || null,
      updatedAt: rs.updatedAt || null
    };
  }

  function getScrollRatio(container) {
    const max = Math.max(1, container.scrollHeight - container.clientHeight);
    return Math.max(0, Math.min(1, container.scrollTop / max));
  }

  function findLastVisibleParagraphId(container) {
    const blocks = container.querySelectorAll('[id^="kp-p-"]');
    let lastId = null;
    const marker = container.clientHeight * 0.35;
    for (const el of blocks) {
      const top = el.offsetTop - container.scrollTop;
      if (top <= marker) lastId = el.id;
    }
    return lastId;
  }

  function highlightCurrentParagraph(paragraphId) {
    readerArticle.querySelectorAll(".reader-current").forEach((el) => el.classList.remove("reader-current"));
    if (!paragraphId) return;
    const el = document.getElementById(paragraphId);
    if (el) el.classList.add("reader-current");
  }

  function saveReaderPosition() {
    if (!currentLink || !readerScroll) return;
    const scrollRatio = restart ? 0 : getScrollRatio(readerScroll);
    const lastParagraphId = restart ? null : findLastVisibleParagraphId(readerScroll);
    const state = loadState();
    if (!state?.links) return;
    const link = state.links.find((item) => item.id === currentLink.id);
    if (!link) return;
    link.readerState = {
      scrollRatio,
      lastParagraphId,
      updatedAt: new Date().toISOString()
    };
    link.lastVisitedAt = new Date().toISOString();
    persistState(state);
    currentLink = link;
    if (readerProgress) readerProgress.textContent = `${Math.round(scrollRatio * 100)}%`;
    if (readerSaveStatus) readerSaveStatus.textContent = "저장됨";
  }

  function scheduleSave() {
    if (readerSaveStatus) readerSaveStatus.textContent = "저장 중...";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveReaderPosition, 350);
  }

  function restoreReaderPosition() {
    if (!readerScroll || restart) return;
    const rs = getReaderState(currentLink);
    if (rs.lastParagraphId) {
      const el = document.getElementById(rs.lastParagraphId);
      if (el) {
        el.scrollIntoView({ block: "start" });
        highlightCurrentParagraph(rs.lastParagraphId);
        if (readerProgress) readerProgress.textContent = `${Math.round(getScrollRatio(readerScroll) * 100)}%`;
        return;
      }
    }
    if (rs.scrollRatio > 0) {
      const max = Math.max(0, readerScroll.scrollHeight - readerScroll.clientHeight);
      readerScroll.scrollTop = max * rs.scrollRatio;
      const pid = findLastVisibleParagraphId(readerScroll);
      highlightCurrentParagraph(pid);
      if (readerProgress) readerProgress.textContent = `${Math.round(rs.scrollRatio * 100)}%`;
    }
  }

  function showEmpty(message) {
    readerScroll?.classList.add("hidden");
    readerEmpty?.classList.remove("hidden");
    if (readerEmptyText) readerEmptyText.textContent = message;
  }

  function boot() {
    if (!linkId) {
      showEmpty("링크 ID가 없습니다.");
      return;
    }
    const state = loadState();
    const link = state?.links?.find((item) => item.id === linkId);
    if (!link) {
      showEmpty("저장된 링크를 찾을 수 없습니다.");
      return;
    }
    currentLink = link;
    const originalUrl = getOriginalUrl(link);
    if (readerTitle) readerTitle.textContent = link.title || "Reader";
    if (originalLink) {
      originalLink.href = originalUrl || "#";
      originalLink.textContent = originalUrl || "원본";
    }
    if (openOriginalBtn) {
      openOriginalBtn.addEventListener("click", () => {
        if (originalUrl) window.open(originalUrl, "_blank", "noopener,noreferrer");
      });
    }
    if (goDetailBtn) {
      goDetailBtn.addEventListener("click", () => {
        window.location.href = `${indexPageHref()}?select=${encodeURIComponent(linkId)}`;
      });
    }

    const hasContent = link.contentStatus === "ready" && String(link.content || "").trim().length > 0;
    if (!hasContent) {
      showEmpty("본문 추출 실패, 직접 붙여넣기 필요");
      return;
    }

    readerArticle.innerHTML = link.content;
    readerScroll?.classList.remove("hidden");
    readerEmpty?.classList.add("hidden");

    requestAnimationFrame(() => {
      restoreReaderPosition();
      saveReaderPosition();
    });

    readerScroll.addEventListener("scroll", scheduleSave, { passive: true });
    window.addEventListener("beforeunload", saveReaderPosition);
  }

  backBtn?.addEventListener("click", () => {
    saveReaderPosition();
    window.location.href = indexPageHref();
  });

  boot();
})();
