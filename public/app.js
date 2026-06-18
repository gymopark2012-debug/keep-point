const STORAGE_KEY = "keepPointDataV2";
const AUTH_KEY = "keepPointAuthV1";
const USERS_KEY = "keepPointUsersV1";
const CLOUD_KEY_PREFIX = "keepPointCloudV1_";
const ALL_CATEGORY = "all";
const NAVER_OAUTH_STATE_KEY = "keepPoint_naver_oauth_state";
const AUTH_CONFIG = window.KEEPPOINT_AUTH_CONFIG || { googleClientId: "", naverClientId: "" };
const AUTH_PROVIDER_LABELS = {
  email: "이메일",
  google: "Google",
  naver: "네이버"
};

function getPdfReadingStorageKey(linkUrl) {
  return `keepPoint_pdf_reading_${encodeURIComponent(linkUrl || "")}`;
}

function getPdfSnapshotFromStorage(linkUrl) {
  try {
    const raw = localStorage.getItem(getPdfReadingStorageKey(linkUrl));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const IDB_NAME = "keepPointDB";
const IDB_VERSION = 1;
const IDB_STORE = "localPdfs";

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: "id" });
      }
    };
  });
}

async function idbPutLocalPdfRecord(record) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(IDB_STORE).put(record);
  });
}

async function idbGetLocalPdfRecord(id) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const r = tx.objectStore(IDB_STORE).get(id);
    r.onerror = () => reject(r.error);
    r.onsuccess = () => resolve(r.result);
  });
}

async function idbDeleteLocalPdfRecord(id) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(IDB_STORE).delete(id);
  });
}

async function idbGetAllLocalPdfRecords() {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result || []);
  });
}

function getLocalPdfPageStorageKey(id) {
  return `keepPoint_pdf_local_${id}`;
}

function getLocalPdfLastPage(id) {
  try {
    const raw = localStorage.getItem(getLocalPdfPageStorageKey(id));
    if (!raw) return 1;
    const o = JSON.parse(raw);
    return Math.max(1, Number.parseInt(String(o.pageNumber), 10) || 1);
  } catch {
    return 1;
  }
}

function cloudStorageKey(userId) {
  return `${CLOUD_KEY_PREFIX}${encodeURIComponent(userId || "")}`;
}

function loadUsers() {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function userIdFromEmail(email) {
  return `email_${normalizeEmail(email).replace(/[^a-z0-9@._-]/gi, "_")}`;
}

function userIdFromSocial(provider, socialId) {
  return `${provider}_${String(socialId).replace(/[^a-z0-9._-]/gi, "_")}`;
}

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 120000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyPassword(password, salt, expectedHash) {
  const actual = await hashPassword(password, salt);
  return actual === expectedHash;
}

function findUserByEmail(email) {
  const normalized = normalizeEmail(email);
  return loadUsers().find((u) => normalizeEmail(u.email) === normalized);
}

function findUserById(userId) {
  return loadUsers().find((u) => u.userId === userId);
}

async function registerEmailUser({ name, email, password }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password) throw new Error("이메일과 비밀번호를 입력해 주세요.");
  if (password.length < 6) throw new Error("비밀번호는 6자 이상이어야 합니다.");
  if (findUserByEmail(normalizedEmail)) throw new Error("이미 가입된 이메일입니다.");

  const salt = crypto.randomUUID();
  const passwordHash = await hashPassword(password, salt);
  const user = {
    userId: userIdFromEmail(normalizedEmail),
    email: normalizedEmail,
    name: String(name || "").trim() || normalizedEmail.split("@")[0] || "사용자",
    provider: "email",
    salt,
    passwordHash,
    createdAt: new Date().toISOString()
  };
  const users = loadUsers();
  users.push(user);
  saveUsers(users);
  return user;
}

async function loginEmailUser({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const user = findUserByEmail(normalizedEmail);
  if (!user || user.provider !== "email") throw new Error("가입되지 않은 이메일이거나 소셜 로그인 계정입니다.");
  const ok = await verifyPassword(password, user.salt, user.passwordHash);
  if (!ok) throw new Error("비밀번호가 올바르지 않습니다.");
  return user;
}

function upsertSocialUser({ provider, email, name, socialId }) {
  const userId = userIdFromSocial(provider, socialId);
  const users = loadUsers();
  let user = users.find((u) => u.userId === userId);
  const normalizedEmail = normalizeEmail(email) || `${userId}@${provider}.user`;
  if (!user) {
    user = {
      userId,
      email: normalizedEmail,
      name: String(name || "").trim() || `${AUTH_PROVIDER_LABELS[provider] || provider} 사용자`,
      provider,
      socialId: String(socialId),
      createdAt: new Date().toISOString()
    };
    users.push(user);
  } else {
    user.email = normalizedEmail;
    user.name = String(name || "").trim() || user.name;
    user.socialId = String(socialId);
  }
  saveUsers(users);
  return user;
}

function loadAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) {
      return { isLoggedIn: false, userId: "guest", name: "게스트", email: "", provider: "" };
    }
    const parsed = JSON.parse(raw);
    if (parsed?.isLoggedIn && parsed?.userId) {
      return {
        isLoggedIn: true,
        userId: String(parsed.userId),
        name: String(parsed.name || "사용자"),
        email: String(parsed.email || ""),
        provider: String(parsed.provider || "email")
      };
    }
  } catch {
    /* ignore */
  }
  return { isLoggedIn: false, userId: "guest", name: "게스트", email: "", provider: "" };
}

function saveAuth() {
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

function parseJwtPayload(token) {
  const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const json = atob(base64);
  return JSON.parse(json);
}

function captureNaverOAuthReturn() {
  const hash = window.location.hash || "";
  if (!hash.includes("access_token=")) return null;
  const params = new URLSearchParams(hash.slice(1));
  const token = params.get("access_token");
  const state = params.get("state");
  const expected = sessionStorage.getItem(NAVER_OAUTH_STATE_KEY);
  if (!token || !state || state !== expected) return null;
  sessionStorage.removeItem(NAVER_OAUTH_STATE_KEY);
  const cleanUrl = `${window.location.pathname}${window.location.search}`;
  history.replaceState(null, "", cleanUrl);
  return token;
}

const bootOAuthToken = captureNaverOAuthReturn();

function getSavedItemCount() {
  return (Array.isArray(state.links) ? state.links.length : 0) + (Array.isArray(state.localPdfs) ? state.localPdfs.length : 0);
}

function getWebReadTrail(link) {
  const base = {
    locationNote: "",
    selectedText: "",
    progressPercent: 0,
    updatedAt: null
  };
  if (!link || typeof link !== "object") return base;
  const t = link.readTrail;
  if (!t || typeof t !== "object") return base;
  return {
    locationNote: typeof t.locationNote === "string" ? t.locationNote : "",
    selectedText: typeof t.selectedText === "string" ? t.selectedText : "",
    progressPercent: Number.isFinite(t.progressPercent) ? Math.max(0, Math.min(100, t.progressPercent)) : 0,
    updatedAt: t.updatedAt || null
  };
}

function saveWebReadTrail(link, nextTrail) {
  if (!link || !nextTrail) return;
  link.readTrail = {
    locationNote: String(nextTrail.locationNote || "").trim(),
    selectedText: String(nextTrail.selectedText || "").trim(),
    progressPercent: Math.max(0, Math.min(100, Number(nextTrail.progressPercent) || 0)),
    updatedAt: new Date().toISOString()
  };
  saveAndRender();
}

function getWebMemo(link) {
  const base = {
    whySaved: "",
    keyPoints: "",
    myThoughts: "",
    nextPoint: "",
    tagsText: "",
    readHint: "",
    updatedAt: null
  };
  if (!link || typeof link !== "object") return base;
  const m = link.webMemo;
  if (!m || typeof m !== "object") return base;
  return {
    whySaved: typeof m.whySaved === "string" ? m.whySaved : "",
    keyPoints: typeof m.keyPoints === "string" ? m.keyPoints : "",
    myThoughts: typeof m.myThoughts === "string" ? m.myThoughts : "",
    nextPoint: typeof m.nextPoint === "string" ? m.nextPoint : "",
    tagsText: typeof m.tagsText === "string" ? m.tagsText : "",
    readHint: typeof m.readHint === "string" ? m.readHint : "",
    updatedAt: m.updatedAt || null
  };
}

function saveWebMemo(link, memoDraft) {
  if (!link || !memoDraft) return;
  link.webMemo = {
    whySaved: String(memoDraft.whySaved || "").trim(),
    keyPoints: String(memoDraft.keyPoints || "").trim(),
    myThoughts: String(memoDraft.myThoughts || "").trim(),
    nextPoint: String(memoDraft.nextPoint || "").trim(),
    tagsText: String(memoDraft.tagsText || "").trim(),
    readHint: String(memoDraft.readHint || "").trim(),
    updatedAt: new Date().toISOString()
  };
  // Keep legacy fields for compatibility with existing list/share paths.
  link.description = [link.webMemo.whySaved, link.webMemo.keyPoints, link.webMemo.myThoughts].filter(Boolean).join(" | ");
  link.readTrail = {
    locationNote: link.webMemo.readHint,
    selectedText: link.readTrail?.selectedText || "",
    progressPercent: link.readTrail?.progressPercent || 0,
    updatedAt: link.webMemo.updatedAt
  };
  saveAndRender();
}

function getOriginalUrl(link) {
  return link?.originalUrl || link?.url || "";
}

function getReaderState(link) {
  const rs = link?.readerState;
  if (!rs || typeof rs !== "object") {
    return { scrollRatio: 0, lastParagraphId: null, updatedAt: null };
  }
  return {
    scrollRatio: Math.max(0, Math.min(1, Number(rs.scrollRatio) || 0)),
    lastParagraphId: rs.lastParagraphId || null,
    updatedAt: rs.updatedAt || null
  };
}

function normalizeReaderLink(link) {
  if (!link || typeof link !== "object") return;
  if (!link.originalUrl) link.originalUrl = link.url || "";
  if (typeof link.content !== "string") link.content = "";
  if (!link.contentStatus) {
    link.contentStatus = link.content.trim() ? "ready" : "failed";
  }
  link.readerState = getReaderState(link);
}

function getContentStatusLabel(status) {
  if (status === "ready") return "본문 저장됨";
  if (status === "pending") return "본문 가져오는 중...";
  return "본문 추출 실패, 직접 붙여넣기 필요";
}

function readerPageUrl(linkId, restart) {
  const qs = restart ? "?restart=1" : "";
  return `/#read/${encodeURIComponent(linkId)}${qs}`;
}

let activeReaderLinkId = null;
let readerSaveTimer = null;

function persistStateOnly() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (auth.isLoggedIn) {
    localStorage.setItem(cloudStorageKey(auth.userId), JSON.stringify(state));
  }
}

