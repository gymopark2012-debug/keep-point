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
const IDB_VERSION = 2;
const IDB_STORE = "localPdfs";
const IDB_SNAPSHOT_STORE = "snapshots";

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
      if (!db.objectStoreNames.contains(IDB_SNAPSHOT_STORE)) {
        db.createObjectStore(IDB_SNAPSHOT_STORE, { keyPath: "id" });
      }
    };
  });
}

const IDB_VISUAL_STORE = "snapshots";

async function idbDeleteVisualRecord(linkId) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_VISUAL_STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(IDB_VISUAL_STORE).delete(linkId);
  });
}

const snapshotPreviewCache = new Map();
const snapshotSaveTasks = new Map();
let tesseractLoadPromise = null;

async function idbSaveScreenshot(linkId, dataUrl) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_VISUAL_STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(IDB_VISUAL_STORE).put({
      id: linkId,
      dataUrl,
      updatedAt: new Date().toISOString()
    });
  });
}

async function idbLoadScreenshot(refId) {
  if (!refId) return null;
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_VISUAL_STORE, "readonly");
    const req = tx.objectStore(IDB_VISUAL_STORE).get(refId);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result?.dataUrl || null);
  });
}

function getSnapshotPreview(linkId) {
  return snapshotPreviewCache.get(linkId) || null;
}

async function runSnapshotOcr(dataUrl) {
  try {
    if (!tesseractLoadPromise) {
      tesseractLoadPromise = import("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js");
    }
    const mod = await tesseractLoadPromise;
    const Tesseract = mod.default || mod;
    const { data } = await Tesseract.recognize(dataUrl, "kor+eng", { logger: () => {} });
    return String(data?.text || "").trim();
  } catch (err) {
    console.warn("[snapshot-ocr]", err);
    return "";
  }
}

async function fetchSnapshotKeyword({ ocrText, title, url, screenshot }) {
  try {
    const res = await fetch("/api/snapshot/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ocrText, title, url, screenshot })
    });
    if (!res.ok) return { keyword: "" };
    return res.json();
  } catch {
    return { keyword: "" };
  }
}

function compressSnapshotImage(dataUrl, maxWidth = 1400) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = img.width > maxWidth ? maxWidth / img.width : 1;
      const width = Math.round(img.width * scale);
      const height = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function patchReadingSnapshot(linkId, patch) {
  const target = state.links.find((item) => item.id === linkId);
  if (!target) return null;
  const base = normalizeReadingSnapshotFields(target.readingSnapshot, target);
  target.readingSnapshot = { ...base, ...patch };
  return target.readingSnapshot;
}

async function saveSnapshotFromImage(link, dataUrl) {
  if (!link?.id || !dataUrl || snapshotSaveTasks.has(link.id)) return;
  const linkId = link.id;

  patchReadingSnapshot(linkId, {
    screenshotRef: linkId,
    status: "processing",
    savedAt: new Date().toISOString()
  });
  snapshotPreviewCache.set(linkId, dataUrl);
  persistStateOnly();
  saveAndRender();

  const task = (async () => {
    try {
      await idbSaveScreenshot(linkId, dataUrl);

      patchReadingSnapshot(linkId, {
        status: "ready",
        savedAt: new Date().toISOString()
      });
      saveAndRender();

      try {
        const ocrText = await runSnapshotOcr(dataUrl);
        const result = await fetchSnapshotKeyword({
          ocrText,
          title: link.title,
          url: link.originalUrl || link.url,
          screenshot: ocrText ? "" : dataUrl
        });
        patchReadingSnapshot(linkId, {
          keyword: String(result.keyword || "").trim().slice(0, 16)
        });
      } catch (keywordErr) {
        console.warn("[snapshot-keyword]", keywordErr);
      }
    } catch (err) {
      console.error("[saveSnapshot]", err);
      patchReadingSnapshot(linkId, { status: "failed" });
    } finally {
      snapshotSaveTasks.delete(linkId);
      saveAndRender();
    }
  })();

  snapshotSaveTasks.set(linkId, task);
}

async function hydrateSnapshotPreview(link) {
  if (!link?.id) return null;
  if (snapshotPreviewCache.has(link.id)) return snapshotPreviewCache.get(link.id);

  const screenshotRef = link.readingSnapshot?.screenshotRef;
  if (!screenshotRef) return null;

  const refs = [screenshotRef, link.id].filter((value, index, list) => value && list.indexOf(value) === index);
  for (const ref of refs) {
    try {
      const dataUrl = await idbLoadScreenshot(ref);
      if (dataUrl) {
        snapshotPreviewCache.set(link.id, dataUrl);
        return dataUrl;
      }
    } catch (err) {
      console.warn("[snapshot-load]", err);
    }
  }
  return null;
}

function openSnapshotLightbox(src) {
  if (!src) return;

  document.getElementById("snapshotLightbox")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "snapshotLightbox";
  overlay.className = "snapshot-lightbox";
  overlay.innerHTML = `
    <button type="button" class="snapshot-lightbox-close" aria-label="닫기">×</button>
    <img class="snapshot-lightbox-image" src="${escapeAttr(src)}" alt="읽던 화면" />
  `;

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKeyDown);
  };
  const onKeyDown = (event) => {
    if (event.key === "Escape") close();
  };

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest(".snapshot-lightbox-close")) close();
  });
  document.addEventListener("keydown", onKeyDown);
  document.body.appendChild(overlay);
}

function renderSnapshotScreenTitle() {
  return `<h3 class="snapshot-screen-title">지난번 읽던 화면</h3>`;
}

function renderSnapshotLinkHeader(link) {
  const domain = getLinkSourceName(link);
  const title = String(link?.title || "").trim() || domain;
  return `
    <header class="snapshot-link-header">
      <h2 class="snapshot-link-title">${escapeHtml(shortText(title, 72))}</h2>
      <p class="snapshot-link-domain">${escapeHtml(domain)}</p>
    </header>`;
}

function formatSnapshotSavedTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const period = hours < 12 ? "오전" : "오후";
  const hour12 = hours % 12 || 12;
  const timeStr = `${period} ${hour12}:${minutes}`;

  if (isToday) return `오늘 ${timeStr}`;
  if (isYesterday) return `어제 ${timeStr}`;

  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}월 ${day}일 ${timeStr}`;
}

function renderSnapshotKeyword(keyword) {
  if (!keyword) return "";
  return `<p class="snapshot-keyword"><span class="snapshot-meta-icon" aria-hidden="true">🏷️</span> ${escapeHtml(keyword)}</p>`;
}

function renderSnapshotTime(iso) {
  const label = formatSnapshotSavedTime(iso);
  if (!label) return "";
  return `<p class="snapshot-time"><span class="snapshot-meta-icon" aria-hidden="true">🕒</span> ${escapeHtml(label)}</p>`;
}

function renderSnapshotPreview(preview, { lazy = false, loading = false } = {}) {
  if (preview) {
    return `
      <button type="button" class="snapshot-preview-button" id="snapshotPreviewBtn" aria-label="읽던 화면 크게 보기">
        <img class="snapshot-preview snapshot-preview--core" src="${escapeAttr(preview)}" alt="읽던 화면"${lazy ? ' loading="lazy"' : ""} />
        <span class="snapshot-preview-zoom-hint">탭해서 크게 보기</span>
      </button>`;
  }
  if (loading) {
    return `<div class="snapshot-preview-loading" aria-busy="true">읽던 화면을 불러오는 중…</div>`;
  }
  return renderSnapshotUploadZone();
}

function renderSnapshotUploadZone() {
  return `
    <div class="snapshot-upload" id="snapshotPasteZone" tabindex="0" role="button" aria-label="읽던 화면 붙여넣기">
      <p class="snapshot-upload-prompt">읽던 화면을 붙여넣어 주세요.</p>
      <span class="snapshot-upload-hint">Ctrl+V 붙여넣기 · 드래그 앤 드롭 · 클릭해서 선택</span>
      <input type="file" id="snapshotFileInput" accept="image/*" hidden />
    </div>`;
}

function renderSnapshotPanel(link) {
  const snap = getReadingSnapshot(link);
  const preview = getSnapshotPreview(link?.id);
  const continueBtn = `<button type="button" class="btn snapshot-continue-btn" id="continueOriginalBtn">원문에서 이어 읽기</button>`;
  const previewBlock = (options = {}) => renderSnapshotPreview(preview, options);

  if (!preview && snap?.status !== "processing") {
    return `
      <section class="reading-moment-card reading-moment-card--empty" aria-label="읽기 순간 없음">
        ${renderSnapshotScreenTitle()}
        <div class="snapshot-preview-wrap">${renderSnapshotUploadZone()}</div>
        ${continueBtn}
      </section>`;
  }

  if (snap.status === "processing") {
    return `
      <section class="reading-moment-card reading-moment-card--processing" aria-busy="true" aria-label="저장 중">
        <div class="snapshot-recall">
          ${renderSnapshotScreenTitle()}
          <div class="snapshot-preview-wrap">${previewBlock()}</div>
          <p class="snapshot-status">읽던 순간을 저장하는 중…</p>
        </div>
      </section>`;
  }

  return `
    <section class="reading-moment-card" aria-label="읽기 순간">
      <div class="snapshot-recall">
        ${renderSnapshotScreenTitle()}
        <div class="snapshot-preview-wrap">${previewBlock({ lazy: true })}</div>
        ${renderSnapshotKeyword(snap.keyword)}
        ${renderSnapshotTime(snap.savedAt)}
      </div>
      ${continueBtn}
    </section>`;
}

function bindSnapshotPanelEvents(root, link) {
  if (!root || !link) return () => {};

  const pasteZone = root.querySelector("#snapshotPasteZone");
  const fileInput = root.querySelector("#snapshotFileInput");
  const continueBtn = root.querySelector("#continueOriginalBtn");
  const linkId = link.id;

  const handleImage = async (dataUrl) => {
    if (!dataUrl) return;
    const current = state.links.find((item) => item.id === linkId);
    if (!current) return;
    const compressed = await compressSnapshotImage(dataUrl);
    void saveSnapshotFromImage(current, compressed);
  };

  const readImageFile = (file) => {
    if (!file || !String(file.type || "").startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      void handleImage(String(reader.result || ""));
    };
    reader.onerror = () => console.error("[snapshot] file read failed");
    reader.readAsDataURL(file);
  };

  const onPaste = (event) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (!item.type.startsWith("image/")) continue;
      event.preventDefault();
      event.stopPropagation();
      const file = item.getAsFile();
      if (file) readImageFile(file);
      return;
    }
  };

  const onPasteZoneClick = (event) => {
    event.stopPropagation();
    fileInput?.click();
  };

  const onFileChange = () => {
    const file = fileInput?.files?.[0];
    if (file) readImageFile(file);
    if (fileInput) fileInput.value = "";
  };

  const onDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
    pasteZone?.classList.add("snapshot-upload--dragover");
  };

  const onDragLeave = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget === pasteZone && !pasteZone.contains(event.relatedTarget)) {
      pasteZone?.classList.remove("snapshot-upload--dragover");
    }
  };

  const onDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    pasteZone?.classList.remove("snapshot-upload--dragover");
    const file = event.dataTransfer?.files?.[0];
    if (file) readImageFile(file);
  };

  const onContinue = (event) => {
    event.stopPropagation();
    const current = state.links.find((item) => item.id === linkId);
    if (current) continueOnOriginal(current);
  };

  const previewBtn = root.querySelector("#snapshotPreviewBtn");
  const onPreviewClick = (event) => {
    event.stopPropagation();
    const src = getSnapshotPreview(linkId);
    if (src) openSnapshotLightbox(src);
  };

  previewBtn?.addEventListener("click", onPreviewClick);

  const onDocumentPaste = (event) => {
    if (!root.isConnected) return;
    if (!state.links.some((item) => item.id === linkId && item.id === state.ui.selectedLinkId)) return;
    onPaste(event);
  };

  pasteZone?.addEventListener("click", onPasteZoneClick);
  pasteZone?.addEventListener("paste", onPaste);
  pasteZone?.addEventListener("dragover", onDragOver);
  pasteZone?.addEventListener("dragleave", onDragLeave);
  pasteZone?.addEventListener("drop", onDrop);
  root.addEventListener("dragover", onDragOver);
  root.addEventListener("dragleave", onDragLeave);
  root.addEventListener("drop", onDrop);
  document.addEventListener("paste", onDocumentPaste);
  fileInput?.addEventListener("change", onFileChange);
  continueBtn?.addEventListener("click", onContinue);

  if (pasteZone && !previewBtn) {
    requestAnimationFrame(() => pasteZone.focus());
  }

  return () => {
    pasteZone?.removeEventListener("click", onPasteZoneClick);
    pasteZone?.removeEventListener("paste", onPaste);
    pasteZone?.removeEventListener("dragover", onDragOver);
    pasteZone?.removeEventListener("dragleave", onDragLeave);
    pasteZone?.removeEventListener("drop", onDrop);
    root.removeEventListener("dragover", onDragOver);
    root.removeEventListener("dragleave", onDragLeave);
    root.removeEventListener("drop", onDrop);
    document.removeEventListener("paste", onDocumentPaste);
    fileInput?.removeEventListener("change", onFileChange);
    continueBtn?.removeEventListener("click", onContinue);
    previewBtn?.removeEventListener("click", onPreviewClick);
  };
}

function normalizeReadingSnapshotFields(raw, link) {
  const now = new Date().toISOString();
  const base = {
    id: `snap_${Date.now().toString(36)}`,
    linkId: link?.id || "",
    screenshotRef: null,
    keyword: "",
    savedAt: now,
    status: "empty"
  };
  if (!raw || typeof raw !== "object") return base;

  const keyword =
    String(raw.keyword || "").trim() ||
    (Array.isArray(raw.keywords) ? String(raw.keywords[0] || "").trim() : "");

  let status = raw.status;
  if (status === "completed") status = "ready";
  if (status === "forming") status = "processing";
  if (!["empty", "processing", "ready", "failed"].includes(status)) {
    status = raw.screenshotRef ? "ready" : "empty";
  }

  return {
    id: String(raw.id || base.id),
    linkId: String(raw.linkId || link?.id || ""),
    screenshotRef: raw.screenshotRef || null,
    keyword: keyword.slice(0, 16),
    savedAt: raw.savedAt || raw.updatedAt || raw.createdAt || now,
    status
  };
}

function getReadingSnapshot(link) {
  if (!link || isPdfUrl(link.url)) return null;
  link.readingSnapshot = normalizeReadingSnapshotFields(link.readingSnapshot, link);
  return link.readingSnapshot;
}

function getSnapshotKeyword(link) {
  return getReadingSnapshot(link)?.keyword || "";
}

function hasReadingScreenshot(link) {
  return Boolean(getReadingSnapshot(link)?.screenshotRef);
}

function migrateLegacyToSnapshot(link) {
  if (!link || isPdfUrl(link.url)) return;

  if (link.readingMoment && typeof link.readingMoment === "object") {
    const m = link.readingMoment;
    link.readingSnapshot = normalizeReadingSnapshotFields(
      {
        id: m.id,
        linkId: link.id,
        screenshotRef: m.recall?.secondary?.find((c) => c.type === "visual")?.assetRef || null,
        keyword: m.recall?.primary?.value || "",
        savedAt: m.context?.savedAt || m.context?.momentAt,
        status: m.status === "forming" ? "processing" : m.recall?.secondary?.some((c) => c.type === "visual") ? "ready" : "empty"
      },
      link
    );
    delete link.readingMoment;
    return;
  }

  const snap = getReadingSnapshot(link);
  if (snap.screenshotRef) {
    if (!snap.keyword) snap.status = "ready";
    return;
  }

  const trail = getWebReadTrail(link);
  const selected = getSelectedReadingPoint(link);
  const legacyLabel = selected?.label || trail.locationNote.trim();
  if (legacyLabel && !snap.keyword) {
    snap.keyword = legacyLabel.slice(0, 16);
    snap.savedAt = trail.updatedAt || snap.savedAt;
    if (snap.screenshotRef) snap.status = "ready";
  }
  link.readingSnapshot = snap;
}

async function hydrateSelectedSnapshotScreenshot() {
  const link = state.links.find((item) => item.id === state.ui.selectedLinkId);
  if (!link || isPdfUrl(link.url)) return;
  const src = await hydrateSnapshotPreview(link);
  if (src && state.ui.selectedLinkId === link.id) saveAndRender();
  if (!src && link.readingSnapshot?.screenshotRef && state.ui.selectedLinkId === link.id) saveAndRender();
}

function touchReadingSnapshot(link) {
  const snap = getReadingSnapshot(link);
  if (!snap || !snap.screenshotRef) return;
  snap.savedAt = new Date().toISOString();
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
    selectedPointId: "",
    shortNote: "",
    selectedText: "",
    progressPercent: 0,
    checkInCount: 0,
    updatedAt: null
  };
  if (!link || typeof link !== "object") return base;
  const t = link.readTrail;
  if (!t || typeof t !== "object") return base;
  return {
    locationNote: typeof t.locationNote === "string" ? t.locationNote : "",
    selectedPointId: typeof t.selectedPointId === "string" ? t.selectedPointId : "",
    shortNote: typeof t.shortNote === "string" ? t.shortNote : "",
    selectedText: typeof t.selectedText === "string" ? t.selectedText : "",
    progressPercent: Number.isFinite(t.progressPercent) ? Math.max(0, Math.min(100, t.progressPercent)) : 0,
    checkInCount: Number.isFinite(t.checkInCount) ? Math.max(0, t.checkInCount) : 0,
    updatedAt: t.updatedAt || null
  };
}

function getReadingPoints(link) {
  if (!link || !Array.isArray(link.readingPoints)) return [];
  return link.readingPoints
    .map((p, index) => ({
      id: String(p?.id || `rp-${index}`),
      label: String(p?.label || "").trim()
    }))
    .filter((p) => p.label);
}

function getSelectedReadingPoint(link) {
  const trail = getWebReadTrail(link);
  const points = getReadingPoints(link);
  return points.find((p) => p.id === trail.selectedPointId) || null;
}

function getMemoryPoint(link) {
  const selected = getSelectedReadingPoint(link);
  if (selected) return selected.label;
  const locationNote = getWebReadTrail(link).locationNote.trim();
  if (locationNote) return locationNote;
  if (hasReadingScreenshot(link)) {
    const keyword = getSnapshotKeyword(link);
    if (keyword) return keyword;
  }
  return "";
}

function getBookmarkLocation(link) {
  return getMemoryPoint(link);
}

function progressFromPointIndex(index, total) {
  if (index < 0 || total <= 0) return 0;
  if (total === 1) return 100;
  return Math.round(((index + 1) / total) * 100);
}

function selectReadingPoint(link, pointId) {
  if (!link || isPdfUrl(link.url)) return;
  const points = getReadingPoints(link);
  const index = points.findIndex((p) => p.id === pointId);
  if (index < 0) return;
  const point = points[index];
  const progress = progressFromPointIndex(index, points.length);
  const trail = getWebReadTrail(link);
  link.readTrail = {
    ...trail,
    selectedPointId: point.id,
    locationNote: point.label,
    progressPercent: progress,
    checkInCount: (trail.checkInCount || 0) + 1,
    updatedAt: new Date().toISOString()
  };
  link.readingStatus = progress >= 100 ? "completed" : "reading";
  link.lastVisitedAt = new Date().toISOString();
  delete link.webMemo;
  runtimeSaveStatus[link.id] = "저장됨";
  saveAndRender();
}

function saveManualReadingPoint(link, text) {
  if (!link || isPdfUrl(link.url)) return false;
  const label = String(text || "").trim().slice(0, 20);
  if (!label) return false;
  const trail = getWebReadTrail(link);
  const progress = estimateProgressOnCheckIn(trail);
  link.readTrail = {
    ...trail,
    selectedPointId: "",
    locationNote: label,
    progressPercent: progress,
    checkInCount: (trail.checkInCount || 0) + 1,
    updatedAt: new Date().toISOString()
  };
  link.readingStatus = progress >= 100 ? "completed" : "reading";
  link.lastVisitedAt = new Date().toISOString();
  delete link.webMemo;
  runtimeSaveStatus[link.id] = "저장됨";
  saveAndRender();
  return true;
}

function getReadingSessions(link) {
  if (!link || !Array.isArray(link.readingSessions)) return [];
  return link.readingSessions
    .filter((s) => s && typeof s === "object" && s.openedAt)
    .map((s) => ({
      id: String(s.id || ""),
      openedAt: s.openedAt,
      returnedAt: s.returnedAt || null,
      durationMs: Number.isFinite(s.durationMs) ? Math.max(0, s.durationMs) : null,
      closeReason: s.closeReason || null
    }));
}

function normalizeReadingSessions(link) {
  if (!link || isPdfUrl(link.url)) return;
  if (!Array.isArray(link.readingSessions)) link.readingSessions = [];
  link.readingSessions = getReadingSessions(link);
  if (!Number.isFinite(link.openCount)) {
    link.openCount = link.readingSessions.length || getWebReadTrail(link).checkInCount || 0;
  }
  if (!link.savedAt) link.savedAt = link.lastVisitedAt || new Date().toISOString();
}

function getCategoryName(categoryId) {
  return state.categories.find((c) => c.id === categoryId)?.name || "";
}

const SESSION_DURATION_CAP_MS = 45 * 60 * 1000;
const SESSION_HISTORY_LIMIT = 20;
const HUNT_WINDOW_MS = 48 * 60 * 60 * 1000;
const SHORT_OPEN_MS = 90 * 1000;

function formatVisitWhen(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diff = Date.now() - date.getTime();
  const day = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (day <= 0) {
    return `오늘 ${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  if (day === 1) return "어제";
  if (day < 7) return `${day}일 전`;
  return relativeTime(iso);
}

function getMetaDescription(link) {
  return String(link?.description || "").trim();
}

function getLinkActivityAt(link) {
  const sessions = getReadingSessions(link);
  const lastSession = sessions[sessions.length - 1];
  return (
    lastSession?.returnedAt ||
    lastSession?.openedAt ||
    link.lastVisitedAt ||
    link.savedAt ||
    ""
  );
}

function getLinkActivityMs(link) {
  const iso = getLinkActivityAt(link);
  const ms = iso ? new Date(iso).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

function getLinkOpenDuration(link) {
  return getReadingSessions(link)
    .filter((s) => s.durationMs > 0)
    .reduce((sum, s) => sum + s.durationMs, 0);
}

function tokenizeForHunt(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function scoreHuntOverlap(a, b) {
  const aTokens = new Set([
    ...tokenizeForHunt(a.title),
    ...tokenizeForHunt(getMetaDescription(a)).slice(0, 12)
  ]);
  const bTokens = new Set([
    ...tokenizeForHunt(b.title),
    ...tokenizeForHunt(getMetaDescription(b)).slice(0, 12)
  ]);
  if (!aTokens.size || !bTokens.size) return 0;
  let hit = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) hit += 1;
  }
  return hit / Math.min(aTokens.size, bTokens.size);
}

function linksBelongInSameHunt(a, b) {
  if (!a || !b || a.categoryId !== b.categoryId) return false;
  const aMs = getLinkActivityMs(a);
  const bMs = getLinkActivityMs(b);
  const withinWindow = aMs && bMs && Math.abs(aMs - bMs) <= HUNT_WINDOW_MS;
  return withinWindow || scoreHuntOverlap(a, b) >= 0.18;
}

function buildHuntFocus(links, preferredLink) {
  const ordered = [preferredLink, ...links].filter(Boolean);
  for (const link of ordered) {
    const desc = getMetaDescription(link);
    if (desc) {
      return {
        text: shortText(desc, 88),
        source: "description",
        linkId: link.id
      };
    }
  }
  for (const link of ordered) {
    const title = String(link?.title || "").trim();
    if (title) {
      return {
        text: shortText(title, 60),
        source: "title",
        linkId: link.id
      };
    }
  }
  return { text: "저장된 탐색", source: "fallback", linkId: preferredLink?.id || links[0]?.id || "" };
}

function buildHuntLabel(links, categoryId) {
  const categoryName = getCategoryName(categoryId);
  const tokenCounts = new Map();
  for (const link of links) {
    for (const token of tokenizeForHunt(link.title)) {
      tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
    }
  }
  const shared = [...tokenCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([token]) => token)
    .slice(0, 2);

  if (categoryName && shared.length) return `${categoryName} · ${shared.join(" ")}`;
  if (categoryName) return `${categoryName} 탐색`;
  if (shared.length) return shared.join(" ");
  const focus = buildHuntFocus(links, links[0]);
  return shortText(focus.text, 28);
}

function buildHuntTrail(links) {
  const byId = new Map(links.map((link) => [link.id, link]));
  const events = [];
  for (const link of links) {
    const sessions = getReadingSessions(link);
    if (!sessions.length) continue;
    for (const session of sessions) {
      events.push({
        linkId: link.id,
        openedAt: session.openedAt,
        durationMs: session.durationMs
      });
    }
  }
  events.sort((a, b) => new Date(a.openedAt) - new Date(b.openedAt));
  const trail = [];
  for (const event of events) {
    const prev = trail[trail.length - 1];
    if (prev && prev.linkId === event.linkId) {
      prev.openedAt = event.openedAt;
      if (event.durationMs != null) prev.durationMs = event.durationMs;
      continue;
    }
    trail.push({ ...event });
  }
  return trail.filter((item) => byId.has(item.linkId)).slice(-8);
}

function pickHuntNextLinkId(links, lastLinkId) {
  const neverOpened = links.filter((link) => (link.openCount || getReadingSessions(link).length || 0) === 0);
  if (neverOpened.length) {
    neverOpened.sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));
    return neverOpened[0].id;
  }
  const shortOpened = links
    .filter((link) => link.id !== lastLinkId)
    .map((link) => ({ link, duration: getLinkOpenDuration(link), opens: link.openCount || 0 }))
    .filter((row) => row.opens > 0 && row.duration < SHORT_OPEN_MS)
    .sort((a, b) => a.duration - b.duration);
  if (shortOpened.length) return shortOpened[0].link.id;
  const others = links
    .filter((link) => link.id !== lastLinkId)
    .sort((a, b) => getLinkActivityMs(b) - getLinkActivityMs(a));
  return others[0]?.id || null;
}

function stableHuntId(linkIds) {
  const key = [...linkIds].sort().join("|");
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return `hunt_${hash.toString(36)}`;
}

function createHuntFromLinks(links, previousHunt = null) {
  const members = [...links].sort((a, b) => getLinkActivityMs(b) - getLinkActivityMs(a));
  const trail = buildHuntTrail(members);
  const lastLinkId = trail[trail.length - 1]?.linkId || members[0]?.id || null;
  const lastLink = members.find((link) => link.id === lastLinkId) || members[0];
  const focus = buildHuntFocus(members, lastLink);
  const lastActiveAt =
    trail[trail.length - 1]?.openedAt || getLinkActivityAt(lastLink) || new Date().toISOString();
  const linkIds = members.map((link) => link.id);

  return {
    id: previousHunt?.id || stableHuntId(linkIds),
    categoryId: members[0]?.categoryId || "",
    linkIds,
    trail,
    lastLinkId,
    nextLinkId: pickHuntNextLinkId(members, lastLinkId),
    label: buildHuntLabel(members, members[0]?.categoryId),
    focusQuote: focus.text,
    focusSource: focus.source,
    lastActiveAt,
    status: previousHunt?.status || "active"
  };
}