function getReaderContentHtml(link) {
  if (link.contentStatus === "ready" && String(link.content || "").trim()) {
    return link.content;
  }
  const fallback = String(link.description || "").trim() || getWebMemo(link).keyPoints.trim();
  if (fallback.length >= 40 && window.KeepPointContentExtract?.plainTextToReaderHtml) {
    return window.KeepPointContentExtract.plainTextToReaderHtml(fallback);
  }
  return "";
}

function getReaderScrollRatio(container) {
  const max = Math.max(1, container.scrollHeight - container.clientHeight);
  return Math.max(0, Math.min(1, container.scrollTop / max));
}

function findReaderParagraphId(container) {
  const blocks = container.querySelectorAll('[id^="kp-p-"]');
  let lastId = null;
  const marker = container.clientHeight * 0.35;
  for (const el of blocks) {
    if (el.offsetTop - container.scrollTop <= marker) lastId = el.id;
  }
  return lastId;
}

function saveReaderScrollPosition() {
  const link = state.links.find((l) => l.id === activeReaderLinkId);
  const scrollEl = document.getElementById("readerScroll");
  if (!link || !scrollEl) return;
  link.readerState = {
    scrollRatio: getReaderScrollRatio(scrollEl),
    lastParagraphId: findReaderParagraphId(scrollEl),
    updatedAt: new Date().toISOString()
  };
  link.lastVisitedAt = new Date().toISOString();
  persistStateOnly();
  const progressEl = document.getElementById("readerProgress");
  if (progressEl) progressEl.textContent = `${Math.round(link.readerState.scrollRatio * 100)}%`;
  const statusEl = document.getElementById("readerSaveStatus");
  if (statusEl) statusEl.textContent = "저장됨";
}

function scheduleReaderSave() {
  const statusEl = document.getElementById("readerSaveStatus");
  if (statusEl) statusEl.textContent = "저장 중...";
  clearTimeout(readerSaveTimer);
  readerSaveTimer = setTimeout(saveReaderScrollPosition, 350);
}

function restoreReaderScrollPosition(link, restart) {
  const scrollEl = document.getElementById("readerScroll");
  if (!scrollEl || restart) return;
  const rs = getReaderState(link);
  if (rs.lastParagraphId) {
    const el = document.getElementById(rs.lastParagraphId);
    if (el) {
      el.scrollIntoView({ block: "start" });
      el.classList.add("reader-current");
      return;
    }
  }
  if (rs.scrollRatio > 0) {
    const max = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
    scrollEl.scrollTop = max * rs.scrollRatio;
  }
}

function closeReaderOverlay(fromPopstate = false) {
  saveReaderScrollPosition();
  activeReaderLinkId = null;
  const overlay = document.getElementById("readerOverlay");
  if (overlay) {
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
  }
  document.body.style.overflow = "";
  if (!fromPopstate) {
    const base = window.location.pathname + window.location.search;
    history.replaceState(null, "", base);
  }
  render();
}

function showReaderOverlay(link, restart) {
  const overlay = document.getElementById("readerOverlay");
  const scrollEl = document.getElementById("readerScroll");
  const articleEl = document.getElementById("readerArticle");
  const emptyEl = document.getElementById("readerEmpty");
  const titleEl = document.getElementById("readerTitle");
  const originalEl = document.getElementById("readerOriginalLink");
  const progressEl = document.getElementById("readerProgress");
  const originalUrl = getOriginalUrl(link);

  if (!overlay || !scrollEl || !articleEl) {
    window.location.href = `/reader.html?id=${encodeURIComponent(link.id)}`;
    return;
  }

  activeReaderLinkId = link.id;
  if (titleEl) titleEl.textContent = link.title || "Reader";
  if (originalEl) {
    originalEl.href = originalUrl || "#";
    originalEl.textContent = originalUrl || "원본";
  }

  const html = getReaderContentHtml(link);
  if (!html) {
    scrollEl.classList.add("hidden");
    emptyEl?.classList.remove("hidden");
    const pasteInput = document.getElementById("readerPasteInput");
    if (pasteInput) pasteInput.value = "";
  } else {
    articleEl.innerHTML = html;
    scrollEl.classList.remove("hidden");
    emptyEl?.classList.add("hidden");
    requestAnimationFrame(() => restoreReaderScrollPosition(link, restart));
  }

  if (progressEl) {
    const ratio = restart ? 0 : getReaderState(link).scrollRatio;
    progressEl.textContent = `${Math.round(ratio * 100)}%`;
  }

  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  if (!scrollEl.dataset.bound) {
    scrollEl.dataset.bound = "1";
    scrollEl.addEventListener("scroll", scheduleReaderSave, { passive: true });
  }
}

function openReader(linkId, restart = false) {
  const link = state.links.find((l) => l.id === linkId);
  if (!link) {
    alert("링크를 찾을 수 없습니다.");
    return;
  }
  link.lastVisitedAt = new Date().toISOString();
  persistStateOnly();
  showReaderOverlay(link, restart);
  history.pushState({ reader: linkId }, "", readerPageUrl(linkId, restart));
}

function bindReaderOverlayEvents() {
  document.getElementById("readerBackBtn")?.addEventListener("click", closeReaderOverlay);
  document.getElementById("readerOpenOriginalBtn")?.addEventListener("click", () => {
    const link = state.links.find((l) => l.id === activeReaderLinkId);
    if (link) openOriginalUrl(link);
  });
  document.getElementById("readerSavePasteBtn")?.addEventListener("click", () => {
    const link = state.links.find((l) => l.id === activeReaderLinkId);
    const text = document.getElementById("readerPasteInput")?.value || "";
    if (!link) return;
    saveManualReaderContent(link, text);
    showReaderOverlay(link, true);
  });
  window.addEventListener("popstate", () => {
    if (activeReaderLinkId && !location.hash.startsWith("#read/")) {
      closeReaderOverlay(true);
    }
  });
}

function openReaderFromHash() {
  const match = location.hash.match(/^#read\/([^/?#]+)/);
  if (!match) return;
  const linkId = decodeURIComponent(match[1]);
  const restart = location.search.includes("restart=1");
  const link = state.links.find((l) => l.id === linkId);
  if (link) {
    activeReaderLinkId = linkId;
    showReaderOverlay(link, restart);
  }
}

function openOriginalUrl(link) {
  const url = normalizeUrl(getOriginalUrl(link));
  if (!url) {
    alert("원본 URL이 없습니다.");
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

async function extractAndApplyToLink(link) {
  const url = getOriginalUrl(link);
  if (!url || isPdfUrl(url)) return;
  link.contentStatus = "pending";
  saveAndRender();
  const result = await window.KeepPointContentExtract.extractFromUrl(url);
  if (result.title) link.title = result.title;
  link.content = result.content || "";
  link.contentStatus = result.status === "ready" ? "ready" : "failed";
  saveAndRender();
}

function saveManualReaderContent(link, rawText) {
  const text = String(rawText || "").trim();
  if (!text) {
    alert("붙여넣을 본문을 입력해 주세요.");
    return;
  }
  link.content = window.KeepPointContentExtract.plainTextToReaderHtml(text);
  link.contentStatus = "ready";
  link.readerState = { scrollRatio: 0, lastParagraphId: null, updatedAt: null };
  saveAndRender();
}

const defaultData = {
  profile: { name: "게스트" },
  categories: [
    { id: "c1", name: "과제" },
    { id: "c2", name: "나중에 볼 것" }
  ],
  links: [
    {
      id: "l1",
      categoryId: "c1",
      title: "한국민족문화대백과사전",
      url: "https://encykorea.aks.ac.kr/Article/E0024657",
      tags: ["역사", "북로군정서"],
      description: "북로군정서는 1919년에 조직되었고 김좌진을 총사령관으로 하였다. 1920년 청산리 전투에서 승리하였다.",
      lastVisitedAt: "2025-02-01T12:00:00.000Z"
    },
    {
      id: "l2",
      categoryId: "c2",
      title: "Naver",
      url: "https://naver.com",
      tags: ["검색"],
      description: "나중에 참고할 검색 링크",
      lastVisitedAt: "2025-02-05T12:00:00.000Z"
    },
    {
      id: "l3",
      categoryId: "c1",
      title: "샘플 PDF",
      url: "sample.pdf",
      tags: ["데모"],
      description: "PDF 링크는 내부 뷰어에서 열 수 있습니다.",
      lastVisitedAt: "2025-02-05T14:00:00.000Z"
    }
  ],
  localPdfs: [],
  ui: {
    selectedCategoryId: ALL_CATEGORY,
    selectedLinkId: "l2",
    expandedDescription: false,
    readPositions: {},
    loginPromptedForLimit: false
  }
};

const auth = loadAuth();
const state = load();
normalizeState();
const autoSaveTimers = new Map();
const readPositionTimers = new Map();
const runtimeSaveStatus = {};
let teardownDetailView = () => {};

const categoryTabs = document.getElementById("categoryTabs");
const recentList = document.getElementById("recentList");
const linkList = document.getElementById("linkList");
const localPdfList = document.getElementById("localPdfList");
const localPdfCategoryTitle = document.getElementById("localPdfCategoryTitle");
const detailView = document.getElementById("detailView");
const currentCategoryTitle = document.getElementById("currentCategoryTitle");
const profileName = document.getElementById("profileName");
const openLoginBtn = document.getElementById("openLoginBtn");
const openProfileBtn = document.getElementById("openProfileBtn");
const quickAddInput = document.getElementById("quickAddInput");
const quickAddBtn = document.getElementById("quickAddBtn");
const pdfFileInput = document.getElementById("pdfFileInput");
const pickPdfBtn = document.getElementById("pickPdfBtn");
const categoryModal = document.getElementById("categoryModal");
const categoryForm = document.getElementById("categoryForm");
const categoryNameInput = document.getElementById("categoryNameInput");
const loginModal = document.getElementById("loginModal");
const loginForm = document.getElementById("loginForm");
const loginHelperText = document.getElementById("loginHelperText");
const authLoginPanel = document.getElementById("authLoginPanel");
const authSignupPanel = document.getElementById("authSignupPanel");
const loginEmailInput = document.getElementById("loginEmailInput");
const loginPasswordInput = document.getElementById("loginPasswordInput");
const signupNameInput = document.getElementById("signupNameInput");
const signupEmailInput = document.getElementById("signupEmailInput");
const signupPasswordInput = document.getElementById("signupPasswordInput");
const signupPasswordConfirmInput = document.getElementById("signupPasswordConfirmInput");
const authPrimaryBtn = document.getElementById("authPrimaryBtn");
const authErrorText = document.getElementById("authErrorText");
const googleLoginBtn = document.getElementById("googleLoginBtn");
const naverLoginBtn = document.getElementById("naverLoginBtn");
const oauthSetupHelpBtn = document.getElementById("oauthSetupHelpBtn");
const oauthSetupModal = document.getElementById("oauthSetupModal");
const profileModal = document.getElementById("profileModal");
const profileStatusText = document.getElementById("profileStatusText");
const profileNameInput = document.getElementById("profileNameInput");
const profileEmailInput = document.getElementById("profileEmailInput");
const profileProviderInput = document.getElementById("profileProviderInput");
const deleteAccountBtn = document.getElementById("deleteAccountBtn");
let authModalMode = "login";
const guestNotice = document.getElementById("guestNotice");
const syncAcrossDevicesBtn = document.getElementById("syncAcrossDevicesBtn");
const connectExtensionBtn = document.getElementById("connectExtensionBtn");
const saveAiSummaryBtn = document.getElementById("saveAiSummaryBtn");
const createShareLinkBtn = document.getElementById("createShareLinkBtn");

const addCategoryBtn = document.getElementById("addCategoryBtn");
const deleteCategoryBtn = document.getElementById("deleteCategoryBtn");
if (addCategoryBtn) {
  addCategoryBtn.addEventListener("click", () => {
    if (categoryNameInput) categoryNameInput.value = "";
    categoryModal?.showModal();
  });
}
if (deleteCategoryBtn) deleteCategoryBtn.addEventListener("click", deleteSelectedCategory);
if (categoryForm) categoryForm.addEventListener("submit", onCategoryFormSubmit);
if (openLoginBtn) openLoginBtn.addEventListener("click", () => openLoginModal("manual"));
if (openProfileBtn) openProfileBtn.addEventListener("click", openProfileModal);
if (loginForm) loginForm.addEventListener("submit", onAuthFormSubmit);
if (googleLoginBtn) googleLoginBtn.addEventListener("click", onGoogleLoginClick);
if (naverLoginBtn) naverLoginBtn.addEventListener("click", onNaverLoginClick);
if (oauthSetupHelpBtn) oauthSetupHelpBtn.addEventListener("click", openOAuthSetupGuide);
for (const copyBtn of document.querySelectorAll(".oauth-copy-btn")) {
  copyBtn.addEventListener("click", () => {
    const target = document.getElementById(copyBtn.dataset.copyTarget || "");
    if (!target) return;
    navigator.clipboard?.writeText(target.textContent || "").then(
      () => alert("복사했습니다."),
      () => alert(target.textContent || "")
    );
  });
}
for (const tabBtn of document.querySelectorAll("[data-auth-tab]")) {
  tabBtn.addEventListener("click", () => setAuthModalMode(tabBtn.dataset.authTab));
}
if (deleteAccountBtn) deleteAccountBtn.addEventListener("click", onDeleteAccount);
if (syncAcrossDevicesBtn) syncAcrossDevicesBtn.addEventListener("click", onSyncAcrossDevicesClick);
if (connectExtensionBtn) connectExtensionBtn.addEventListener("click", onConnectExtensionClick);
if (saveAiSummaryBtn) saveAiSummaryBtn.addEventListener("click", onSaveAiSummaryClick);
if (createShareLinkBtn) createShareLinkBtn.addEventListener("click", onCreateShareLinkClick);
if (quickAddInput) quickAddInput.addEventListener("keydown", onQuickAdd);
if (quickAddBtn) quickAddBtn.addEventListener("click", addQuickLinkFromInput);
if (pickPdfBtn && pdfFileInput) {
  pickPdfBtn.addEventListener("click", () => pdfFileInput.click());
  pdfFileInput.addEventListener("change", onPdfFileSelected);
}

function requireLoginFor(reason) {
  if (auth.isLoggedIn) return true;
  openLoginModal(reason);
  return false;
}

function onSyncAcrossDevicesClick() {
  if (!requireLoginFor("sync")) return;
  alert("로그인된 계정의 클라우드 동기화가 활성화되어 있습니다.");
}

function onConnectExtensionClick() {
  if (!requireLoginFor("extension")) return;
  alert("Chrome 확장프로그램 화면을 열어 KeepPoint 확장을 연결해 주세요.");
}

function openProfileModal() {
  if (!profileModal) return;
  if (!auth.isLoggedIn) {
    openLoginModal("manual");
    return;
  }
  if (profileStatusText) profileStatusText.textContent = "로그인된 계정 정보";
  if (profileNameInput) profileNameInput.value = auth.name || "";
  if (profileEmailInput) profileEmailInput.value = auth.email || "";
  if (profileProviderInput) {
    profileProviderInput.value = AUTH_PROVIDER_LABELS[auth.provider] || auth.provider || "이메일";
  }
  profileModal.showModal();
}

function onDeleteAccount() {
  if (!auth.isLoggedIn) return;
  const ok = confirm("계정을 삭제할까요?\n클라우드에 저장된 계정 데이터가 삭제되고 게스트 모드로 전환됩니다.");
  if (!ok) return;

  const cloudKey = cloudStorageKey(auth.userId);
  localStorage.removeItem(cloudKey);
  localStorage.removeItem(AUTH_KEY);
  const users = loadUsers().filter((u) => u.userId !== auth.userId);
  saveUsers(users);

  auth.isLoggedIn = false;
  auth.userId = "guest";
  auth.name = "게스트";
  auth.email = "";
  auth.provider = "";

  state.profile.name = "게스트";
  state.ui.loginPromptedForLimit = false;
  saveAndRender();
  if (profileModal?.open) profileModal.close();
}

function onSaveAiSummaryClick() {
  if (!requireLoginFor("ai-summary")) return;
  alert("AI 요약이 계정에 저장되었습니다.");
}

function onCreateShareLinkClick() {
  if (!requireLoginFor("share-link")) return;
  const link = state.links.find((x) => x.id === state.ui.selectedLinkId);
  if (!link) {
    alert("공유할 링크를 먼저 선택해 주세요.");
    return;
  }
  shareLink(link.id);
}

function setAuthError(message) {
  if (!authErrorText) return;
  if (!message) {
    authErrorText.textContent = "";
    authErrorText.classList.add("hidden");
    return;
  }
  authErrorText.textContent = message;
  authErrorText.classList.remove("hidden");
}

function setAuthModalMode(mode) {
  authModalMode = mode === "signup" ? "signup" : "login";
  for (const tabBtn of document.querySelectorAll("[data-auth-tab]")) {
    tabBtn.classList.toggle("active", tabBtn.dataset.authTab === authModalMode);
  }
  authLoginPanel?.classList.toggle("hidden", authModalMode !== "login");
  authSignupPanel?.classList.toggle("hidden", authModalMode !== "signup");
  if (authPrimaryBtn) authPrimaryBtn.textContent = authModalMode === "signup" ? "회원가입" : "로그인";
  setAuthError("");
}

function resetAuthFormFields() {
  if (loginEmailInput) loginEmailInput.value = auth.email || "";
  if (loginPasswordInput) loginPasswordInput.value = "";
  if (signupNameInput) signupNameInput.value = "";
  if (signupEmailInput) signupEmailInput.value = "";
  if (signupPasswordInput) signupPasswordInput.value = "";
  if (signupPasswordConfirmInput) signupPasswordConfirmInput.value = "";
  setAuthError("");
}

function openLoginModal(reason) {
  if (!loginModal) return;
  const reasonMap = {
    limit: "읽던 위치를 계속 보관하려면 로그인하세요.",
    sync: "로그인하면 다른 기기에서도 이어 읽을 수 있어요.",
    extension: "Chrome Extension 연동은 로그인 후 사용할 수 있어요.",
    "ai-summary": "AI 요약 저장은 로그인 후 사용할 수 있어요.",
    "share-link": "공유 링크 만들기는 로그인 후 사용할 수 있어요.",
    manual: "이메일로 로그인하거나 회원가입·간편 로그인을 이용하세요."
  };
  const msg = reasonMap[reason] || reasonMap.manual;
  if (loginHelperText) loginHelperText.textContent = msg;
  setAuthModalMode("login");
  resetAuthFormFields();
  loginModal.showModal();
}

async function migrateGuestDataToUser(userId) {
  const cloudPayload = structuredClone(state);
  cloudPayload.profile = { name: auth.name };

  const pdfReading = {};
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("keepPoint_pdf_")) {
      const raw = localStorage.getItem(key);
      if (raw != null) pdfReading[key] = raw;
    }
  }
  cloudPayload.__pdfReading = pdfReading;
  localStorage.setItem(cloudStorageKey(userId), JSON.stringify(cloudPayload));

  try {
    const all = await idbGetAllLocalPdfRecords();
    await Promise.all(
      all.map((rec) => {
        if (!rec || rec.ownerId === userId) return Promise.resolve();
        const next = { ...rec, ownerId: userId };
        return idbPutLocalPdfRecord(next);
      })
    );
  } catch (e) {
    console.error(e);
  }
}

async function completeLoginFromUser(user) {
  auth.isLoggedIn = true;
  auth.userId = user.userId;
  auth.name = user.name;
  auth.email = user.email;
  auth.provider = user.provider || "email";
  saveAuth();
  await migrateGuestDataToUser(user.userId);
  state.profile.name = user.name;
  saveAndRender();
  if (loginModal?.open) loginModal.close();
}

async function onAuthFormSubmit(event) {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  setAuthError("");
  try {
    if (authModalMode === "signup") {
      const name = String(signupNameInput?.value || "").trim();
      const email = String(signupEmailInput?.value || "").trim();
      const password = String(signupPasswordInput?.value || "");
      const confirm = String(signupPasswordConfirmInput?.value || "");
      if (!email || !password) {
        setAuthError("이메일과 비밀번호를 입력해 주세요.");
        return;
      }
      if (password !== confirm) {
        setAuthError("비밀번호 확인이 일치하지 않습니다.");
        return;
      }
      const user = await registerEmailUser({ name, email, password });
      await completeLoginFromUser(user);
      return;
    }
    const email = String(loginEmailInput?.value || "").trim();
    const password = String(loginPasswordInput?.value || "");
    if (!email || !password) {
      setAuthError("이메일과 비밀번호를 입력해 주세요.");
      return;
    }
    const user = await loginEmailUser({ email, password });
    await completeLoginFromUser(user);
  } catch (err) {
    setAuthError(err?.message || "로그인에 실패했습니다.");
  }
}

function getOAuthRedirectUri() {
  return `${window.location.origin}${window.location.pathname}`;
}

function isOAuthSupportedOrigin() {
  return window.location.protocol === "http:" || window.location.protocol === "https:";
}

function openOAuthSetupGuide() {
  if (!oauthSetupModal) return;
  const origin = isOAuthSupportedOrigin() ? window.location.origin : "http://localhost:3000";
  const callback = isOAuthSupportedOrigin()
    ? getOAuthRedirectUri()
    : "http://localhost:3000/index.html";
  const example = `${origin}/index.html`;
  const originEl = document.getElementById("oauthGoogleOrigin");
  const callbackEl = document.getElementById("oauthNaverCallback");
  const exampleEl = document.getElementById("oauthExampleUrl");
  if (originEl) originEl.textContent = origin;
  if (callbackEl) callbackEl.textContent = callback;
  if (exampleEl) exampleEl.textContent = example;
  oauthSetupModal.showModal();
}

function onGoogleLoginClick() {
  setAuthError("");
  if (!isOAuthSupportedOrigin()) {
    setAuthError("파일로 직접 열면 Google 로그인이 되지 않습니다. 로컬 서버로 실행해 주세요.");
    openOAuthSetupGuide();
    return;
  }
  const clientId = String(AUTH_CONFIG.googleClientId || "").trim();
  if (!clientId) {
    setAuthError("auth-config.js에 googleClientId를 입력해 주세요. (설정 방법 버튼 참고)");
    openOAuthSetupGuide();
    return;
  }
  if (!window.google?.accounts?.oauth2) {
    setAuthError("Google 로그인 스크립트를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.");
    return;
  }
  const client = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: "openid email profile",
    callback: async (tokenResponse) => {
      if (tokenResponse.error) {
        setAuthError("Google 로그인이 취소되었거나 실패했습니다.");
        return;
      }
      try {
        const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
        });
        if (!res.ok) throw new Error("Google 프로필을 가져오지 못했습니다.");
        const profile = await res.json();
        const user = upsertSocialUser({
          provider: "google",
          email: profile.email,
          name: profile.name,
          socialId: profile.sub
        });
        await completeLoginFromUser(user);
      } catch (err) {
        setAuthError(err?.message || "Google 로그인에 실패했습니다.");
      }
    }
  });
  client.requestAccessToken();
}