function clusterWebLinksIntoHunts(webLinks) {
  const remaining = [...webLinks].sort((a, b) => getLinkActivityMs(b) - getLinkActivityMs(a));
  const clusters = [];

  while (remaining.length) {
    const seed = remaining.shift();
    const cluster = [seed];
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = remaining.length - 1; i >= 0; i -= 1) {
        const candidate = remaining[i];
        if (cluster.some((member) => linksBelongInSameHunt(member, candidate))) {
          cluster.push(candidate);
          remaining.splice(i, 1);
          grew = true;
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

function findPreviousHuntForCluster(linkIds, previousHunts) {
  const set = new Set(linkIds);
  let best = null;
  let bestScore = 0;
  for (const hunt of previousHunts || []) {
    const overlap = (hunt.linkIds || []).filter((id) => set.has(id)).length;
    if (overlap > bestScore) {
      best = hunt;
      bestScore = overlap;
    }
  }
  return bestScore > 0 ? best : null;
}

function rebuildHunts() {
  const previousHunts = Array.isArray(state.hunts) ? state.hunts : [];
  const webLinks = (state.links || []).filter((link) => link && !isPdfUrl(link.url));
  const clusters = clusterWebLinksIntoHunts(webLinks);
  const hunts = clusters.map((cluster) => {
    const linkIds = cluster.map((link) => link.id);
    const previous = findPreviousHuntForCluster(linkIds, previousHunts);
    return createHuntFromLinks(cluster, previous);
  });
  hunts.sort((a, b) => new Date(b.lastActiveAt || 0) - new Date(a.lastActiveAt || 0));
  state.hunts = hunts;

  if (!state.ui || typeof state.ui !== "object") state.ui = {};
  if (state.ui.activeHuntId && !hunts.some((hunt) => hunt.id === state.ui.activeHuntId)) {
    state.ui.activeHuntId = hunts[0]?.id || null;
  }
  if (!state.ui.activeHuntId) state.ui.activeHuntId = hunts[0]?.id || null;
  return hunts;
}

function getHuntById(huntId) {
  return (state.hunts || []).find((hunt) => hunt.id === huntId) || null;
}

function getActiveHunt() {
  return getHuntById(state.ui?.activeHuntId) || (state.hunts || [])[0] || null;
}

function getHuntForLink(link) {
  if (!link || isPdfUrl(link.url)) return null;
  return (state.hunts || []).find((hunt) => hunt.linkIds.includes(link.id)) || null;
}

function getHuntLinks(hunt) {
  if (!hunt) return [];
  const map = new Map((state.links || []).map((link) => [link.id, link]));
  return hunt.linkIds.map((id) => map.get(id)).filter(Boolean);
}

function setActiveHunt(huntId) {
  if (!state.ui) state.ui = {};
  state.ui.activeHuntId = huntId || null;
}

function touchHuntForLink(link) {
  if (!link || isPdfUrl(link.url)) return null;
  if (!Array.isArray(state.hunts) || !state.hunts.length) rebuildHunts();
  let hunt = getHuntForLink(link);
  if (!hunt) {
    rebuildHunts();
    hunt = getHuntForLink(link);
  }
  if (!hunt) return null;
  setActiveHunt(hunt.id);
  hunt.lastLinkId = link.id;
  hunt.lastActiveAt = new Date().toISOString();
  const trail = Array.isArray(hunt.trail) ? hunt.trail : [];
  const last = trail[trail.length - 1];
  if (!last || last.linkId !== link.id) {
    trail.push({
      linkId: link.id,
      openedAt: hunt.lastActiveAt,
      durationMs: null
    });
  } else {
    last.openedAt = hunt.lastActiveAt;
  }
  hunt.trail = trail.slice(-8);
  const members = getHuntLinks(hunt);
  hunt.nextLinkId = pickHuntNextLinkId(members, hunt.lastLinkId);
  const focus = buildHuntFocus(members, link);
  hunt.focusQuote = focus.text;
  hunt.focusSource = focus.source;
  hunt.label = buildHuntLabel(members, hunt.categoryId);
  return hunt;
}

const MEMORY_POINT_STOP = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "are",
  "was",
  "were",
  "have",
  "has",
  "had",
  "not",
  "but",
  "you",
  "your",
  "home",
  "page",
  "blog",
  "news",
  "index",
  "lets",
  "until",
  "finished",
  "loading",
  "display",
  "fallback",
  "children",
  "including",
  "exterior",
  "palette",
  "및",
  "에서",
  "으로",
  "하는",
  "했다",
  "한다",
  "있는",
  "없는",
  "대한",
  "위한",
  "통해",
  "관련",
  "안내",
  "자료",
  "문서",
  "페이지",
  "내용",
  "소개",
  "다룹니다",
  "추진한",
  "정리한",
  "설명한",
  "된",
  "할",
  "한",
  "등"
]);

const MEMORY_PATH_STOP = new Set([
  "www",
  "com",
  "net",
  "org",
  "co",
  "kr",
  "en",
  "ko",
  "blog",
  "post",
  "posts",
  "article",
  "articles",
  "news",
  "page",
  "pages",
  "index",
  "view",
  "detail",
  "docs",
  "doc",
  "wiki",
  "tag",
  "tags",
  "category",
  "categories",
  "search",
  "id",
  "amp"
]);

function normalizeMemoryTag(value) {
  let text = String(value || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}_-]/gu, "");
  text = text.replace(/(의|을|를|이|가|은|는|과|와|도|로|으로|에서|부터|까지|만|께|에게)$/u, "");
  if (!text) return "";
  if (text.length > 16) text = text.slice(0, 16);
  if (text.length < 2) return "";
  if (/^\d+$/.test(text)) return "";
  if (MEMORY_POINT_STOP.has(text.toLowerCase())) return "";
  return text;
}

function formatMemoryTag(tag) {
  const normalized = normalizeMemoryTag(tag);
  return normalized ? `#${normalized}` : "";
}

function uniqueMemoryTags(tags, max = 6) {
  const out = [];
  const seen = new Set();
  for (const raw of tags) {
    const tag = normalizeMemoryTag(raw);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

function tokenizeMemoryText(text) {
  return String(text || "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .split(/[\s_/|-]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function memoryPathTokens(url) {
  try {
    const u = new URL(url);
    return u.pathname
      .split("/")
      .map((part) => {
        try {
          return decodeURIComponent(part);
        } catch {
          return part;
        }
      })
      .flatMap((part) => tokenizeMemoryText(part.replace(/[-_]+/g, " ")))
      .filter((part) => part && !MEMORY_PATH_STOP.has(part.toLowerCase()));
  } catch {
    return [];
  }
}

/**
 * Recommend objective memory-point tags from available meta only.
 * Never invents document body content or user intent.
 */
function generateMemoryPoints({
  url = "",
  title = "",
  ogTitle = "",
  description = "",
  sourceName = ""
} = {}) {
  const scored = new Map();
  const bump = (token, weight) => {
    const tag = normalizeMemoryTag(token);
    if (!tag) return;
    const key = tag.toLowerCase();
    const prev = scored.get(key);
    if (!prev || weight > prev.weight || (weight === prev.weight && tag.length > prev.tag.length)) {
      scored.set(key, { tag, weight });
    }
  };

  for (const token of tokenizeMemoryText(ogTitle || title)) bump(token, 5);
  for (const token of tokenizeMemoryText(title)) bump(token, 4);
  for (const token of tokenizeMemoryText(description).slice(0, 24)) bump(token, 3);
  for (const token of memoryPathTokens(url)) bump(token, 2);
  if (sourceName) bump(String(sourceName).replace(/\./g, ""), 1);

  const ranked = [...scored.values()]
    .sort((a, b) => b.weight - a.weight || b.tag.length - a.tag.length)
    .map((row) => row.tag);

  let points = uniqueMemoryTags(ranked, 6);
  if (points.length < 3) {
    points = uniqueMemoryTags(
      [...points, ...tokenizeMemoryText(ogTitle || title), ...tokenizeMemoryText(description), ...memoryPathTokens(url)],
      6
    );
  }
  return points;
}

function normalizeMemoryPoints(link) {
  if (!link || isPdfUrl(link.url)) return;
  const raw = link.memoryPoints && typeof link.memoryPoints === "object" ? link.memoryPoints : {};
  // Migrate legacy selected/suggested model → auto-applied items.
  let suggested = uniqueMemoryTags(raw.suggested || [], 8);
  let custom = uniqueMemoryTags(raw.custom || [], 12);
  let removed = uniqueMemoryTags(raw.removed || [], 16);
  if (!suggested.length && Array.isArray(raw.selected) && raw.selected.length) {
    suggested = uniqueMemoryTags(raw.selected, 8);
  }
  link.memoryPoints = {
    suggested,
    custom,
    removed,
    status: ["pending", "ready"].includes(raw.status) ? raw.status : suggested.length ? "ready" : "pending",
    source: raw.source || "",
    generatedAt: raw.generatedAt || null
  };
  delete link.readingAnchor;
}

function getActiveAiMemoryPoints(link) {
  normalizeMemoryPoints(link);
  const removed = new Set(link.memoryPoints.removed.map((t) => t.toLowerCase()));
  return link.memoryPoints.suggested.filter((tag) => !removed.has(tag.toLowerCase()));
}

function getFinalMemoryPoints(link) {
  normalizeMemoryPoints(link);
  return uniqueMemoryTags([...getActiveAiMemoryPoints(link), ...link.memoryPoints.custom], 16);
}

function getDisplayMemoryPoints(link) {
  return getFinalMemoryPoints(link);
}

function getContextHint(link) {
  const checkpoint = getCheckpointSnippet(link);
  if (checkpoint) return shortText(checkpoint, 42);
  const points = getDisplayMemoryPoints(link);
  if (points.length) return points.slice(0, 3).map((t) => `#${t}`).join(" ");
  return "기억 포인트 준비 중";
}

function buildShareHuntText(link) {
  const lines = [`제목: ${link.title}`, `원본: ${getOriginalUrl(link)}`];
  const points = getFinalMemoryPoints(link);
  if (points.length) lines.push(`기억 포인트: ${points.map((t) => `#${t}`).join(" ")}`);
  return lines.join("\n");
}

function applySuggestedMemoryPoints(link, points, source = "heuristic") {
  normalizeMemoryPoints(link);
  const suggested = uniqueMemoryTags(points, 8);
  if (!suggested.length) return link.memoryPoints;
  // Keep user removals; new AI tags are auto-applied unless previously removed.
  link.memoryPoints = {
    ...link.memoryPoints,
    suggested,
    status: "ready",
    source,
    generatedAt: new Date().toISOString()
  };
  return link.memoryPoints;
}

function removeMemoryPoint(link, tag) {
  normalizeMemoryPoints(link);
  const normalized = normalizeMemoryTag(tag);
  if (!normalized) return;
  const key = normalized.toLowerCase();
  const inCustom = link.memoryPoints.custom.some((t) => t.toLowerCase() === key);
  if (inCustom) {
    link.memoryPoints.custom = link.memoryPoints.custom.filter((t) => t.toLowerCase() !== key);
    return;
  }
  if (link.memoryPoints.suggested.some((t) => t.toLowerCase() === key)) {
    link.memoryPoints.removed = uniqueMemoryTags([...link.memoryPoints.removed, normalized], 16);
  }
}

function addCustomMemoryPoint(link, raw) {
  normalizeMemoryPoints(link);
  const chunks = String(raw || "")
    .split(/[\s,，]+/)
    .map((part) => normalizeMemoryTag(part))
    .filter(Boolean);
  if (!chunks.length) return false;
  // If user re-adds a removed AI tag, restore it instead of duplicating as custom.
  const restored = [];
  const fresh = [];
  for (const tag of chunks) {
    const key = tag.toLowerCase();
    if (link.memoryPoints.suggested.some((t) => t.toLowerCase() === key)) {
      restored.push(tag);
    } else {
      fresh.push(tag);
    }
  }
  if (restored.length) {
    const restoreKeys = new Set(restored.map((t) => t.toLowerCase()));
    link.memoryPoints.removed = link.memoryPoints.removed.filter((t) => !restoreKeys.has(t.toLowerCase()));
  }
  link.memoryPoints.custom = uniqueMemoryTags([...link.memoryPoints.custom, ...fresh], 12);
  return true;
}

async function fetchMemoryPointsFromApi(link) {
  try {
    const res = await fetch("/api/memory-points", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: getOriginalUrl(link),
        title: link.title || "",
        ogTitle: link.title || "",
        description: link.description || "",
        sourceName: link.sourceName || ""
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const points = data?.points || data?.tags || [];
    return Array.isArray(points) && points.length
      ? { points, source: data.source || "ai" }
      : null;
  } catch {
    return null;
  }
}

async function ensureMemoryPoints(link, { force = false } = {}) {
  if (!link || isPdfUrl(link.url)) return;
  normalizeMemoryPoints(link);

  if (!force && link.memoryPoints.status === "ready" && link.memoryPoints.suggested.length) {
    return link.memoryPoints;
  }

  const local = generateMemoryPoints({
    url: getOriginalUrl(link),
    title: link.title || "",
    ogTitle: link.title || "",
    description: link.description || "",
    sourceName: link.sourceName || ""
  });
  applySuggestedMemoryPoints(link, local, "heuristic");

  const remote = await fetchMemoryPointsFromApi(link);
  if (remote?.points?.length) {
    applySuggestedMemoryPoints(link, remote.points, remote.source || "ai");
  }
  return link.memoryPoints;
}

function renderMemoryPointsPanel(link) {
  normalizeMemoryPoints(link);
  normalizeCheckpointFields(link);
  const isReading = Boolean(runtimeActiveSession && runtimeActiveSession.linkId === link.id);
  const aiPoints = getActiveAiMemoryPoints(link);
  const custom = link.memoryPoints.custom;
  const finals = getFinalMemoryPoints(link);
  const checkpointText = getCheckpointSnippet(link);
  const hasCheckpoint = Boolean(link.checkpointUrl);
  const ogImage = String(link.ogImage || "").trim();
  const hero = ogImage
    ? `<div class="context-hero"><img src="${escapeAttr(ogImage)}" alt="" class="context-og-image" loading="lazy" /></div>`
    : "";

  const pointChips = finals.length
    ? finals
        .map((tag) => {
          const isCustom = custom.some((t) => t.toLowerCase() === tag.toLowerCase());
          return `<button type="button" class="memory-chip active ${isCustom ? "custom" : ""}" data-remove-point="${escapeAttr(tag)}" title="삭제">#${escapeHtml(tag)} <span aria-hidden="true">×</span></button>`;
        })
        .join("")
    : link.memoryPoints.status === "pending"
      ? `<p class="memory-pending">기억 포인트를 만드는 중…</p>`
      : `<p class="memory-pending">아직 기억 포인트가 없습니다. 아래에서 추가할 수 있어요.</p>`;

  const checkpointBlock = `
    <section class="checkpoint-card" aria-label="읽던 위치">
      <p class="memory-kicker">최근 읽던 문장</p>
      ${
        checkpointText
          ? `<p class="checkpoint-quote">「${escapeHtml(shortText(checkpointText, 120))}」</p>`
          : `<p class="checkpoint-empty">아직 저장된 위치가 없습니다. 「읽던 위치 저장」으로 마지막으로 읽은 문장을 남겨 두세요.</p>`
      }
      <p class="checkpoint-updated">마지막 업데이트 · ${escapeHtml(formatCheckpointUpdatedAt(link))}</p>
      <div class="checkpoint-actions">
        <button type="button" class="btn checkpoint-continue-btn" id="continueCheckpointBtn">${
          isReading ? "계속 읽기 (다시 열기)" : "이어서 읽기 →"
        }</button>
        <div class="checkpoint-secondary-actions">
          <button type="button" class="btn ghost sm" id="openFromStartBtn">처음부터 읽기</button>
          <button type="button" class="btn ghost sm" id="updateCheckpointBtn">읽던 위치 저장</button>
        </div>
      </div>
      ${
        hasCheckpoint && link.checkpointHistory?.length
          ? `<details class="checkpoint-history">
              <summary>이전 위치 ${link.checkpointHistory.length}개</summary>
              <ul class="checkpoint-history-list">
                ${link.checkpointHistory
                  .slice()
                  .reverse()
                  .slice(0, 8)
                  .map(
                    (item) =>
                      `<li><button type="button" class="checkpoint-history-btn" data-history-url="${escapeAttr(item.url)}">${escapeHtml(shortText(item.text || "이전 위치", 64))}</button></li>`
                  )
                  .join("")}
              </ul>
            </details>`
          : ""
      }
      <details class="detail-manage">
        <summary>⋯ 관리</summary>
        <div class="detail-manage-menu">
          <button type="button" class="btn ghost" id="shareCurrentBtn">공유</button>
          <button type="button" class="btn danger" id="deleteCurrentBtn">삭제</button>
        </div>
      </details>
    </section>`;

  return `
    <div class="web-link-panel memory-panel">
      ${hero}
      <header class="context-header">
        <p class="context-meta">${escapeHtml(getLinkSourceName(link))}</p>
        <h2 class="context-title">${escapeHtml(link.title)}</h2>
      </header>
      ${checkpointBlock}
      <section class="memory-points-card ${isReading ? "is-reading" : ""}" aria-label="기억 포인트">
        <p class="memory-kicker">📍 기억 포인트</p>
        <p class="memory-subkicker">${aiPoints.length ? "AI 추천 · 그대로 두거나 삭제·추가하세요" : "기억 단서"}</p>
        <div class="memory-chip-row" id="memoryPointRow">
          ${pointChips}
        </div>
        <button type="button" class="btn ghost sm memory-add-toggle" id="memoryAddToggle">+ 기억 포인트 추가</button>
        <div class="memory-add-row" id="memoryAddRow" hidden>
          <input type="text" id="memoryAddInput" class="memory-add-input" maxlength="40" placeholder="#발표 #중간고사" aria-label="기억 포인트 추가" />
          <div class="memory-add-actions">
            <button type="button" class="btn sm" id="memoryAddSave">추가</button>
            <button type="button" class="btn ghost sm" id="memoryAddCancel">취소</button>
          </div>
        </div>
        ${
          isReading
            ? `<p class="memory-reading-note">원문 탭에서 읽는 중 · 돌아오면 이 카드의 최근 위치로 이어갑니다.</p>`
            : ""
        }
      </section>
    </div>`;
}

function renderWebLinkDetailPanel(link) {
  return renderMemoryPointsPanel(link);
}

function openContinueReading(link) {
  const url = normalizeUrl(getContinueUrl(link));
  if (!url) {
    alert("원본 URL이 없습니다.");
    return;
  }
  startReadingSession(link);
  window.open(url, "_blank", "noopener,noreferrer");
  saveAndRender();
}

function openFromBeginning(link) {
  const url = normalizeUrl(getOriginalUrl(link));
  if (!url) {
    alert("원본 URL이 없습니다.");
    return;
  }
  startReadingSession(link);
  window.open(url, "_blank", "noopener,noreferrer");
  saveAndRender();
}

async function applyCheckpointUpdateFromInput(link, rawUrl, { select = true, quiet = false } = {}) {
  const parsed = normalizeUrl(String(rawUrl || "").trim());
  if (!parsed) {
    if (!quiet) alert("올바른 링크를 붙여넣어 주세요.");
    return false;
  }
  const fragment = parseTextFragmentFromUrl(parsed);
  if (!fragment.hasFragment) {
    if (!quiet) alert("「선택한 텍스트로 링크 복사」로 만든 Text Fragment URL을 붙여넣어 주세요.");
    return false;
  }
  if (getCanonicalPageKey(parsed) !== getCanonicalPageKey(getOriginalUrl(link))) {
    if (!quiet) alert("같은 페이지의 위치 링크만 이 카드에 업데이트할 수 있습니다.");
    return false;
  }
  updateLinkCheckpoint(link, parsed, { select });
  saveAndRender();
  return true;
}

function bindWebLinkDetailEvents(root, link) {
  if (!root || !link) return () => {};
  const linkId = link.id;
  const handlers = [];
  const on = (el, eventName, fn) => {
    if (!el) return;
    el.addEventListener(eventName, fn);
    handlers.push(() => el.removeEventListener(eventName, fn));
  };
  const getCurrent = () => state.links.find((item) => item.id === linkId);

  on(root.querySelector("#continueCheckpointBtn"), "click", (event) => {
    event.stopPropagation();
    const current = getCurrent();
    if (current) openContinueReading(current);
  });

  on(root.querySelector("#openFromStartBtn"), "click", (event) => {
    event.stopPropagation();
    const current = getCurrent();
    if (current) openFromBeginning(current);
  });

  on(root.querySelector("#updateCheckpointBtn"), "click", (event) => {
    event.stopPropagation();
    const current = getCurrent();
    if (current) openPositionSaveModal(current, { select: true });
  });

  root.querySelectorAll("[data-history-url]").forEach((btn) => {
    on(btn, "click", (event) => {
      event.stopPropagation();
      const historyUrl = btn.getAttribute("data-history-url");
      if (!historyUrl) return;
      startReadingSession(getCurrent());
      window.open(historyUrl, "_blank", "noopener,noreferrer");
    });
  });

  root.querySelectorAll("[data-remove-point]").forEach((btn) => {
    on(btn, "click", (event) => {
      event.stopPropagation();
      const current = getCurrent();
      if (!current) return;
      removeMemoryPoint(current, btn.getAttribute("data-remove-point"));
      saveAndRender();
    });
  });

  on(root.querySelector("#memoryAddToggle"), "click", (event) => {
    event.stopPropagation();
    const row = root.querySelector("#memoryAddRow");
    if (!row) return;
    row.hidden = !row.hidden;
    if (!row.hidden) root.querySelector("#memoryAddInput")?.focus();
  });

  on(root.querySelector("#memoryAddCancel"), "click", (event) => {
    event.stopPropagation();
    const row = root.querySelector("#memoryAddRow");
    if (row) row.hidden = true;
  });

  on(root.querySelector("#memoryAddSave"), "click", (event) => {
    event.stopPropagation();
    const current = getCurrent();
    const input = root.querySelector("#memoryAddInput");
    if (!current || !input) return;
    if (addCustomMemoryPoint(current, input.value)) {
      input.value = "";
      const row = root.querySelector("#memoryAddRow");
      if (row) row.hidden = true;
      saveAndRender();
    }
  });

  on(root.querySelector("#memoryAddInput"), "keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    root.querySelector("#memoryAddSave")?.click();
  });

  return () => handlers.forEach((off) => off());
}

function openHuntLinkById(linkId) {
  const link = state.links.find((item) => item.id === linkId);
  if (!link) return;
  if (isPdfUrl(link.url)) {
    openLinkForReading(link);
    return;
  }
  state.ui.selectedLinkId = link.id;
  if (link.categoryId) state.ui.selectedCategoryId = link.categoryId;
  continueOnOriginal(link);
}

function bindHuntResumeEvents(root) {
  if (!root) return () => {};
  const handlers = [];
  const on = (el, eventName, fn) => {
    if (!el) return;
    el.addEventListener(eventName, fn);
    handlers.push(() => el.removeEventListener(eventName, fn));
  };

  const openFromButton = (event) => {
    event.stopPropagation();
    const linkId = event.currentTarget.getAttribute("data-open-link");
    if (linkId) openHuntLinkById(linkId);
  };

  on(root.querySelector("#huntContinueBtn"), "click", openFromButton);
  on(root.querySelector("#huntLastBtn"), "click", openFromButton);

  root.querySelectorAll("[data-hunt-next]").forEach((btn) => {
    on(btn, "click", (event) => {
      event.stopPropagation();
      const linkId = btn.getAttribute("data-hunt-next");
      if (linkId) openHuntLinkById(linkId);
    });
  });

  root.querySelectorAll("[data-hunt-link]").forEach((btn) => {
    on(btn, "click", (event) => {
      event.stopPropagation();
      const linkId = btn.getAttribute("data-hunt-link");
      if (!linkId) return;
      const link = state.links.find((item) => item.id === linkId);
      if (link) selectLink(link.id);
    });
  });

  return () => handlers.forEach((off) => off());
}

let runtimeActiveSession = null;

function startReadingSession(link) {
  if (!link || isPdfUrl(link.url)) return;
  normalizeReadingSessions(link);
  if (runtimeActiveSession) closeActiveReadingSession("manual");
  const session = {
    id: createId("rs"),
    openedAt: new Date().toISOString(),
    returnedAt: null,
    durationMs: null,
    closeReason: null
  };
  link.readingSessions.push(session);
  if (link.readingSessions.length > SESSION_HISTORY_LIMIT) {
    link.readingSessions = link.readingSessions.slice(-SESSION_HISTORY_LIMIT);
  }
  link.openCount = (link.openCount || 0) + 1;
  link.lastVisitedAt = session.openedAt;
  runtimeActiveSession = {
    linkId: link.id,
    sessionId: session.id,
    openedAt: Date.now(),
    ignoreCloseUntil: Date.now() + 1200
  };
  touchHuntForLink(link);
  persistStateOnly();
}

function closeActiveReadingSession(reason = "focus") {
  if (!runtimeActiveSession) return;
  if (Date.now() < (runtimeActiveSession.ignoreCloseUntil || 0) && reason !== "manual") {
    return;
  }
  const activeLinkId = runtimeActiveSession.linkId;
  const link = state.links.find((l) => l.id === activeLinkId);
  if (link) {
    normalizeReadingSessions(link);
    const session = link.readingSessions?.find((s) => s.id === runtimeActiveSession.sessionId);
    if (session && !session.returnedAt) {
      session.returnedAt = new Date().toISOString();
      session.durationMs = Math.min(
        SESSION_DURATION_CAP_MS,
        Math.max(0, Date.now() - runtimeActiveSession.openedAt)
      );
      session.closeReason = reason;
      link.lastVisitedAt = session.returnedAt;
    }
    touchHuntForLink(link);
  }
  runtimeActiveSession = null;
  persistStateOnly();
  if (state.ui.selectedLinkId === activeLinkId || !state.ui.selectedLinkId) saveAndRender();
}

function installReadingSessionListeners() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") closeActiveReadingSession("visibility");
  });
  window.addEventListener("focus", () => closeActiveReadingSession("focus"));
}

function buildReadingResumeBlock(link, { points, selectedPointId, manualDraft }) {
  const status = link.readingPointsStatus || "pending";
  const hasPoints = points.length >= 3;
  const isLoading = status === "pending" || status === "generating" || status === "unset";
  const showManualFallback = !hasPoints && !isLoading;

  let bodyHtml = "";
  if (hasPoints) {
    bodyHtml = `<ul class="reading-points-list" role="list">
      ${points
        .map(
          (p) => `<li>
        <button type="button" class="reading-point-btn ${selectedPointId === p.id ? "active" : ""}" data-point-id="${escapeAttr(p.id)}">
          <span class="point-marker" aria-hidden="true">${selectedPointId === p.id ? "●" : "○"}</span>
          <span class="point-label">${escapeHtml(p.label)}</span>
        </button>
      </li>`
        )
        .join("")}
    </ul>
    <p class="reading-points-hint">탭 한 번으로 저장됩니다</p>`;
  } else if (showManualFallback) {
    bodyHtml = `<p class="manual-fallback-guide">짧은 단서만 적어 주세요. 다음에 바로 기억날 거예요.</p>
      <div class="manual-point-field">
        <input
          type="text"
          id="manualPointInput"
          class="manual-point-input"
          maxlength="20"
          placeholder="예: 몽골 침입, Experiment"
          value="${escapeAttr(manualDraft)}"
          aria-label="읽기 위치 단서"
        />
        <button type="button" class="btn sm" id="saveManualPointBtn">저장</button>
      </div>
      <p class="manual-point-examples">예) 몽골 침입 · Experiment · 해결 방법</p>`;
  } else {
    bodyHtml = `<p class="reading-points-status">읽기 포인트를 준비하고 있어요…</p>`;
  }

  return `<section class="reading-points-section reading-resume-section" id="readingResumeSection" aria-labelledby="readingPointsQuestion">
    <p class="reading-points-question" id="readingPointsQuestion">어디까지 읽었나요?</p>
    ${bodyHtml}
  </section>`;
}

function saveCurrentPosition(link, pointId) {
  if (!pointId) return false;
  selectReadingPoint(link, pointId);
  return true;
}

function estimateProgressOnCheckIn(trail) {
  const count = (trail.checkInCount || 0) + 1;
  const stepped = Math.min(100, count * 25);
  return Math.max(trail.progressPercent || 0, stepped);
}

function migrateLegacyWebFields(link) {
  if (!link || isPdfUrl(link.url)) return;
  const trail = getWebReadTrail(link);
  const m = link.webMemo;
  if (m && typeof m === "object") {
    if (!trail.locationNote && typeof m.readHint === "string") {
      trail.locationNote = m.readHint.trim();
    }
    if (!trail.shortNote) {
      trail.shortNote = [m.whySaved, m.keyPoints, m.myThoughts, m.nextPoint]
        .filter(Boolean)
        .join("\n")
        .trim();
    }
  }
  link.readTrail = trail;
  delete link.webMemo;
}

function saveWebReadTrail(link, nextTrail) {
  if (!link || !nextTrail) return;
  const prev = getWebReadTrail(link);
  link.readTrail = {
    locationNote: String(nextTrail.locationNote ?? prev.locationNote).trim(),
    selectedPointId: String(nextTrail.selectedPointId ?? prev.selectedPointId).trim(),
    shortNote: String(nextTrail.shortNote ?? prev.shortNote).trim(),
    selectedText: String(nextTrail.selectedText ?? prev.selectedText).trim(),
    progressPercent: Math.max(0, Math.min(100, Number(nextTrail.progressPercent ?? prev.progressPercent) || 0)),
    checkInCount: Math.max(0, Number(nextTrail.checkInCount ?? prev.checkInCount) || 0),
    updatedAt: new Date().toISOString()
  };
  delete link.webMemo;
  saveAndRender();
}

function getOriginalUrl(link) {
  return stripTextFragment(link?.originalUrl || link?.url || "");
}

function getContinueUrl(link) {
  const checkpoint = String(link?.checkpointUrl || "").trim();
  if (checkpoint) return checkpoint;
  return getOriginalUrl(link);
}

function stripTextFragment(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  try {
    const u = new URL(value);
    if (/:~:text=/i.test(u.hash)) u.hash = "";
    return u.href;
  } catch {
    return value.replace(/#:~:.*$/i, "").replace(/#.*$/, "") || value;
  }
}

function getCanonicalPageKey(url) {
  try {
    const u = new URL(stripTextFragment(url) || url);
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`.toLowerCase();
  } catch {
    return String(stripTextFragment(url) || url)
      .trim()
      .toLowerCase();
  }
}

function parseTextFragmentFromUrl(url) {
  const value = String(url || "").trim();
  if (!value) return { hasFragment: false, text: "", checkpointUrl: "" };
  let hash = "";
  try {
    hash = new URL(value).hash || "";
  } catch {
    const idx = value.indexOf("#");
    hash = idx >= 0 ? value.slice(idx) : "";
  }
  const match = hash.match(/:~:text=([^&#]*)/i);
  if (!match) return { hasFragment: false, text: "", checkpointUrl: "" };

  const raw = match[1];
  const parts = raw.split(",").map((part) => {
    try {
      return decodeURIComponent(part.replace(/\+/g, " "));
    } catch {
      return part;
    }
  });

  let text = "";
  for (let i = 0; i < parts.length; i += 1) {
    const part = String(parts[i] || "").trim();
    if (!part) continue;
    if (i === 0 && part.endsWith("-") && parts.length > 1) continue;
    if (part.startsWith("-") && i === parts.length - 1) continue;
    text = part.replace(/-$/, "").replace(/^-/, "").trim();
    if (text) break;
  }

  return {
    hasFragment: true,
    text,
    checkpointUrl: value
  };
}

function findLinkByPageUrl(url) {
  const key = getCanonicalPageKey(url);
  if (!key) return null;
  return (
    (state.links || []).find((link) => !isPdfUrl(link.url) && getCanonicalPageKey(getOriginalUrl(link) || link.url) === key) ||
    null
  );
}

function normalizeCheckpointFields(link) {
  if (!link || isPdfUrl(link.url)) return;
  if (!link.originalUrl) link.originalUrl = stripTextFragment(link.url || "");
  else link.originalUrl = stripTextFragment(link.originalUrl);

  const parsedFromUrl = parseTextFragmentFromUrl(link.url || "");
  if (!link.checkpointUrl && parsedFromUrl.hasFragment) {
    link.checkpointUrl = parsedFromUrl.checkpointUrl;
    if (!link.checkpointText) link.checkpointText = parsedFromUrl.text;
  }

  if (typeof link.checkpointUrl !== "string") link.checkpointUrl = "";
  if (typeof link.checkpointText !== "string") link.checkpointText = "";
  if (!Array.isArray(link.checkpointHistory)) link.checkpointHistory = [];

  link.checkpointHistory = link.checkpointHistory
    .filter((item) => item && typeof item === "object" && item.url)
    .map((item) => ({
      url: String(item.url || ""),
      text: String(item.text || parseTextFragmentFromUrl(item.url).text || ""),
      savedAt: item.savedAt || null
    }))
    .slice(-20);

  // Keep stored url as the clean page identity to avoid duplicate cards.
  if (link.originalUrl) link.url = link.originalUrl;
  if (link.checkpointUrl && !link.checkpointText) {
    link.checkpointText = parseTextFragmentFromUrl(link.checkpointUrl).text || "";
  }
  if (!link.checkpointUpdatedAt && link.checkpointUrl) {
    link.checkpointUpdatedAt = link.lastVisitedAt || link.savedAt || null;
  }
}

function pushCheckpointHistory(link, url, text) {
  if (!link || !url) return;
  if (!Array.isArray(link.checkpointHistory)) link.checkpointHistory = [];
  const last = link.checkpointHistory[link.checkpointHistory.length - 1];
  if (last?.url === url) return;
  link.checkpointHistory.push({
    url,
    text: text || parseTextFragmentFromUrl(url).text || "",
    savedAt: new Date().toISOString()
  });
  if (link.checkpointHistory.length > 20) {
    link.checkpointHistory = link.checkpointHistory.slice(-20);
  }
}

function updateLinkCheckpoint(link, checkpointUrl, { select = true } = {}) {
  if (!link || isPdfUrl(link.url)) return link;
  normalizeCheckpointFields(link);
  const parsed = parseTextFragmentFromUrl(checkpointUrl);
  if (!parsed.hasFragment) return null;

  const samePage = getCanonicalPageKey(checkpointUrl) === getCanonicalPageKey(getOriginalUrl(link));
  if (!samePage) return null;

  if (link.checkpointUrl && link.checkpointUrl !== parsed.checkpointUrl) {
    pushCheckpointHistory(link, link.checkpointUrl, link.checkpointText);
  }

  link.checkpointUrl = parsed.checkpointUrl;
  link.checkpointText = parsed.text || link.checkpointText || "";
  link.checkpointUpdatedAt = new Date().toISOString();
  link.originalUrl = stripTextFragment(checkpointUrl) || link.originalUrl;
  link.url = link.originalUrl;

  if (select) {
    link.lastVisitedAt = link.checkpointUpdatedAt;
    state.ui.selectedLinkId = link.id;
    if (link.categoryId) state.ui.selectedCategoryId = link.categoryId;
  }
  return link;
}

function getCheckpointSnippet(link) {
  normalizeCheckpointFields(link);
  const text = String(link.checkpointText || "").trim();
  if (text) return text;
  if (link.checkpointUrl) return parseTextFragmentFromUrl(link.checkpointUrl).text || "";
  return "";
}

function formatCheckpointUpdatedAt(link) {
  const iso = link.checkpointUpdatedAt || link.lastVisitedAt || link.savedAt;
  if (!iso) return "아직 없음";
  return formatVisitWhen(iso) || relativeTime(iso);
}

function sourceNameFromUrl(url) {
  try {
    return new URL(stripTextFragment(url) || url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function getLinkSourceName(link) {
  return link?.sourceName || sourceNameFromUrl(getOriginalUrl(link)) || "웹";
}

function getReadingStatus(link) {
  return link?.readingStatus === "completed" ? "completed" : "reading";
}

function getReadingStatusLabel(status) {
  return status === "completed" ? "완료" : "읽는 중";
}

function getProgressPercent(link) {
  const trail = getWebReadTrail(link);
  if (Number.isFinite(trail.progressPercent) && trail.progressPercent > 0) {
    return Math.max(0, Math.min(100, trail.progressPercent));
  }
  const ratio = link?.readerState?.scrollRatio;
  if (Number.isFinite(ratio) && ratio > 0) {
    return Math.round(ratio * 100);
  }
  return 0;
}

function setReadingStatus(link, status) {
  link.readingStatus = status === "completed" ? "completed" : "reading";
  if (status === "completed") {
    const trail = getWebReadTrail(link);
    link.readTrail = { ...trail, progressPercent: 100, updatedAt: new Date().toISOString() };
  }
  saveAndRender();
}

function setProgressPercent(link, percent) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  const trail = getWebReadTrail(link);
  link.readTrail = { ...trail, progressPercent: p, updatedAt: new Date().toISOString() };
  if (p >= 100) link.readingStatus = "completed";
  else if (link.readingStatus === "completed") link.readingStatus = "reading";
  saveAndRender();
}

function appendReadVisit(link) {
  link.lastVisitedAt = new Date().toISOString();
  persistStateOnly();
}

function normalizeWebLink(link) {
  if (!link || typeof link !== "object" || isPdfUrl(link.url)) return;
  if (!link.originalUrl) link.originalUrl = link.url || "";
  if (!link.sourceName) link.sourceName = sourceNameFromUrl(getOriginalUrl(link));
  if (typeof link.ogImage !== "string") link.ogImage = "";
  if (!link.readingStatus) {
    link.readingStatus = getProgressPercent(link) >= 100 ? "completed" : "reading";
  }
  migrateLegacyWebFields(link);
  migrateLegacyToSnapshot(link);
  normalizeReadingSessions(link);
  normalizeReadingPoints(link);
  normalizeMemoryPoints(link);
  normalizeCheckpointFields(link);
  delete link.readingContinuity;
  const trail = getWebReadTrail(link);
  if (trail.progressPercent === 0 && link.readerState?.scrollRatio > 0) {
    trail.progressPercent = Math.round(link.readerState.scrollRatio * 100);
    link.readTrail = trail;
  }
  delete link.content;
  delete link.contentStatus;
  delete link.readerState;
  delete link.estimatedReadMinutes;
  delete link.readHistory;
  delete link.webMemo;
  link.readTrail = getWebReadTrail(link);
}

async function fetchLinkMetaClient(url) {
  try {
    const res = await fetch("/api/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function normalizeReadingPoints(link) {
  if (!link || isPdfUrl(link.url)) return;
  if (!Array.isArray(link.readingPoints)) link.readingPoints = [];
  link.readingPoints = getReadingPoints(link);
  if (!link.readingPointsStatus) {
    link.readingPointsStatus = link.readingPoints.length >= 3 ? "ready" : "pending";
  }
  if (link.readingPointsStatus === "failed" || link.readingPointsStatus === "manual") {
    link.readingPointsStatus = link.readingPoints.length >= 3 ? "ready" : "unset";
  }
  if (link.readingPointsStatus === "ready" && link.readingPoints.length < 3) {
    link.readingPointsStatus = "pending";
  }
}

async function generateReadingPointsForLink(link) {
  const url = getOriginalUrl(link);
  if (!url || isPdfUrl(url)) return;
  if (link.readingPointsStatus === "generating") return;
  link.readingPointsStatus = "generating";
  if (state.ui.selectedLinkId === link.id) saveAndRender();
  else persistStateOnly();
  try {
    const res = await fetch("/api/outline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        title: link.title,
        siteName: getLinkSourceName(link)
      })
    });
    if (!res.ok) throw new Error("analyze failed");
    const data = await res.json();
    const labels = Array.isArray(data.points) ? data.points : [];
    link.readingPoints = labels
      .map((label) => String(label || "").trim())
      .filter(Boolean)
      .slice(0, 8)
      .map((label) => ({ id: createId("rp"), label }));
    link.readingPointsStatus = link.readingPoints.length >= 3 ? "ready" : "unset";
  } catch {
    link.readingPoints = [];
    link.readingPointsStatus = "unset";
  }
  saveAndRender();
}

function queueReadingPointsGeneration(link) {
  if (!link || isPdfUrl(link.url)) return;
  if (getReadingPoints(link).length >= 3) return;
  if (link.readingPointsStatus === "generating") return;
  if (runtimeOutlineQueued.has(link.id)) return;
  runtimeOutlineQueued.add(link.id);
  generateReadingPointsForLink(link).finally(() => runtimeOutlineQueued.delete(link.id));
}

function ensureReadingPoints(link) {
  queueReadingPointsGeneration(link);
}

async function fetchAndApplyLinkMeta(link) {
  const url = getOriginalUrl(link);
  if (!url || isPdfUrl(url)) return;
  const hostTitle = sourceNameFromUrl(url) || "새 링크";
  const meta = await fetchLinkMetaClient(url);
  if (meta?.title && (!link.title || link.title === hostTitle || link.title === "새 링크")) {
    link.title = meta.title;
  } else if (!link.title || link.title === "새 링크") {
    link.title = hostTitle;
  }
  if (meta?.description && !String(link.description || "").trim()) {
    link.description = meta.description;
  }
  if (meta?.sourceName) link.sourceName = meta.sourceName;
  else if (!link.sourceName) link.sourceName = hostTitle;
  if (meta?.ogImage) link.ogImage = meta.ogImage;
  link.metaFetchedAt = new Date().toISOString();
  await ensureMemoryPoints(link, { force: true });
  saveAndRender();
}

async function enrichLinkMetaOnly(link) {
  if (!link || isPdfUrl(link.url)) return;
  await fetchAndApplyLinkMeta(link);
  saveAndRender();
}

function startLinkEnrichment(link) {
  if (!link || isPdfUrl(link.url)) return;
  normalizeMemoryPoints(link);
  if (!link.memoryPoints.suggested.length) {
    const local = generateMemoryPoints({
      url: getOriginalUrl(link),
      title: link.title || "",
      description: link.description || "",
      sourceName: link.sourceName || ""
    });
    applySuggestedMemoryPoints(link, local, "heuristic");
  }
  void enrichLinkMetaOnly(link);
}

async function enrichLinkMeta(link) {
  startLinkEnrichment(link);
}

function serializeStateForStorage(src) {
  const clone = structuredClone(src);
  for (const link of clone.links || []) {
    delete link.readingMoment;
  }
  return clone;
}

function persistStateOnly() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeStateForStorage(state)));
  if (auth.isLoggedIn) {
    localStorage.setItem(cloudStorageKey(auth.userId), JSON.stringify(serializeStateForStorage(state)));
  }
}

function openOriginalUrl(link) {
  openFromBeginning(link);
}

function continueOnOriginal(link) {
  openContinueReading(link);
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
  hunts: [],
  ui: {
    selectedCategoryId: ALL_CATEGORY,
    selectedLinkId: "l2",
    activeHuntId: null,
    expandedDescription: false,
    loginPromptedForLimit: false
  }
};

const auth = loadAuth();
const state = load();
normalizeState();
const autoSaveTimers = new Map();
const readPositionTimers = new Map();
const runtimeSaveStatus = {};
const runtimeOutlineQueued = new Set();
let teardownDetailView = () => {};

const categoryTabs = document.getElementById("categoryTabs");
const recentList = document.getElementById("recentList");
const continueCard = document.getElementById("continueCard");
const linkList = document.getElementById("linkList");
const localPdfList = document.getElementById("localPdfList");
const localPdfCategoryTitle = document.getElementById("localPdfCategoryTitle");
const detailPanel = document.getElementById("detailPanel");
const detailView = document.getElementById("detailView");
const closeDetailBtn = document.getElementById("closeDetailBtn");
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
let detailPanelOpen = false;
const guestNotice = document.getElementById("guestNotice");
const syncAcrossDevicesBtn = document.getElementById("syncAcrossDevicesBtn");
const connectExtensionBtn = document.getElementById("connectExtensionBtn");
const saveAiSummaryBtn = document.getElementById("saveAiSummaryBtn");
const createShareLinkBtn = document.getElementById("createShareLinkBtn");
const libraryMoreBtn = document.getElementById("libraryMoreBtn");
const libraryMoreMenu = document.getElementById("libraryMoreMenu");

const addCategoryBtn = document.getElementById("addCategoryBtn");
const deleteCategoryBtn = document.getElementById("deleteCategoryBtn");

function closeAllMoreMenus() {
  document.querySelectorAll(".more-menu").forEach((menu) => menu.classList.add("hidden"));
  if (libraryMoreBtn) libraryMoreBtn.setAttribute("aria-expanded", "false");
}

function openDetailPanel() {
  detailPanelOpen = true;
  if (!detailPanel) return;
  detailPanel.hidden = false;
  detailPanel.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeDetailPanel() {
  detailPanelOpen = false;
  if (!detailPanel) return;
  detailPanel.hidden = true;
  detailPanel.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function syncDetailPanelVisibility() {
  if (detailPanelOpen && state.ui.selectedLinkId) openDetailPanel();
  else closeDetailPanel();
}

if (closeDetailBtn) closeDetailBtn.addEventListener("click", () => {
  closeDetailPanel();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && detailPanelOpen && !document.querySelector("dialog[open]")) {
    closeDetailPanel();
  }
});

if (libraryMoreBtn && libraryMoreMenu) {
  libraryMoreBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = libraryMoreMenu.classList.contains("hidden");
    closeAllMoreMenus();
    if (willOpen) {
      libraryMoreMenu.classList.remove("hidden");
      libraryMoreBtn.setAttribute("aria-expanded", "true");
    }
  });
}

document.addEventListener("click", (event) => {
  if (event.target.closest(".more-wrap") || event.target.closest(".item-menu-btn") || event.target.closest(".more-menu")) {
    return;
  }
  closeAllMoreMenus();
});

if (addCategoryBtn) {
  addCategoryBtn.addEventListener("click", () => {
    closeAllMoreMenus();
    if (categoryNameInput) categoryNameInput.value = "";
    categoryModal?.showModal();
  });
}
if (deleteCategoryBtn) {
  deleteCategoryBtn.addEventListener("click", () => {
    closeAllMoreMenus();
    deleteSelectedCategory();
  });
}
document.getElementById("cancelCategoryBtn")?.addEventListener("click", () => {
  categoryModal?.close();
});
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
if (quickAddInput) {
  quickAddInput.addEventListener("keydown", onQuickAdd);
  quickAddInput.addEventListener("paste", onQuickAddPaste);
}
if (quickAddBtn) quickAddBtn.addEventListener("click", addQuickLinkFromInput);
if (pickPdfBtn && pdfFileInput) {
  pickPdfBtn.addEventListener("click", () => pdfFileInput.click());
  pdfFileInput.addEventListener("change", onPdfFileSelected);
}

const positionSaveModal = document.getElementById("positionSaveModal");
const positionSaveForm = document.getElementById("positionSaveForm");
const positionSaveInput = document.getElementById("positionSaveInput");
const positionSaveSubmitBtn = document.getElementById("positionSaveSubmitBtn");
const positionSaveOpenSiteBtn = document.getElementById("positionSaveOpenSiteBtn");
const positionSaveShowGuideBtn = document.getElementById("positionSaveShowGuideBtn");

if (positionSaveOpenSiteBtn) {
  positionSaveOpenSiteBtn.addEventListener("click", () => {
    if (!positionSaveTarget) return;
    const link = state.links.find((item) => item.id === positionSaveTarget.linkId);
    if (!link) return;
    const url = normalizeUrl(getOriginalUrl(link));
    if (!url) {
      alert("원본 URL이 없습니다.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  });
}
if (positionSaveSubmitBtn) {
  positionSaveSubmitBtn.addEventListener("click", (event) => {
    event.preventDefault();
    void submitPositionSaveModal();
  });
}
if (positionSaveInput) {
  positionSaveInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void submitPositionSaveModal();
  });
  positionSaveInput.addEventListener("paste", () => {
    setTimeout(() => setPositionSaveError(""), 0);
  });
}
if (positionSaveShowGuideBtn) {
  positionSaveShowGuideBtn.addEventListener("click", () => {
    syncPositionSaveGuideMode(true);
  });
}
if (positionSaveForm) {
  positionSaveForm.addEventListener("submit", (event) => {
    // Cancel / dialog close only. Save is handled by the primary button.
    if (event.submitter && event.submitter.value !== "cancel") {
      event.preventDefault();
    }
  });
}
async function tryPrefillPositionSaveFromClipboard() {
  const input = document.getElementById("positionSaveInput");
  if (!input || input.value.trim()) return;
  try {
    if (!navigator.clipboard?.readText) return;
    const clip = String(await navigator.clipboard.readText()).trim();
    if (clip && parseTextFragmentFromUrl(clip).hasFragment) {
      input.value = clip;
      input.focus();
      input.select();
      setPositionSaveError("");
    }
  } catch {
    /* clipboard unavailable */
  }
}

if (positionSaveModal) {
  positionSaveModal.addEventListener("close", () => {
    positionSaveTarget = null;
    setPositionSaveError("");
  });
}
window.addEventListener("focus", () => {
  if (positionSaveModal?.open) void tryPrefillPositionSaveFromClipboard();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && positionSaveModal?.open) {
    void tryPrefillPositionSaveFromClipboard();
  }
});

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

function looksLikeUrl(text) {
  const trimmed = String(text || "").trim();
  return /^https?:\/\//i.test(trimmed) || /^www\./i.test(trimmed);
}

async function onQuickAddPaste() {
  setTimeout(async () => {
    const rawUrl = quickAddInput?.value?.trim() || "";
    if (!looksLikeUrl(rawUrl)) return;
    await addQuickLinkFromInput();
  }, 0);
}

let quickAddInProgress = false;

async function addQuickLinkFromInput() {
  if (quickAddInProgress) return;
  const rawUrl = quickAddInput.value.trim();
  if (!rawUrl) return;

  const parsed = normalizeUrl(rawUrl);
  if (!parsed) {
    if (/file:/i.test(rawUrl)) {
      alert("로컬 PDF는 「PDF 불러오기」를 사용해 주세요.");
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

  quickAddInProgress = true;
  try {
    const isPdf = isPdfUrl(parsed);
    if (!isPdf) {
      const existing = findLinkByPageUrl(parsed);
      const fragment = parseTextFragmentFromUrl(parsed);
      if (existing) {
        if (fragment.hasFragment) {
          updateLinkCheckpoint(existing, parsed);
        } else {
          state.ui.selectedLinkId = existing.id;
          if (existing.categoryId) state.ui.selectedCategoryId = existing.categoryId;
          existing.lastVisitedAt = new Date().toISOString();
        }
        quickAddInput.value = "";
        detailPanelOpen = true;
        saveAndRender();
        return;
      }
    }

    const previousCount = getSavedItemCount();
    const hostTitle = sourceNameFromUrl(parsed) || "새 링크";
    const fragment = parseTextFragmentFromUrl(parsed);
    const cleanUrl = stripTextFragment(parsed) || parsed;

    const link = {
      id: createId("l"),
      categoryId: targetCategoryId,
      title: hostTitle,
      url: cleanUrl,
      originalUrl: cleanUrl,
      checkpointUrl: fragment.hasFragment ? fragment.checkpointUrl : "",
      checkpointText: fragment.hasFragment ? fragment.text : "",
      checkpointUpdatedAt: fragment.hasFragment ? new Date().toISOString() : null,
      checkpointHistory: [],
      sourceName: hostTitle,
      ogImage: "",
      description: "",
      savedAt: new Date().toISOString(),
      readingSessions: [],
      openCount: 0,
      memoryPoints: { suggested: [], custom: [], removed: [], status: "pending", source: "", generatedAt: null },
      tags: [],
      lastVisitedAt: new Date().toISOString()
    };

    state.links.unshift(link);
    state.ui.selectedCategoryId = targetCategoryId;
    quickAddInput.value = "";
    selectLink(link.id);

    if (!isPdf) {
      startLinkEnrichment(link);
    }

    maybePromptLoginByLimit(previousCount);
  } finally {
    quickAddInProgress = false;
  }
}

function pdfViewerHref(searchParams) {
  return new URL(`pdf-viewer.html?${searchParams.toString()}`, window.location.href).href;
}

function openLocalPdfViewer(id) {
  const qs = new URLSearchParams();
  qs.set("localId", id);
  window.location.href = pdfViewerHref(qs);
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
  let blob;
  try {
    const bytes = await file.arrayBuffer();
    if (!bytes || bytes.byteLength < 64) {
      alert("PDF 파일을 읽지 못했습니다. 다른 파일을 선택해 주세요.");
      return;
    }
    blob = new Blob([bytes], { type: "application/pdf" });
  } catch (e) {
    console.error(e);
    alert("PDF 파일을 읽지 못했습니다. 파일이 다른 프로그램에서 열려 있는지 확인해 주세요.");
    return;
  }
  const record = {
    id,
    blob,
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
  rebuildHunts();
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
  renderContinueCard();
  renderRecent();
  renderLocalPdfList();
  renderLinks();
  void renderDetail();
  syncDetailPanelVisibility();
}

function renderTabs() {
  if (!categoryTabs) return;
  categoryTabs.innerHTML = "";
  const tabs = [{ id: ALL_CATEGORY, name: "전체" }, ...state.categories];
  for (const tab of tabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tab";
    if (tab.id === state.ui.selectedCategoryId) button.classList.add("active");
    button.textContent = tab.name;
    button.addEventListener("click", () => {
      state.ui.selectedCategoryId = tab.id;
      state.ui.expandedDescription = false;
      closeDetailPanel();
      saveAndRender();
    });
    categoryTabs.appendChild(button);
  }
}

function getMostRecentResumeItem() {
  const linkCandidates = (state.links || []).map((link) => ({
    kind: "link",
    id: link.id,
    at: getLinkActivityMs(link) || new Date(link.lastVisitedAt || link.savedAt || 0).getTime() || 0,
    link
  }));
  const pdfCandidates = (state.localPdfs || []).map((item) => ({
    kind: "localPdf",
    id: item.id,
    at: new Date(item.addedAt || 0).getTime() || 0,
    item
  }));
  return [...linkCandidates, ...pdfCandidates].sort((a, b) => b.at - a.at)[0] || null;
}

function getPdfPageLabel(pageNumber) {
  const page = Math.max(1, Number.parseInt(String(pageNumber), 10) || 1);
  return `${page}쪽까지 읽음`;
}

function getLibraryLineForLocalPdf(item) {
  const lastPage = getLocalPdfLastPage(item.id);
  return `📄 PDF · ${getPdfPageLabel(lastPage)}`;
}

function getLibraryLineForLink(link) {
  if (isPdfUrl(link.url)) {
    const snap = getPdfSnapshotFromStorage(link.url);
    const page = snap?.pageNumber != null ? getPdfPageLabel(snap.pageNumber) : "페이지 기록 없음";
    return `📄 PDF · ${page}`;
  }
  const source = getLinkSourceName(link);
  if (getSavedResumeSentence(link)) return `🔗 ${source} · 읽던 문장 저장됨`;
  return `🔗 ${source}`;
}

function getSavedResumeSentence(link) {
  if (!link || isPdfUrl(link.url)) return "";
  const checkpoint = String(getCheckpointSnippet(link) || "").trim();
  if (checkpoint) return checkpoint;
  // Fallback: older data may keep the last sentence only in description.
  const desc = String(link.description || "").trim();
  if (desc && desc.length >= 8 && desc.length <= 220) return desc;
  return "";
}

function getLinkResumeHint(link) {
  if (isPdfUrl(link.url)) {
    const snap = getPdfSnapshotFromStorage(link.url);
    if (snap?.pageNumber != null) return getPdfPageLabel(snap.pageNumber);
    return "페이지 기록 없음";
  }
  const sentence = getSavedResumeSentence(link);
  if (sentence) return shortText(sentence, 120);
  return "";
}

function renderContinueSpotHtml({ isPdf, pageLabel, quote, emptyText }) {
  if (isPdf) {
    return `
      <p class="continue-spot">
        <span class="continue-spot-label">마지막으로 읽은 곳</span>
        <span class="continue-page">${escapeHtml(pageLabel)}</span>
      </p>`;
  }
  if (quote) {
    return `
      <p class="continue-spot">
        <span class="continue-spot-label">마지막으로 읽은 곳</span>
        <span class="continue-quote">“${escapeHtml(quote)}”</span>
      </p>`;
  }
  return `
    <p class="continue-spot">
      <span class="continue-spot-label">마지막으로 읽은 곳</span>
      <span class="continue-spot-empty">${escapeHtml(emptyText || "아직 저장된 읽기 위치가 없습니다.")}</span>
    </p>`;
}

const POSITION_GUIDE_KEY = "keepPoint_positionSaveGuideCompact";
let positionSaveTarget = null;

function hasUsedPositionSaveBefore() {
  try {
    if (localStorage.getItem(POSITION_GUIDE_KEY) === "1") return true;
  } catch {
    /* ignore */
  }
  return (state.links || []).some((link) => !isPdfUrl(link.url) && Boolean(getCheckpointSnippet(link)));
}

function markPositionSaveGuideCompact() {
  try {
    localStorage.setItem(POSITION_GUIDE_KEY, "1");
  } catch {
    /* ignore */
  }
}

function setPositionSaveError(message) {
  const el = document.getElementById("positionSaveError");
  if (!el) return;
  if (!message) {
    el.textContent = "";
    el.classList.add("hidden");
    return;
  }
  el.textContent = message;
  el.classList.remove("hidden");
}

function syncPositionSaveGuideMode(forceDetailed = false) {
  const detailed = document.getElementById("positionSaveGuideDetailed");
  const compact = document.getElementById("positionSaveGuideCompact");
  if (!detailed || !compact) return;
  const useCompact = !forceDetailed && hasUsedPositionSaveBefore();
  detailed.classList.toggle("hidden", useCompact);
  compact.classList.toggle("hidden", !useCompact);
}

async function openPositionSaveModal(link, { select = true } = {}) {
  if (!link || isPdfUrl(link.url)) return;
  const modal = document.getElementById("positionSaveModal");
  const input = document.getElementById("positionSaveInput");
  const targetText = document.getElementById("positionSaveTargetText");
  if (!modal || !input) return;

  positionSaveTarget = { linkId: link.id, select: Boolean(select) };
  if (targetText) {
    targetText.textContent = `${link.title || "웹페이지"} · ${getLinkSourceName(link)}`;
  }
  setPositionSaveError("");
  syncPositionSaveGuideMode(false);
  input.value = "";

  try {
    if (navigator.clipboard?.readText) {
      const clip = String(await navigator.clipboard.readText()).trim();
      if (clip && parseTextFragmentFromUrl(clip).hasFragment) {
        input.value = clip;
      }
    }
  } catch {
    /* clipboard unavailable */
  }

  if (!modal.open) modal.showModal();
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

async function submitPositionSaveModal() {
  if (!positionSaveTarget) return;
  const link = state.links.find((item) => item.id === positionSaveTarget.linkId);
  const input = document.getElementById("positionSaveInput");
  const modal = document.getElementById("positionSaveModal");
  if (!link || !input) return;

  setPositionSaveError("");
  const ok = await applyCheckpointUpdateFromInput(link, input.value, {
    select: positionSaveTarget.select,
    quiet: true
  });
  if (!ok) {
    const raw = String(input.value || "").trim();
    if (!raw) setPositionSaveError("복사한 링크를 붙여넣어 주세요.");
    else if (!parseTextFragmentFromUrl(raw).hasFragment) {
      setPositionSaveError("「선택한 텍스트로 연결되는 링크 복사」로 만든 링크를 붙여넣어 주세요.");
    } else {
      setPositionSaveError("같은 페이지의 위치 링크만 저장할 수 있습니다. 웹사이트를 연 뒤 다시 복사해 주세요.");
    }
    input.focus();
    input.select();
    return;
  }
  markPositionSaveGuideCompact();
  positionSaveTarget = null;
  if (modal?.open) modal.close();
}

function moveLinkToCategory(link) {
  if (!link || isPdfUrl(link.url)) return;
  const categories = state.categories || [];
  if (!categories.length) {
    alert("이동할 카테고리가 없습니다. 먼저 카테고리를 추가해 주세요.");
    return;
  }
  const lines = categories.map((c, i) => `${i + 1}. ${c.name}${c.id === link.categoryId ? " (현재)" : ""}`).join("\n");
  const answer = prompt(`이동할 카테고리 번호를 입력하세요.\n\n${lines}`, "");
  if (answer == null) return;
  const index = Number.parseInt(String(answer).trim(), 10) - 1;
  const target = categories[index];
  if (!target) {
    alert("올바른 카테고리 번호를 입력해 주세요.");
    return;
  }
  if (link.categoryId === target.id) return;
  link.categoryId = target.id;
  saveAndRender();
}

function bindWebContinueSecondaryActions(root, link) {
  if (!root || !link || isPdfUrl(link.url)) return;
  const fromStartBtn = root.querySelector("#continueFromStartBtn");
  const updateBtn = root.querySelector("#continueUpdateCheckpointBtn");

  fromStartBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    openFromBeginning(link);
  });

  updateBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    openPositionSaveModal(link, { select: true });
  });
}

function renderWebContinueActionsHtml() {
  return `
    <button type="button" class="btn continue-cta" id="continueHeroBtn">이어서 읽기 →</button>
    <div class="continue-secondary-actions">
      <button type="button" class="btn ghost sm" id="continueFromStartBtn">처음부터 읽기</button>
      <button type="button" class="btn ghost sm" id="continueUpdateCheckpointBtn">읽던 위치 저장</button>
    </div>`;
}

function renderContinueCard() {
  if (!continueCard) return;
  const newest = getMostRecentResumeItem();
  if (!newest) {
    continueCard.className = "continue-card continue-card--empty";
    continueCard.innerHTML = `<p class="continue-empty">아직 읽던 자료가 없습니다. 아래에서 새 자료를 추가해 보세요.</p>`;
    return;
  }

  continueCard.className = "continue-card";
  if (newest.kind === "localPdf") {
    const item = newest.item;
    const lastPage = getLocalPdfLastPage(item.id);
    const when = formatVisitWhen(item.addedAt) || relativeTime(item.addedAt);
    continueCard.innerHTML = `
      <p class="continue-kicker">이어서 읽기</p>
      <h2 class="continue-title">${escapeHtml(item.title || item.fileName)}</h2>
      <div class="continue-meta-row">
        <p class="continue-source">📄 PDF</p>
        <p class="continue-time">${escapeHtml(when)}</p>
      </div>
      ${renderContinueSpotHtml({ isPdf: true, pageLabel: getPdfPageLabel(lastPage) })}
      <button type="button" class="btn continue-cta" id="continueHeroBtn">이어서 읽기 →</button>
    `;
    continueCard.querySelector("#continueHeroBtn")?.addEventListener("click", () => openLocalPdfViewer(item.id));
    return;
  }

  const link = newest.link;
  const isPdf = isPdfUrl(link.url);
  const when = formatVisitWhen(getLinkActivityAt(link) || link.lastVisitedAt || link.savedAt) || relativeTime(link.lastVisitedAt);
  const source = isPdf ? "📄 PDF" : `🔗 ${getLinkSourceName(link)}`;
  const pageLabel = isPdf ? getLinkResumeHint(link) : "";
  const quote = isPdf ? "" : getSavedResumeSentence(link);
  continueCard.innerHTML = `
    <p class="continue-kicker">이어서 읽기</p>
    <h2 class="continue-title">${escapeHtml(link.title)}</h2>
    <div class="continue-meta-row">
      <p class="continue-source">${escapeHtml(source)}</p>
      <p class="continue-time">${escapeHtml(when)}</p>
    </div>
    ${renderContinueSpotHtml({
      isPdf,
      pageLabel,
      quote: quote ? shortText(quote, 140) : "",
      emptyText: "아직 저장된 읽기 위치가 없습니다. 이어서 읽기를 누르면 원문으로 이동합니다."
    })}
    ${
      isPdf
        ? `<button type="button" class="btn continue-cta" id="continueHeroBtn">이어서 읽기 →</button>`
        : renderWebContinueActionsHtml()
    }
  `;
  continueCard.querySelector("#continueHeroBtn")?.addEventListener("click", () => {
    if (isPdf) openPdfViewer(link.id, false);
    else continueOnOriginal(link);
  });
  if (!isPdf) bindWebContinueSecondaryActions(continueCard, link);
}

function renderRecent() {
  if (!recentList) return;
  recentList.innerHTML = "";
}

function bindItemMoreMenu(li) {
  const menuBtn = li.querySelector(".item-menu-btn");
  const menu = li.querySelector(".more-menu");
  if (!menuBtn || !menu) return;
  menuBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = menu.classList.contains("hidden");
    closeAllMoreMenus();
    if (willOpen) menu.classList.remove("hidden");
  });
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
    if (!getVisibleLinks().length) {
      const empty = document.createElement("li");
      empty.className = "local-pdf-empty";
      empty.textContent = selectedCategory
        ? `「${selectedCategory.name}」에 저장된 자료가 없습니다.`
        : "저장된 자료가 없습니다. URL을 붙여넣거나 PDF를 불러와 보세요.";
      localPdfList.appendChild(empty);
    }
    return;
  }
  for (const item of list) {
    const when = formatVisitWhen(item.addedAt) || relativeTime(item.addedAt);
    const li = document.createElement("li");
    li.className = "item";
    li.innerHTML = `
      <h3 class="item-title">${escapeHtml(item.title || item.fileName)}</h3>
      <p class="item-line">${escapeHtml(getLibraryLineForLocalPdf(item))}</p>
      <p class="item-time">${escapeHtml(when)}</p>
      <button type="button" class="item-menu-btn" aria-label="더보기">⋯</button>
      <div class="more-menu hidden">
        <button type="button" data-action="continue">이어서 읽기</button>
        <button type="button" data-action="rename">제목 수정</button>
        <button type="button" class="danger" data-action="remove">삭제</button>
      </div>
    `;
    bindItemMoreMenu(li);
    li.addEventListener("click", (event) => {
      const action = event.target?.dataset?.action;
      if (action === "continue") {
        event.stopPropagation();
        closeAllMoreMenus();
        openLocalPdfViewer(item.id);
        return;
      }
      if (action === "rename") {
        event.stopPropagation();
        closeAllMoreMenus();
        const next = prompt("PDF 제목", item.title || item.fileName);
        if (next == null) return;
        const newTitle = next.trim() || item.fileName;
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
        return;
      }
      if (action === "remove") {
        event.stopPropagation();
        closeAllMoreMenus();
        deleteLocalPdf(item.id);
        return;
      }
      if (event.target?.closest(".item-menu-btn") || event.target?.closest(".more-menu")) return;
      openLocalPdfViewer(item.id);
    });
    localPdfList.appendChild(li);
  }
}

function renderLinks() {
  if (!linkList) return;
  linkList.innerHTML = "";
  const selectedCategory = state.categories.find((c) => c.id === state.ui.selectedCategoryId);
  if (currentCategoryTitle) {
    currentCategoryTitle.textContent = selectedCategory ? `${selectedCategory.name} 링크` : "전체 링크";
  }
  const resumeItem = getMostRecentResumeItem();
  const currentResumeLinkId = resumeItem?.kind === "link" ? resumeItem.id : null;

  for (const link of getVisibleLinks()) {
    const isPdf = isPdfUrl(link.url);
    const li = document.createElement("li");
    li.className = `item${isPdf ? "" : " item--web"}`;
    if (currentResumeLinkId && link.id === currentResumeLinkId) li.classList.add("is-current");
    if (detailPanelOpen && link.id === state.ui.selectedLinkId) li.classList.add("active");
    const when = formatVisitWhen(getLinkActivityAt(link) || link.lastVisitedAt || link.savedAt) || relativeTime(link.lastVisitedAt);

    if (isPdf) {
      li.innerHTML = `
        <h3 class="item-title">${escapeHtml(link.title)}</h3>
        <p class="item-line">${escapeHtml(getLibraryLineForLink(link))}</p>
        <p class="item-time">${escapeHtml(when)}</p>
        <button type="button" class="item-menu-btn" aria-label="더보기">⋯</button>
        <div class="more-menu hidden">
          <button type="button" data-action="continue">이어서 읽기</button>
          <button type="button" data-action="detail">상세 보기</button>
          <button type="button" data-action="original">원본 보기</button>
          <button type="button" data-action="share">공유</button>
          <button type="button" class="danger" data-action="delete">삭제</button>
        </div>
      `;
    } else {
      li.innerHTML = `
        <div class="item-body">
          <h3 class="item-title">${escapeHtml(link.title)}</h3>
          <p class="item-line">${escapeHtml(getLibraryLineForLink(link))}</p>
          <p class="item-time">${escapeHtml(when)}</p>
          ${
            currentResumeLinkId === link.id
              ? `<span class="item-current-badge">현재 선택됨</span>`
              : ""
          }
        </div>
        <div class="item-quick-actions" aria-label="빠른 작업">
          <button type="button" class="btn sm" data-action="continue">이어서 읽기</button>
          <button type="button" class="btn ghost sm" data-action="update-checkpoint">읽던 위치 저장</button>
        </div>
        <button type="button" class="item-menu-btn" aria-label="더보기">⋯</button>
        <div class="more-menu hidden">
          <button type="button" data-action="continue" data-mobile-only="1">이어서 읽기</button>
          <button type="button" data-action="from-start">처음부터 읽기</button>
          <button type="button" data-action="update-checkpoint" data-mobile-only="1">읽던 위치 저장</button>
          <button type="button" data-action="move-category">카테고리 이동</button>
          <button type="button" data-action="detail">상세 보기</button>
          <button type="button" data-action="share">공유</button>
          <button type="button" class="danger" data-action="delete">삭제</button>
        </div>
      `;
    }

    bindItemMoreMenu(li);
    li.addEventListener("click", (event) => {
      const action = event.target?.dataset?.action;

      if (action === "continue") {
        event.stopPropagation();
        closeAllMoreMenus();
        if (isPdf) openPdfViewer(link.id, false);
        else continueOnOriginal(link);
        return;
      }
      if (action === "from-start") {
        event.stopPropagation();
        closeAllMoreMenus();
        openFromBeginning(link);
        return;
      }
      if (action === "update-checkpoint") {
        event.stopPropagation();
        closeAllMoreMenus();
        if (!isPdf) openPositionSaveModal(link, { select: false });
        return;
      }
      if (action === "move-category") {
        event.stopPropagation();
        closeAllMoreMenus();
        moveLinkToCategory(link);
        return;
      }
      if (action === "detail") {
        event.stopPropagation();
        closeAllMoreMenus();
        selectLink(link.id, { openDetail: true });
        return;
      }
      if (action === "original") {
        event.stopPropagation();
        closeAllMoreMenus();
        openOriginalUrl(link);
        return;
      }
      if (action === "share") {
        event.stopPropagation();
        closeAllMoreMenus();
        shareLink(link.id);
        return;
      }
      if (action === "delete") {
        event.stopPropagation();
        closeAllMoreMenus();
        deleteLink(link.id);
        return;
      }
      if (
        event.target?.closest(".item-menu-btn") ||
        event.target?.closest(".more-menu") ||
        event.target?.closest(".item-quick-actions")
      ) {
        return;
      }
      if (isPdf) openPdfViewer(link.id, false);
      else continueOnOriginal(link);
    });

    linkList.appendChild(li);
  }
}

async function renderDetail() {
  teardownDetailView();
  const selectedId = state.ui.selectedLinkId;
  const link = state.links.find((item) => item.id === selectedId);

  if (!link) {
    detailView.classList.add("empty");
    detailView.textContent = "링크를 저장하면 기억 포인트가 여기에 나타납니다.";
    teardownDetailView = () => {};
    if (detailPanelOpen) closeDetailPanel();
    return;
  }

  detailView.classList.remove("empty");

  if (state.ui.selectedLinkId !== selectedId) return;
  const isPdf = isPdfUrl(link.url);
  if (!isPdf) {
    void ensureMemoryPoints(link);
  }
  const pdfSnap = isPdf ? getPdfSnapshotFromStorage(link.url) : null;
  const saveStatusText = runtimeSaveStatus[link.id] || "저장됨";

  const pdfPageLine =
    pdfSnap && pdfSnap.pageNumber != null ? `마지막 페이지: ${pdfSnap.pageNumber}` : "저장된 페이지 없음";

  const webPanelHtml = !isPdf ? renderWebLinkDetailPanel(link) : "";

  detailView.innerHTML = `
    ${isPdf
      ? `<h3>${escapeHtml(link.title)}</h3>
         <p class="context-meta">PDF</p>
         <a href="${escapeAttr(getOriginalUrl(link))}" target="_blank" rel="noreferrer">원문 링크</a>
         <div class="resume-card">
           <strong>읽던 위치</strong>
           <div>${pdfPageLine}</div>
           <div class="resume-actions">
             <button type="button" class="btn continue-cta" id="openPdfBtn">이어서 읽기 →</button>
           </div>
           <details class="detail-manage">
             <summary>⋯ 관리</summary>
             <div class="detail-manage-menu">
               <button type="button" class="btn ghost" id="restartPdfBtn">처음부터 (1페이지)</button>
               <button type="button" class="btn ghost" id="clearPdfBtn">PDF 읽기 위치 삭제</button>
               <button type="button" class="btn ghost" id="shareCurrentBtn">공유</button>
               <button type="button" class="btn danger" id="deleteCurrentBtn">삭제</button>
             </div>
           </details>
         </div>`
      : webPanelHtml}
    ${isPdf
      ? `<div class="save-row">
      <span id="saveStatus" class="save-status">${escapeHtml(saveStatusText)}</span>
    </div>`
      : ""}
    ${isPdf
      ? `<details class="detail-manage">
          <summary>태그 · 설명</summary>
          <label>
            태그
            <div id="selectedTags" class="tag-editor-list"></div>
            <input id="newTagInput" placeholder="새 태그 입력 후 Enter" />
            <div id="tagSuggestions" class="tag-suggestions"></div>
          </label>
          <label>
            설명
            <textarea id="editDescInput" rows="5">${escapeHtml(link.description || "")}</textarea>
          </label>
          <p class="meta">PC에 있는 PDF는 홈의 <strong>PDF 불러오기</strong>로 여세요. 아래는 링크로 연 PDF입니다.</p>
        </details>`
      : ""}
  `;

  const statusEl = document.getElementById("saveStatus");
  const descInput = document.getElementById("editDescInput");
  const selectedTagsEl = document.getElementById("selectedTags");
  const tagSuggestionsEl = document.getElementById("tagSuggestions");
  const newTagInput = document.getElementById("newTagInput");
  const openPdfBtn = document.getElementById("openPdfBtn");
  const restartPdfBtn = document.getElementById("restartPdfBtn");
  const clearPdfBtn = document.getElementById("clearPdfBtn");
  let unbindWebLinkEvents = () => {};
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
  if (openPdfBtn) openPdfBtn.addEventListener("click", onOpenPdfClick);
  if (restartPdfBtn) restartPdfBtn.addEventListener("click", onRestartPdfClick);
  if (clearPdfBtn) clearPdfBtn.addEventListener("click", onClearPdfClick);
  if (!isPdf) {
    unbindWebLinkEvents = bindWebLinkDetailEvents(detailView, link);
  }

  const onShareClick = () => shareLink(link.id);
  const onDeleteClick = () => deleteLink(link.id);
  const shareCurrentBtn = document.getElementById("shareCurrentBtn");
  const deleteCurrentBtn = document.getElementById("deleteCurrentBtn");
  if (shareCurrentBtn) shareCurrentBtn.addEventListener("click", onShareClick);
  if (deleteCurrentBtn) deleteCurrentBtn.addEventListener("click", onDeleteClick);

  teardownDetailView = () => {
    document.getElementById("snapshotLightbox")?.remove();
    clearTimeout(autoSaveTimers.get(link.id));
    clearTimeout(readPositionTimers.get(link.id));
    if (onDescInput && descInput) descInput.removeEventListener("input", onDescInput);
    if (onNewTagKeydown && newTagInput) newTagInput.removeEventListener("keydown", onNewTagKeydown);
    if (openPdfBtn) openPdfBtn.removeEventListener("click", onOpenPdfClick);
    if (restartPdfBtn) restartPdfBtn.removeEventListener("click", onRestartPdfClick);
    if (clearPdfBtn) clearPdfBtn.removeEventListener("click", onClearPdfClick);
    unbindWebLinkEvents();
    if (shareCurrentBtn) shareCurrentBtn.removeEventListener("click", onShareClick);
    if (deleteCurrentBtn) deleteCurrentBtn.removeEventListener("click", onDeleteClick);
  };
}

function selectLink(linkId, { openDetail = true, touchVisit = false } = {}) {
  const link = state.links.find((item) => item.id === linkId);
  if (!link) return;
  state.ui.selectedLinkId = linkId;
  state.ui.expandedDescription = false;
  if (touchVisit) link.lastVisitedAt = new Date().toISOString();
  const hunt = getHuntForLink(link);
  if (hunt) setActiveHunt(hunt.id);
  if (openDetail) detailPanelOpen = true;
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
  if (link && isPdfUrl(link.url)) {
    localStorage.removeItem(getPdfReadingStorageKey(link.url));
  } else if (link) {
    idbDeleteVisualRecord(linkId).catch(console.error);
  }
  clearTimeout(readPositionTimers.get(linkId));
  state.ui.selectedLinkId = getVisibleLinks()[0]?.id || null;
  saveAndRender();
}

function shareLink(linkId) {
  if (!requireLoginFor("share-link")) return;
  const link = state.links.find((item) => item.id === linkId);
  if (!link) return;
  const payload = buildShareHuntText(link);
  navigator.clipboard
    .writeText(payload)
    .then(() => alert("이어 읽기 정보가 복사되었습니다."))
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
  if (!Array.isArray(state.hunts)) state.hunts = [];
  if (!("activeHuntId" in state.ui)) state.ui.activeHuntId = null;
  const fallbackCategoryId = state.categories?.[0]?.id || null;
  for (const pdf of state.localPdfs) {
    if (!pdf.categoryId && fallbackCategoryId) {
      pdf.categoryId = fallbackCategoryId;
    }
  }
  if (!state.profile || typeof state.profile !== "object") state.profile = { name: "게스트" };
  if (!state.ui.loginPromptedForLimit) state.ui.loginPromptedForLimit = false;
  for (const link of state.links || []) {
    if (!link.readTrail || typeof link.readTrail !== "object") {
      link.readTrail = {
        locationNote: "",
        selectedPointId: "",
        shortNote: "",
        selectedText: "",
        progressPercent: 0,
        checkInCount: 0,
        updatedAt: null
      };
    } else {
      link.readTrail = getWebReadTrail(link);
    }
    if (!isPdfUrl(link.url)) {
      normalizeWebLink(link);
      normalizeReadingSessions(link);
    }
  }
  rebuildHunts();
  if (!state.categories.some((c) => c.id === state.ui.selectedCategoryId) && state.ui.selectedCategoryId !== ALL_CATEGORY) {
    state.ui.selectedCategoryId = ALL_CATEGORY;
  }
  if (!state.links.some((l) => l.id === state.ui.selectedLinkId)) {
    const hunt = getActiveHunt();
    state.ui.selectedLinkId =
      hunt?.nextLinkId ||
      hunt?.lastLinkId ||
      [...state.links].sort((a, b) => new Date(b.lastVisitedAt || 0) - new Date(a.lastVisitedAt || 0))[0]?.id ||
      null;
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
  return pdfViewerHref(qs);
}

function openPdfViewer(linkId, restart) {
  const link = state.links.find((item) => item.id === linkId);
  if (!link || !isPdfUrl(link.url)) return;
  if (isDisallowedLocalFileUrl(link.url)) {
    alert("로컬 PDF는 「PDF 불러오기」를 사용해 주세요.");
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
    alert("로컬 PDF는 「PDF 불러오기」를 사용해 주세요.");
    return;
  }
  if (isPdfUrl(link.url)) {
    openPdfViewer(link.id, false);
  } else {
    continueOnOriginal(link);
  }
}

function saveAndRender() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeStateForStorage(state)));
  if (auth.isLoggedIn) {
    localStorage.setItem(cloudStorageKey(auth.userId), JSON.stringify(serializeStateForStorage(state)));
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

function resumePendingSnapshots() {
  for (const link of state.links) {
    if (isPdfUrl(link.url)) continue;
    migrateLegacyToSnapshot(link);
  }
}

async function bootApp() {
  installReadingSessionListeners();
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
  render();
  resumePendingSnapshots();
}

bootApp();