function onNaverLoginClick() {
  setAuthError("");
  if (!isOAuthSupportedOrigin()) {
    setAuthError("파일로 직접 열면 네이버 로그인이 되지 않습니다. 로컬 서버로 실행해 주세요.");
    openOAuthSetupGuide();
    return;
  }
  const clientId = String(AUTH_CONFIG.naverClientId || "").trim();
  if (!clientId) {
    setAuthError("auth-config.js에 naverClientId를 입력해 주세요. (설정 방법 버튼 참고)");
    openOAuthSetupGuide();
    return;
  }
  const state = crypto.randomUUID();
  sessionStorage.setItem(NAVER_OAUTH_STATE_KEY, state);
  const redirectUri = getOAuthRedirectUri();
  const url = new URL("https://nid.naver.com/oauth2.0/authorize");
  url.searchParams.set("response_type", "token");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  window.location.href = url.toString();
}

async function completeNaverLogin(accessToken) {
  const res = await fetch("https://openapi.naver.com/v1/nid/me", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error("네이버 프로필을 가져오지 못했습니다.");
  const data = await res.json();
  if (data.resultcode !== "00") throw new Error("네이버 로그인에 실패했습니다.");
  const profile = data.response || {};
  const user = upsertSocialUser({
    provider: "naver",
    email: profile.email || `naver_${profile.id}@naver.user`,
    name: profile.name || profile.nickname || "네이버 사용자",
    socialId: profile.id
  });
  await completeLoginFromUser(user);
}

function maybePromptLoginByLimit(previousCount) {
  if (auth.isLoggedIn) return;
  if (state.ui.loginPromptedForLimit) return;
  const before = Number.isFinite(previousCount) ? previousCount : getSavedItemCount();
  const after = getSavedItemCount();
  if (!(before < 3 && after >= 3)) return;
  state.ui.loginPromptedForLimit = true;
  saveAndRender();
  openLoginModal("limit");
}

function onCategoryFormSubmit(event) {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  const name = categoryNameInput.value.trim();
  if (!name) {
    alert("카테고리 이름을 입력해 주세요.");
    return;
  }
  const id = createId("c");
  state.categories.push({ id, name });
  state.ui.selectedCategoryId = id;
  state.ui.selectedLinkId = null;
  saveAndRender();
  categoryModal.close();
}

async function onQuickAdd(event) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  await addQuickLinkFromInput();
}

async function addQuickLinkFromInput() {
  const rawUrl = quickAddInput.value.trim();
  if (!rawUrl) return;

  const parsed = normalizeUrl(rawUrl);
  if (!parsed) {
    if (/file:/i.test(rawUrl)) {
      alert("로컬 PDF는 「내 PDF 열기」를 사용해 주세요.");
    } else {
      alert("올바른 링크를 붙여넣어 주세요.");
    }
    return;
  }

  const targetCategoryId = state.ui.selectedCategoryId === ALL_CATEGORY
    ? state.categories[0]?.id
    : state.ui.selectedCategoryId;

  if (!targetCategoryId) {
    alert("먼저 카테고리를 생성해 주세요.");
    return;
  }

  const previousCount = getSavedItemCount();
  const isPdf = isPdfUrl(parsed);
  let title = await autoTitleFromUrl(parsed);
  let content = "";
  let contentStatus = "failed";

  if (!isPdf) {
    if (quickAddBtn) {
      quickAddBtn.disabled = true;
      quickAddBtn.textContent = "본문 가져오는 중...";
    }
    try {
      const extracted = await window.KeepPointContentExtract.extractFromUrl(parsed);
      if (extracted.title) title = extracted.title;
      content = extracted.content || "";
      contentStatus = extracted.status === "ready" ? "ready" : "failed";
    } catch {
      contentStatus = "failed";
    } finally {
      if (quickAddBtn) {
        quickAddBtn.disabled = false;
        quickAddBtn.textContent = "추가";
      }
    }
  }

  const link = {
    id: createId("l"),
    categoryId: targetCategoryId,
    title,
    url: parsed,
    originalUrl: parsed,
    content,
    contentStatus: isPdf ? null : contentStatus,
    readerState: { scrollRatio: 0, lastParagraphId: null, updatedAt: null },
    tags: [],
    description: "",
    webMemo: { whySaved: "", keyPoints: "", myThoughts: "", nextPoint: "", tagsText: "", readHint: "", updatedAt: null },
    readTrail: { locationNote: "", selectedText: "", progressPercent: 0, updatedAt: null },
    lastVisitedAt: new Date().toISOString()
  };

  state.links.unshift(link);
  state.ui.selectedCategoryId = targetCategoryId;
  selectLink(link.id);
  quickAddInput.value = "";
  if (!isPdf && contentStatus === "failed") {
    alert("본문 추출 실패, 직접 붙여넣기 필요\n상세 패널에서 본문을 붙여넣을 수 있습니다.");
  }
  maybePromptLoginByLimit(previousCount);
}

function openLocalPdfViewer(id) {
  const qs = new URLSearchParams();
  qs.set("localId", id);
  window.location.href = `/pdf-viewer.html?${qs.toString()}`;
}

async function deleteLocalPdf(id) {
  if (!confirm("이 PDF를 목록과 이 기기 저장소에서 삭제할까요?")) return;
  try {
    await idbDeleteLocalPdfRecord(id);
  } catch (e) {
    console.error(e);
  }
  localStorage.removeItem(getLocalPdfPageStorageKey(id));
  state.localPdfs = (state.localPdfs || []).filter((x) => x.id !== id);
  saveAndRender();
}

async function onPdfFileSelected() {
  const file = pdfFileInput.files?.[0];
  pdfFileInput.value = "";
  if (!file) return;
  const okType = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!okType) {
    alert("PDF 파일만 선택할 수 있습니다.");
    return;
  }
  const previousCount = getSavedItemCount();
  const id = createId("p");
  const baseTitle = file.name.replace(/\.pdf$/i, "") || file.name;
  const createdAt = new Date().toISOString();
  const record = {
    id,
    blob: file,
    fileName: file.name,
    title: baseTitle,
    size: file.size,
    lastModified: file.lastModified,
    createdAt
  };
  try {
    await idbPutLocalPdfRecord(record);
  } catch (e) {
    console.error(e);
    alert("PDF를 저장하지 못했습니다. IndexedDB를 사용할 수 있는지 확인해 주세요.");
    return;
  }
  const targetCategoryId = state.ui.selectedCategoryId === ALL_CATEGORY
    ? state.categories[0]?.id
    : state.ui.selectedCategoryId;
  if (!targetCategoryId) {
    alert("먼저 카테고리를 생성해 주세요.");
    try {
      await idbDeleteLocalPdfRecord(id);
    } catch {
      /* ignore */
    }
    return;
  }

  if (!Array.isArray(state.localPdfs)) state.localPdfs = [];
  state.localPdfs.unshift({
    id,
    categoryId: targetCategoryId,
    title: baseTitle,
    fileName: file.name,
    size: file.size,
    lastModified: file.lastModified,
    addedAt: createdAt
  });
  state.ui.selectedCategoryId = targetCategoryId;
  saveAndRender();
  maybePromptLoginByLimit(previousCount);
}

function render() {
  if (profileName) profileName.textContent = auth.isLoggedIn ? `${state.profile.name}` : "게스트";
  if (openLoginBtn) openLoginBtn.textContent = auth.isLoggedIn ? "다른 계정 로그인" : "로그인";
  if (openLoginBtn) openLoginBtn.disabled = false;
  if (openProfileBtn) openProfileBtn.disabled = !auth.isLoggedIn;
  if (guestNotice) {
    guestNotice.textContent = auth.isLoggedIn
      ? "로그인 완료: 다른 기기 동기화와 확장 연동 기능을 사용할 수 있어요."
      : "지금까지는 이 브라우저에만 저장돼요. 로그인하면 다른 기기에서도 이어 읽을 수 있어요.";
  }
  renderTabs();
  renderRecent();
  renderLocalPdfList();
  renderLinks();
  renderDetail();
}

function renderTabs() {
  categoryTabs.innerHTML = "";
  const tabs = [{ id: ALL_CATEGORY, name: "전체" }, ...state.categories];
  for (const tab of tabs) {
    const button = document.createElement("button");
    button.className = "tab";
    if (tab.id === state.ui.selectedCategoryId) button.classList.add("active");
    button.textContent = tab.name;
    button.addEventListener("click", () => {
      state.ui.selectedCategoryId = tab.id;
      const first = getVisibleLinks()[0];
      state.ui.selectedLinkId = first?.id || null;
      state.ui.expandedDescription = false;
      saveAndRender();
    });
    categoryTabs.appendChild(button);
  }
}

function renderRecent() {
  recentList.innerHTML = "";
  const recent = [...state.links]
    .sort((a, b) => new Date(b.lastVisitedAt || 0) - new Date(a.lastVisitedAt || 0))
    .slice(0, 5);

  if (!recent.length) {
    recentList.innerHTML = "<li>아직 최근 읽기 기록이 없습니다.</li>";
    return;
  }

  for (const link of recent) {
    const li = document.createElement("li");
    li.textContent = `${link.title} (${relativeTime(link.lastVisitedAt)})`;
    li.addEventListener("click", () => {
      state.ui.selectedCategoryId = link.categoryId;
      selectLink(link.id);
    });
    recentList.appendChild(li);
  }
}

function renderLocalPdfList() {
  if (!localPdfList) return;
  localPdfList.innerHTML = "";
  const selectedCategory = state.categories.find((c) => c.id === state.ui.selectedCategoryId);
  if (localPdfCategoryTitle) {
    localPdfCategoryTitle.textContent = selectedCategory
      ? `${selectedCategory.name} · 내 PC PDF`
      : "전체 · 내 PC PDF";
  }
  const list = getVisibleLocalPdfs();
  if (!list.length) {
    const empty = document.createElement("li");
    empty.className = "local-pdf-empty";
    empty.textContent = selectedCategory
      ? `「${selectedCategory.name}」 카테고리에 저장된 PDF가 없습니다. 「내 PDF 열기」로 이 카테고리에 추가해 주세요.`
      : "저장된 내 PC PDF가 없습니다. 카테고리를 선택한 뒤 「내 PDF 열기」로 파일을 추가해 주세요.";
    localPdfList.appendChild(empty);
    return;
  }
  for (const item of list) {
    const lastPage = getLocalPdfLastPage(item.id);
    const li = document.createElement("li");
    li.className = "local-pdf-card";
    li.innerHTML = `
      <div class="local-pdf-card-head">
        <input type="text" class="local-pdf-title-input" value="${escapeHtml(item.title)}" aria-label="PDF 제목" />
      </div>
      <div class="meta">파일: ${escapeHtml(item.fileName)}</div>
      <div class="meta">마지막 읽은 페이지: <strong>${lastPage}</strong>쪽</div>
      <div class="local-pdf-card-actions">
        <button type="button" class="btn" data-action="continue">이어 읽기</button>
        <button type="button" class="btn danger" data-action="remove">삭제</button>
      </div>
    `;
    const titleInput = li.querySelector(".local-pdf-title-input");
    titleInput.addEventListener("blur", () => {
      const newTitle = titleInput.value.trim() || item.fileName;
      if (newTitle === item.title) return;
      item.title = newTitle;
      idbGetLocalPdfRecord(item.id)
        .then((rec) => {
          if (rec) {
            rec.title = newTitle;
            return idbPutLocalPdfRecord(rec);
          }
        })
        .catch(console.error);
      saveAndRender();
    });
    li.querySelector('[data-action="continue"]').addEventListener("click", () => openLocalPdfViewer(item.id));
    li.querySelector('[data-action="remove"]').addEventListener("click", (e) => {
      e.stopPropagation();
      deleteLocalPdf(item.id);
    });
    localPdfList.appendChild(li);
  }
}

function renderLinks() {
  linkList.innerHTML = "";
  const selectedCategory = state.categories.find((c) => c.id === state.ui.selectedCategoryId);
  currentCategoryTitle.textContent = selectedCategory ? `${selectedCategory.name} 링크` : "전체 링크";

  for (const link of getVisibleLinks()) {
    const isPdf = isPdfUrl(link.url);
    const memo = getWebMemo(link);
    const readerState = getReaderState(link);
    const progressLine =
      readerState.scrollRatio > 0 ? `${Math.round(readerState.scrollRatio * 100)}%` : "0%";
    const li = document.createElement("li");
    li.className = "item";
    if (link.id === state.ui.selectedLinkId) li.classList.add("active");

    if (isPdf) {
      li.innerHTML = `
        <div>${escapeHtml(link.title)}</div>
        <div class="meta">PDF · ${escapeHtml(shortText(getOriginalUrl(link), 60))}</div>
        <div class="hover-actions">
          <button class="btn" data-action="continue">이어보기</button>
          <button class="btn ghost" data-action="original">원본 보기</button>
          <button class="btn ghost" data-action="share">공유</button>
          <button class="btn danger" data-action="delete">삭제</button>
        </div>
      `;
    } else {
      li.innerHTML = `
        <div>${escapeHtml(link.title)}</div>
        <div class="meta">원본: ${escapeHtml(shortText(getOriginalUrl(link), 55))}</div>
        <div class="meta content-status ${link.contentStatus === "ready" ? "ready" : "failed"}">${escapeHtml(getContentStatusLabel(link.contentStatus))}</div>
        <div class="meta">Reader 진행: ${progressLine}</div>
        <div class="hover-actions">
          <button class="btn" data-action="continue">이어보기</button>
          <button class="btn ghost" data-action="original">원본 보기</button>
          <button class="btn ghost" data-action="share">공유</button>
          <button class="btn danger" data-action="delete">삭제</button>
        </div>
      `;
    }

    li.addEventListener("click", (event) => {
      const action = event.target?.dataset?.action;
      if (action === "continue") {
        event.stopPropagation();
        openLinkForReading(link);
        return;
      }
      if (action === "original") {
        event.stopPropagation();
        openOriginalUrl(link);
        return;
      }
      if (action === "share") {
        event.stopPropagation();
        shareLink(link.id);
        return;
      }
      if (action === "delete") {
        event.stopPropagation();
        deleteLink(link.id);
        return;
      }
      selectLink(link.id);
    });
    linkList.appendChild(li);
  }
}

function renderDetail() {
  teardownDetailView();
  const link = state.links.find((item) => item.id === state.ui.selectedLinkId);
  if (!link) {
    detailView.classList.add("empty");
    detailView.textContent = "링크가 없습니다. 링크를 붙여넣어 바로 추가해 보세요.";
    teardownDetailView = () => {};
    return;
  }

  detailView.classList.remove("empty");
  const isPdf = isPdfUrl(link.url);
  const webMemo = getWebMemo(link);
  const pdfSnap = isPdf ? getPdfSnapshotFromStorage(link.url) : null;
  const saveStatusText = runtimeSaveStatus[link.id] || "저장됨";

  const pdfPageLine =
    pdfSnap && pdfSnap.pageNumber != null ? `마지막 페이지: ${pdfSnap.pageNumber}` : "저장된 페이지 없음";

  const webMemoHtml = `
    <section class="resume-card reader-detail-card">
      <strong>KeepPoint Reader</strong>
      <p class="meta content-status ${link.contentStatus === "ready" ? "ready" : "failed"}">${escapeHtml(getContentStatusLabel(link.contentStatus))}</p>
      <p class="meta">읽기 진행: ${Math.round(getReaderState(link).scrollRatio * 100)}%</p>
      <div class="resume-actions">
        <button type="button" class="btn" id="continueReaderBtn">이어보기</button>
        <button type="button" class="btn ghost" id="openOriginalBtn">원본 보기</button>
        <button type="button" class="btn ghost" id="retryExtractBtn">본문 다시 가져오기</button>
      </div>
      ${link.contentStatus !== "ready"
        ? `<label class="trail-field">본문 직접 붙여넣기
            <textarea id="manualContentInput" rows="10" placeholder="기사 본문을 복사해 붙여넣으세요."></textarea>
          </label>
          <button type="button" class="btn" id="saveManualContentBtn">본문 저장</button>`
        : ""}
    </section>
    <section class="resume-card">
      <strong>메모</strong>
      <label class="trail-field">왜 저장했는지
        <textarea id="webWhySavedInput" rows="2">${escapeHtml(webMemo.whySaved)}</textarea>
      </label>
      <label class="trail-field">핵심 내용
        <textarea id="webKeyPointsInput" rows="3">${escapeHtml(webMemo.keyPoints)}</textarea>
      </label>
      <label class="trail-field">태그 (쉼표로 구분)
        <input id="webTagsInput" placeholder="예: 역사, 논문" value="${escapeAttr(webMemo.tagsText)}" />
      </label>
    </section>
  `;

  detailView.innerHTML = `
    <div class="hover-actions">
      <button class="btn ghost" id="shareCurrentBtn">공유</button>
      <button class="btn danger" id="deleteCurrentBtn">삭제</button>
    </div>
    <h3>${escapeHtml(link.title)}</h3>
    <a href="${escapeAttr(getOriginalUrl(link))}" target="_blank" rel="noreferrer">원문 링크</a>
    ${isPdf
      ? `<div class="resume-card"><strong>PDF</strong><div>${pdfPageLine}</div><div class="resume-actions"><button type="button" class="btn" id="openPdfBtn">PDF 뷰어에서 열기</button><button type="button" class="btn ghost" id="restartPdfBtn">처음부터 (1페이지)</button><button type="button" class="btn danger" id="clearPdfBtn">PDF 읽기 위치 삭제</button></div></div>`
      : webMemoHtml}
    <div class="save-row">
      <span id="saveStatus" class="save-status">${escapeHtml(saveStatusText)}</span>
    </div>
    ${isPdf
      ? `<label>
          태그
          <div id="selectedTags" class="tag-editor-list"></div>
          <input id="newTagInput" placeholder="새 태그 입력 후 Enter" />
          <div id="tagSuggestions" class="tag-suggestions"></div>
        </label>
        <label>
          설명
          <textarea id="editDescInput" rows="5">${escapeHtml(link.description || "")}</textarea>
        </label>
        <p class="meta">PC에 있는 PDF는 목록 위의 <strong>내 PDF 열기</strong>로 여세요. 아래는 링크로 연 PDF입니다.</p>`
      : ""}
    <div class="meta">📍 마지막 방문: ${relativeTime(link.lastVisitedAt)}</div>
  `;

  const statusEl = document.getElementById("saveStatus");
  const descInput = document.getElementById("editDescInput");
  const selectedTagsEl = document.getElementById("selectedTags");
  const tagSuggestionsEl = document.getElementById("tagSuggestions");
  const newTagInput = document.getElementById("newTagInput");
  const openPdfBtn = document.getElementById("openPdfBtn");
  const restartPdfBtn = document.getElementById("restartPdfBtn");
  const clearPdfBtn = document.getElementById("clearPdfBtn");
  const webWhySavedInput = document.getElementById("webWhySavedInput");
  const webKeyPointsInput = document.getElementById("webKeyPointsInput");
  const webTagsInput = document.getElementById("webTagsInput");
  const continueReaderBtn = document.getElementById("continueReaderBtn");
  const openOriginalBtn = document.getElementById("openOriginalBtn");
  const retryExtractBtn = document.getElementById("retryExtractBtn");
  const manualContentInput = document.getElementById("manualContentInput");
  const saveManualContentBtn = document.getElementById("saveManualContentBtn");
  let draftDesc = link.description || "";
  let draftTags = [...link.tags];

  const updateStatus = (text) => {
    runtimeSaveStatus[link.id] = text;
    if (statusEl) statusEl.textContent = text;
  };

  const saveDraft = () => {
    updateStatus("저장 중...");
    link.description = draftDesc.trim();
    link.tags = [...new Set(draftTags)];
    saveAndRender();
    runtimeSaveStatus[link.id] = "저장됨";
    const refreshed = document.getElementById("saveStatus");
    if (refreshed) refreshed.textContent = "저장됨";
  };

  const scheduleAutoSave = () => {
    updateStatus("입력 중...");
    clearTimeout(autoSaveTimers.get(link.id));
    const timer = setTimeout(saveDraft, 1000);
    autoSaveTimers.set(link.id, timer);
  };

  const toggleTag = (tag) => {
    if (draftTags.includes(tag)) {
      draftTags = draftTags.filter((item) => item !== tag);
    } else {
      draftTags = [...draftTags, tag];
    }
    renderTagEditor();
    scheduleAutoSave();
  };

  const addTag = (rawTag) => {
    const tag = rawTag.trim();
    if (!tag) return;
    if (!draftTags.includes(tag)) {
      draftTags.push(tag);
      renderTagEditor();
      scheduleAutoSave();
    }
  };

  const renderTagEditor = () => {
    const allTags = getKnownTags();
    selectedTagsEl.innerHTML = draftTags.length
      ? draftTags
          .map((tag) => `<button class="tag-chip active" data-tag="${escapeAttr(tag)}">${escapeHtml(tag)}</button>`)
          .join("")
      : "<span class='tag-empty'>선택된 태그 없음</span>";

    tagSuggestionsEl.innerHTML = allTags.length
      ? allTags
          .map((tag) => {
            const activeClass = draftTags.includes(tag) ? "active" : "";
            return `<button class="tag-chip ${activeClass}" data-tag="${escapeAttr(tag)}">${escapeHtml(tag)}</button>`;
          })
          .join("")
      : "<span class='tag-empty'>추천 태그 없음</span>";

    selectedTagsEl.querySelectorAll("[data-tag]").forEach((button) => {
      button.addEventListener("click", () => toggleTag(button.dataset.tag));
    });
    tagSuggestionsEl.querySelectorAll("[data-tag]").forEach((button) => {
      button.addEventListener("click", () => toggleTag(button.dataset.tag));
    });
  };

  let onDescInput = null;
  let onNewTagKeydown = null;
  if (isPdf) {
    renderTagEditor();
    onDescInput = () => {
      draftDesc = descInput.value;
      scheduleAutoSave();
    };
    onNewTagKeydown = (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      addTag(newTagInput.value);
      newTagInput.value = "";
    };
    descInput.addEventListener("input", onDescInput);
    newTagInput.addEventListener("keydown", onNewTagKeydown);
  }

  const onOpenPdfClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPdfViewer(link.id, false);
  };
  const onRestartPdfClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPdfViewer(link.id, true);
  };
  const onClearPdfClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    localStorage.removeItem(getPdfReadingStorageKey(link.url));
    saveAndRender();
  };
  const readWebMemoDraft = () => ({
    readHint: getWebMemo(link).readHint,
    whySaved: webWhySavedInput?.value || "",
    keyPoints: webKeyPointsInput?.value || "",
    myThoughts: getWebMemo(link).myThoughts,
    nextPoint: getWebMemo(link).nextPoint,
    tagsText: webTagsInput?.value || ""
  });
  const onWebMemoInput = () => {
    saveWebMemo(link, readWebMemoDraft());
    updateStatus("저장됨");
  };

  if (openPdfBtn) openPdfBtn.addEventListener("click", onOpenPdfClick);
  if (restartPdfBtn) restartPdfBtn.addEventListener("click", onRestartPdfClick);
  if (clearPdfBtn) clearPdfBtn.addEventListener("click", onClearPdfClick);
  if (!isPdf) {
    continueReaderBtn?.addEventListener("click", () => openReader(link.id, false));
    openOriginalBtn?.addEventListener("click", () => openOriginalUrl(link));
    retryExtractBtn?.addEventListener("click", async () => {
      retryExtractBtn.disabled = true;
      retryExtractBtn.textContent = "가져오는 중...";
      await extractAndApplyToLink(link);
      retryExtractBtn.disabled = false;
      retryExtractBtn.textContent = "본문 다시 가져오기";
    });
    saveManualContentBtn?.addEventListener("click", () => {
      saveManualReaderContent(link, manualContentInput?.value || "");
    });
    if (webWhySavedInput) webWhySavedInput.addEventListener("blur", onWebMemoInput);
    if (webKeyPointsInput) webKeyPointsInput.addEventListener("blur", onWebMemoInput);
    if (webTagsInput) webTagsInput.addEventListener("blur", onWebMemoInput);
  }

  const onShareClick = () => shareLink(link.id);
  const onDeleteClick = () => deleteLink(link.id);
  const shareCurrentBtn = document.getElementById("shareCurrentBtn");
  const deleteCurrentBtn = document.getElementById("deleteCurrentBtn");
  if (shareCurrentBtn) shareCurrentBtn.addEventListener("click", onShareClick);
  if (deleteCurrentBtn) deleteCurrentBtn.addEventListener("click", onDeleteClick);

  teardownDetailView = () => {
    clearTimeout(autoSaveTimers.get(link.id));
    clearTimeout(readPositionTimers.get(link.id));
    if (onDescInput && descInput) descInput.removeEventListener("input", onDescInput);
    if (onNewTagKeydown && newTagInput) newTagInput.removeEventListener("keydown", onNewTagKeydown);
    if (openPdfBtn) openPdfBtn.removeEventListener("click", onOpenPdfClick);
    if (restartPdfBtn) restartPdfBtn.removeEventListener("click", onRestartPdfClick);
    if (clearPdfBtn) clearPdfBtn.removeEventListener("click", onClearPdfClick);
    if (webReadHintInput) webReadHintInput.removeEventListener("blur", onWebMemoInput);
    if (webWhySavedInput) webWhySavedInput.removeEventListener("blur", onWebMemoInput);
    if (webKeyPointsInput) webKeyPointsInput.removeEventListener("blur", onWebMemoInput);
    if (webThoughtsInput) webThoughtsInput.removeEventListener("blur", onWebMemoInput);
    if (webNextPointInput) webNextPointInput.removeEventListener("blur", onWebMemoInput);
    if (webTagsInput) webTagsInput.removeEventListener("blur", onWebMemoInput);
    if (shareCurrentBtn) shareCurrentBtn.removeEventListener("click", onShareClick);
    if (deleteCurrentBtn) deleteCurrentBtn.removeEventListener("click", onDeleteClick);
  };
}

function selectLink(linkId) {
  const link = state.links.find((item) => item.id === linkId);
  if (!link) return;
  state.ui.selectedLinkId = linkId;
  state.ui.expandedDescription = false;
  link.lastVisitedAt = new Date().toISOString();
  saveAndRender();
}

function deleteSelectedCategory() {
  if (state.ui.selectedCategoryId === ALL_CATEGORY) {
    alert("전체 탭에서는 카테고리를 삭제할 수 없습니다.");
    return;
  }
  const category = state.categories.find((item) => item.id === state.ui.selectedCategoryId);
  if (!category) return;
  const pdfsInCategory = (state.localPdfs || []).filter((item) => item.categoryId === category.id);
  const pdfNote = pdfsInCategory.length ? `\n해당 카테고리의 내 PC PDF ${pdfsInCategory.length}개도 함께 삭제됩니다.` : "";
  if (!confirm(`'${category.name}' 카테고리를 삭제할까요?\n해당 링크도 함께 삭제됩니다.${pdfNote}`)) return;

  state.categories = state.categories.filter((item) => item.id !== category.id);
  state.links = state.links.filter((item) => item.categoryId !== category.id);
  for (const pdf of pdfsInCategory) {
    idbDeleteLocalPdfRecord(pdf.id).catch(console.error);
    localStorage.removeItem(getLocalPdfPageStorageKey(pdf.id));
  }
  state.localPdfs = (state.localPdfs || []).filter((item) => item.categoryId !== category.id);
  state.ui.selectedCategoryId = ALL_CATEGORY;
  state.ui.selectedLinkId = getVisibleLinks()[0]?.id || null;
  saveAndRender();
}

function deleteLink(linkId) {
  const link = state.links.find((item) => item.id === linkId);
  if (!link) return;
  if (!confirm(`'${link.title}' 링크를 삭제할까요?`)) return;
  state.links = state.links.filter((item) => item.id !== linkId);
  delete state.ui.readPositions[linkId];
  localStorage.removeItem(getPdfReadingStorageKey(link.url));
  clearTimeout(readPositionTimers.get(linkId));
  state.ui.selectedLinkId = getVisibleLinks()[0]?.id || null;
  saveAndRender();
}

function shareLink(linkId) {
  if (!requireLoginFor("share-link")) return;
  const link = state.links.find((item) => item.id === linkId);
  if (!link) return;
  const category = state.categories.find((item) => item.id === link.categoryId);
  const memo = getWebMemo(link);
  const payload = [
    `카테고리: ${category?.name || "없음"}`,
    `제목: ${link.title}`,
    `원본: ${getOriginalUrl(link)}`,
    `Reader 진행: ${Math.round(getReaderState(link).scrollRatio * 100)}%`,
    `왜 저장했는지: ${memo.whySaved || "없음"}`,
    `핵심 내용: ${memo.keyPoints || "없음"}`,
    `태그: ${memo.tagsText || "없음"}`
  ].join("\n");
  navigator.clipboard
    .writeText(payload)
    .then(() => alert("공유 내용이 복사되었습니다."))
    .catch(() => alert("복사에 실패했습니다."));
}

function getKnownTags() {
  const tagSet = new Set();
  for (const link of state.links) {
    for (const tag of link.tags) {
      if (tag && tag.trim()) tagSet.add(tag.trim());
    }
  }
  return [...tagSet].sort((a, b) => a.localeCompare(b, "ko"));
}

function getVisibleLinks() {
  if (state.ui.selectedCategoryId === ALL_CATEGORY) return state.links;
  return state.links.filter((link) => link.categoryId === state.ui.selectedCategoryId);
}

function getVisibleLocalPdfs() {
  const list = Array.isArray(state.localPdfs) ? state.localPdfs : [];
  if (state.ui.selectedCategoryId === ALL_CATEGORY) return list;
  return list.filter((item) => item.categoryId === state.ui.selectedCategoryId);
}

function normalizeState() {
  if (!state.ui || typeof state.ui !== "object") state.ui = {};
  if (!Array.isArray(state.localPdfs)) state.localPdfs = [];
  const fallbackCategoryId = state.categories?.[0]?.id || null;
  for (const pdf of state.localPdfs) {
    if (!pdf.categoryId && fallbackCategoryId) {
      pdf.categoryId = fallbackCategoryId;
    }
  }
  if (!state.profile || typeof state.profile !== "object") state.profile = { name: "게스트" };
  if (!state.ui.loginPromptedForLimit) state.ui.loginPromptedForLimit = false;
  for (const link of state.links || []) {
    if (!link.webMemo || typeof link.webMemo !== "object") {
      const legacyTrail = getWebReadTrail(link);
      link.webMemo = {
        whySaved: "",
        keyPoints: "",
        myThoughts: "",
        nextPoint: "",
        tagsText: Array.isArray(link.tags) ? link.tags.join(", ") : "",
        readHint: legacyTrail.locationNote || "",
        updatedAt: legacyTrail.updatedAt || null
      };
    } else {
      link.webMemo = getWebMemo(link);
    }
    if (!link.readTrail || typeof link.readTrail !== "object") {
      link.readTrail = { locationNote: "", selectedText: "", progressPercent: 0, updatedAt: null };
    } else {
      link.readTrail = getWebReadTrail(link);
    }
    if (!isPdfUrl(link.url)) {
      normalizeReaderLink(link);
    }
  }
  if (!state.ui.readPositions) state.ui.readPositions = {};
  for (const [linkId, value] of Object.entries(state.ui.readPositions)) {
    if (typeof value === "number") {
      state.ui.readPositions[linkId] = {
        url: "",
        scrollY: 0,
        scrollProgress: Math.round(value * 10000) / 100,
        textAnchor: "",
        savedAt: null
      };
    } else {
      state.ui.readPositions[linkId] = {
        url: typeof value?.url === "string" ? value.url : "",
        scrollY: Number.isFinite(value?.scrollY) ? value.scrollY : 0,
        scrollProgress: Number.isFinite(value?.scrollProgress) ? value.scrollProgress : 0,
        textAnchor: typeof value?.textAnchor === "string" ? value.textAnchor : "",
        savedAt: value?.savedAt || null
      };
    }
  }
  if (!state.categories.some((c) => c.id === state.ui.selectedCategoryId) && state.ui.selectedCategoryId !== ALL_CATEGORY) {
    state.ui.selectedCategoryId = ALL_CATEGORY;
  }
  if (!state.links.some((l) => l.id === state.ui.selectedLinkId)) {
    state.ui.selectedLinkId = state.links.sort((a, b) => new Date(b.lastVisitedAt || 0) - new Date(a.lastVisitedAt || 0))[0]?.id || null;
  }
}

function normalizeUrl(value) {
  const v = String(value || "").trim();
  if (!v) return null;
  if (/^file:/i.test(v)) return null;
  try {
    const u = new URL(v);
    if (u.protocol === "file:") return null;
    return u.href;
  } catch {
    try {
      const u2 = new URL(v, window.location.href);
      if (u2.protocol === "file:") return null;
      return u2.href;
    } catch {
      try {
        const u3 = new URL(`https://${v}`);
        return u3.href;
      } catch {
        return null;
      }
    }
  }
}

async function autoTitleFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace("www.", "");
    return host;
  } catch {
    return "새 링크";
  }
}

function shortText(value, maxLen) {
  return value.length <= maxLen ? value : `${value.slice(0, maxLen)}...`;
}

function relativeTime(iso) {
  if (!iso) return "기록 없음";
  const diff = Date.now() - new Date(iso).getTime();
  const day = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (day <= 0) return "오늘";
  if (day === 1) return "1일 전";
  return `${day}일 전`;
}

function getScrollableHeight(element) {
  return Math.max(1, element.scrollHeight - element.clientHeight);
}

function getScrollRatio(element) {
  return Math.min(1, Math.max(0, element.scrollTop / getScrollableHeight(element)));
}

function getReadPosition(linkId) {
  const value = state.ui.readPositions[linkId];
  if (!value) return { url: "", scrollY: 0, scrollProgress: 0, textAnchor: "", savedAt: null };
  return {
    url: typeof value.url === "string" ? value.url : "",
    scrollY: Number.isFinite(value.scrollY) ? value.scrollY : 0,
    scrollProgress: Number.isFinite(value.scrollProgress) ? value.scrollProgress : 0,
    textAnchor: typeof value.textAnchor === "string" ? value.textAnchor : "",
    savedAt: value.savedAt || null
  };
}

function saveReadPosition(linkId, scrollElement) {
  const link = state.links.find((item) => item.id === linkId);
  const payload = getReadPositionFromElement(scrollElement, link);
  state.ui.readPositions[linkId] = payload;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (auth.isLoggedIn) {
    localStorage.setItem(cloudStorageKey(auth.userId), JSON.stringify(state));
  }
  return payload;
}

function getReadPositionFromElement(scrollElement, link) {
  const maxScrollableY = getScrollableHeight(scrollElement);
  const scrollY = Math.max(0, Math.min(scrollElement.scrollTop, maxScrollableY));
  const scrollProgress = maxScrollableY > 0 ? Math.round((scrollY / maxScrollableY) * 10000) / 100 : 0;
  const textAnchor = extractTextAnchor(link?.description || "", scrollProgress);
  return {
    url: link?.url || "",
    scrollY,
    scrollProgress,
    textAnchor,
    savedAt: new Date().toISOString()
  };
}

function extractTextAnchor(sourceText, scrollProgress) {
  const normalized = String(sourceText || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const centerIndex = Math.max(0, Math.min(normalized.length - 1, Math.floor((scrollProgress / 100) * normalized.length)));
  const start = Math.max(0, centerIndex - 24);
  const end = Math.min(normalized.length, centerIndex + 24);
  return normalized.slice(start, end).trim();
}

function resolveRestoreScrollY(link, scrollElement, savedPosition) {
  const maxScrollableY = getScrollableHeight(scrollElement);
  if (!savedPosition) return 0;

  // 1) textAnchor 매칭 복원
  const source = String(link?.description || "").replace(/\s+/g, " ").trim();
  const anchor = String(savedPosition.textAnchor || "").trim();
  if (source && anchor) {
    const index = source.indexOf(anchor);
    if (index >= 0 && source.length > 0) {
      const ratioFromAnchor = index / source.length;
      return Math.max(0, Math.min(Math.round(ratioFromAnchor * maxScrollableY), maxScrollableY));
    }
  }

  // 2) scrollProgress 복원
  if (Number.isFinite(savedPosition.scrollProgress) && savedPosition.scrollProgress > 0) {
    const byProgress = Math.round((savedPosition.scrollProgress / 100) * maxScrollableY);
    return Math.max(0, Math.min(byProgress, maxScrollableY));
  }

  // 3) scrollY 복원
  if (Number.isFinite(savedPosition.scrollY) && savedPosition.scrollY > 0) {
    return Math.max(0, Math.min(savedPosition.scrollY, maxScrollableY));
  }

  return 0;
}

function isDisallowedLocalFileUrl(url) {
  const s = String(url || "").trim();
  if (/^file:/i.test(s)) return true;
  try {
    return new URL(s).protocol === "file:";
  } catch {
    return false;
  }
}

function isPdfUrl(url) {
  const base = String(url || "").split(/[?#]/)[0].toLowerCase();
  return base.endsWith(".pdf");
}

function pdfViewerPageUrl(link, restart) {
  const qs = new URLSearchParams();
  qs.set("url", link.url);
  if (restart) qs.set("mode", "restart");
  return `/pdf-viewer.html?${qs.toString()}`;
}

function openPdfViewer(linkId, restart) {
  const link = state.links.find((item) => item.id === linkId);
  if (!link || !isPdfUrl(link.url)) return;
  if (isDisallowedLocalFileUrl(link.url)) {
    alert("로컬 PDF는 「내 PDF 열기」를 사용해 주세요.");
    return;
  }
  window.location.href = pdfViewerPageUrl(link, restart);
}

function openWebLinkInNewTab(link) {
  openOriginalUrl(link);
  link.lastVisitedAt = new Date().toISOString();
  saveAndRender();
}

function openLinkForReading(link) {
  if (isDisallowedLocalFileUrl(link.url)) {
    alert("로컬 PDF는 「내 PDF 열기」를 사용해 주세요.");
    return;
  }
  if (isPdfUrl(link.url)) {
    openPdfViewer(link.id, false);
  } else {
    openReader(link.id, false);
  }
}

function saveAndRender() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (auth.isLoggedIn) {
    localStorage.setItem(cloudStorageKey(auth.userId), JSON.stringify(state));
  }
  render();
}

function load() {
  try {
    if (auth.isLoggedIn) {
      const cloudRaw = localStorage.getItem(cloudStorageKey(auth.userId));
      if (cloudRaw) {
        const cloudData = JSON.parse(cloudRaw);
        if (cloudData && typeof cloudData === "object") {
          const pdfReading = cloudData.__pdfReading;
          if (pdfReading && typeof pdfReading === "object") {
            for (const [k, v] of Object.entries(pdfReading)) {
              localStorage.setItem(k, String(v));
            }
          }
          delete cloudData.__pdfReading;
          return cloudData;
        }
      }
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaultData);
    return JSON.parse(raw);
  } catch {
    return structuredClone(defaultData);
  }
}

function createId(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

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

async function bootApp() {
  if (bootOAuthToken) {
    try {
      await completeNaverLogin(bootOAuthToken);
    } catch (err) {
      alert(err?.message || "네이버 로그인에 실패했습니다.");
    }
  }
  const selectParam = new URLSearchParams(window.location.search).get("select");
  if (selectParam && state.links.some((l) => l.id === selectParam)) {
    state.ui.selectedLinkId = selectParam;
    const selected = state.links.find((l) => l.id === selectParam);
    if (selected?.categoryId) state.ui.selectedCategoryId = selected.categoryId;
    history.replaceState(null, "", window.location.pathname);
  }
  bindReaderOverlayEvents();
  openReaderFromHash();
  render();
}

bootApp();
