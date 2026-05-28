const STORAGE_KEY = "keepPointDataV2";
const AUTH_KEY = "keepPointAuthV1";
const CLOUD_KEY_PREFIX = "keepPointCloudV1_";
const ALL_CATEGORY = "all";

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

function loadAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return { isLoggedIn: false, userId: "guest", name: "게스트", email: "" };
    const parsed = JSON.parse(raw);
    if (parsed?.isLoggedIn && parsed?.userId) {
      return {
        isLoggedIn: true,
        userId: String(parsed.userId),
        name: String(parsed.name || "사용자"),
        email: String(parsed.email || "")
      };
    }
  } catch {
    /* ignore */
  }
  return { isLoggedIn: false, userId: "guest", name: "게스트", email: "" };
}

function saveAuth() {
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

function getSavedItemCount() {
  return (Array.isArray(state.links) ? state.links.length : 0) + (Array.isArray(state.localPdfs) ? state.localPdfs.length : 0);
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
const detailView = document.getElementById("detailView");
const currentCategoryTitle = document.getElementById("currentCategoryTitle");
const profileName = document.getElementById("profileName");
const openLoginBtn = document.getElementById("openLoginBtn");
const openProfileBtn = document.getElementById("openProfileBtn");
const quickAddInput = document.getElementById("quickAddInput");
const pdfFileInput = document.getElementById("pdfFileInput");
const pickPdfBtn = document.getElementById("pickPdfBtn");
const categoryModal = document.getElementById("categoryModal");
const categoryForm = document.getElementById("categoryForm");
const categoryNameInput = document.getElementById("categoryNameInput");
const loginModal = document.getElementById("loginModal");
const loginForm = document.getElementById("loginForm");
const loginNameInput = document.getElementById("loginNameInput");
const loginEmailInput = document.getElementById("loginEmailInput");
const profileModal = document.getElementById("profileModal");
const profileStatusText = document.getElementById("profileStatusText");
const profileNameInput = document.getElementById("profileNameInput");
const profileEmailInput = document.getElementById("profileEmailInput");
const deleteAccountBtn = document.getElementById("deleteAccountBtn");
const guestNotice = document.getElementById("guestNotice");
const syncAcrossDevicesBtn = document.getElementById("syncAcrossDevicesBtn");
const connectExtensionBtn = document.getElementById("connectExtensionBtn");
const saveAiSummaryBtn = document.getElementById("saveAiSummaryBtn");
const createShareLinkBtn = document.getElementById("createShareLinkBtn");

document.getElementById("addCategoryBtn").addEventListener("click", () => {
  categoryNameInput.value = "";
  categoryModal.showModal();
});
document.getElementById("deleteCategoryBtn").addEventListener("click", deleteSelectedCategory);
categoryForm.addEventListener("submit", onCreateCategory);
if (openLoginBtn) openLoginBtn.addEventListener("click", () => openLoginModal("manual"));
if (openProfileBtn) openProfileBtn.addEventListener("click", openProfileModal);
if (loginForm) loginForm.addEventListener("submit", onLoginSubmit);
if (deleteAccountBtn) deleteAccountBtn.addEventListener("click", onDeleteAccount);
if (syncAcrossDevicesBtn) syncAcrossDevicesBtn.addEventListener("click", onSyncAcrossDevicesClick);
if (connectExtensionBtn) connectExtensionBtn.addEventListener("click", onConnectExtensionClick);
if (saveAiSummaryBtn) saveAiSummaryBtn.addEventListener("click", onSaveAiSummaryClick);
if (createShareLinkBtn) createShareLinkBtn.addEventListener("click", onCreateShareLinkClick);
quickAddInput.addEventListener("keydown", onQuickAdd);
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
  profileModal.showModal();
}

function onDeleteAccount() {
  if (!auth.isLoggedIn) return;
  const ok = confirm("계정을 삭제할까요?\n클라우드에 저장된 계정 데이터가 삭제되고 게스트 모드로 전환됩니다.");
  if (!ok) return;

  const cloudKey = cloudStorageKey(auth.userId);
  localStorage.removeItem(cloudKey);
  localStorage.removeItem(AUTH_KEY);

  auth.isLoggedIn = false;
  auth.userId = "guest";
  auth.name = "게스트";
  auth.email = "";

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

function openLoginModal(reason) {
  if (!loginModal) return;
  const reasonMap = {
    limit: "읽던 위치를 계속 보관하려면 로그인하세요.",
    sync: "로그인하면 다른 기기에서도 이어 읽을 수 있어요.",
    extension: "Chrome Extension 연동은 로그인 후 사용할 수 있어요.",
    "ai-summary": "AI 요약 저장은 로그인 후 사용할 수 있어요.",
    "share-link": "공유 링크 만들기는 로그인 후 사용할 수 있어요.",
    manual: "읽던 위치를 계속 보관하려면 로그인하세요."
  };
  const msg = reasonMap[reason] || reasonMap.manual;
  const helper = loginForm?.querySelector(".meta");
  if (helper) helper.textContent = msg;
  if (loginNameInput) loginNameInput.value = auth.name === "게스트" ? "" : auth.name;
  if (loginEmailInput) loginEmailInput.value = auth.email || "";
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

async function onLoginSubmit(event) {
  event.preventDefault();
  const email = String(loginEmailInput?.value || "").trim().toLowerCase();
  if (!email) return;
  const name = String(loginNameInput?.value || "").trim() || email.split("@")[0] || "사용자";
  const userId = email.replace(/[^a-z0-9@._-]/gi, "_");

  auth.isLoggedIn = true;
  auth.userId = userId;
  auth.name = name;
  auth.email = email;
  saveAuth();

  await migrateGuestDataToUser(userId);
  state.profile.name = name;
  saveAndRender();
  if (loginModal?.open) loginModal.close();
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

function onCreateCategory(event) {
  event.preventDefault();
  const name = categoryNameInput.value.trim();
  if (!name) return;
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

  const title = await autoTitleFromUrl(parsed);
  const targetCategoryId = state.ui.selectedCategoryId === ALL_CATEGORY
    ? state.categories[0]?.id
    : state.ui.selectedCategoryId;

  if (!targetCategoryId) {
    alert("먼저 카테고리를 생성해 주세요.");
    return;
  }

  const previousCount = getSavedItemCount();
  const link = {
    id: createId("l"),
    categoryId: targetCategoryId,
    title,
    url: parsed,
    tags: [],
    description: "",
    lastVisitedAt: new Date().toISOString()
  };

  state.links.unshift(link);
  state.ui.selectedCategoryId = targetCategoryId;
  selectLink(link.id);
  quickAddInput.value = "";
  maybePromptLoginByLimit(previousCount);
}

function openLocalPdfViewer(id) {
  const href = window.location.href.split("#")[0];
  const slash = Math.max(href.lastIndexOf("/"), href.lastIndexOf("\\"));
  const baseDir = slash >= 0 ? href.slice(0, slash + 1) : `${href}/`;
  const qs = new URLSearchParams();
  qs.set("localId", id);
  window.location.href = `${baseDir}pdf-viewer.html?${qs.toString()}`;
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
  if (!Array.isArray(state.localPdfs)) state.localPdfs = [];
  state.localPdfs.unshift({
    id,
    title: baseTitle,
    fileName: file.name,
    size: file.size,
    lastModified: file.lastModified,
    addedAt: createdAt
  });
  saveAndRender();
  maybePromptLoginByLimit(previousCount);
}

function render() {
  profileName.textContent = auth.isLoggedIn ? `${state.profile.name}` : "게스트";
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
  const list = Array.isArray(state.localPdfs) ? state.localPdfs : [];
  if (!list.length) {
    const empty = document.createElement("li");
    empty.className = "local-pdf-empty";
    empty.textContent = "저장된 내 PC PDF가 없습니다. 위의 「내 PDF 열기」로 파일을 추가해 주세요.";
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
    const li = document.createElement("li");
    li.className = "item";
    if (link.id === state.ui.selectedLinkId) li.classList.add("active");

    li.innerHTML = `
      <div>${escapeHtml(link.title)}</div>
      <div class="meta">📍 마지막 위치: ${relativeTime(link.lastVisitedAt)}</div>
      <div class="preview">${escapeHtml(shortText(link.description || "설명 없음", 65))}</div>
      <div class="hover-actions">
        <button class="btn" data-action="read">읽기</button>
        <button class="btn ghost" data-action="share">공유</button>
        <button class="btn danger" data-action="delete">삭제</button>
      </div>
    `;

    li.addEventListener("click", (event) => {
      const action = event.target?.dataset?.action;
      if (action === "read") {
        event.stopPropagation();
        openLinkForReading(link);
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
  const pdfSnap = isPdf ? getPdfSnapshotFromStorage(link.url) : null;
  const saveStatusText = runtimeSaveStatus[link.id] || "저장됨";

  const pdfPageLine =
    pdfSnap && pdfSnap.pageNumber != null ? `마지막 페이지: ${pdfSnap.pageNumber}` : "저장된 페이지 없음";

  const readCardHtml = isPdf
    ? `<div class="resume-card"><strong>PDF</strong><div>${pdfPageLine}</div><div class="resume-actions"><button type="button" class="btn" id="openPdfBtn">PDF 뷰어에서 열기</button><button type="button" class="btn ghost" id="restartPdfBtn">처음부터 (1페이지)</button><button type="button" class="btn danger" id="clearPdfBtn">PDF 읽기 위치 삭제</button></div></div>`
    : `<div class="resume-card"><strong>웹사이트</strong><p class="meta" style="margin:6px 0 0;">KeepPoint 안의 iframe·내부 reader로는 열지 않습니다. 아래 버튼은 <strong>원문 URL을 새 탭</strong>으로 엽니다. 스크롤·선택 위치는 <strong>KeepPoint Chrome 확장</strong>이 해당 사이트에서 저장·복원합니다.</p><div class="resume-actions"><button type="button" class="btn" id="resumeWebReadBtn">이어 읽기</button></div></div>`;

  const readingBlock = isPdf
    ? `<p class="meta">PC에 있는 PDF는 목록 위의 <strong>내 PDF 열기</strong>로 여세요. 아래는 링크로 연 PDF입니다.</p>`
    : `<p class="meta">일반 웹사이트의 마지막 위치 복원은 KeepPoint 웹앱이 아니라 Chrome 확장프로그램이 처리합니다.</p>`;

  detailView.innerHTML = `
    <div class="hover-actions">
      <button class="btn ghost" id="shareCurrentBtn">공유</button>
      <button class="btn danger" id="deleteCurrentBtn">삭제</button>
    </div>
    <h3>${escapeHtml(link.title)}</h3>
    <a href="${escapeAttr(link.url)}" target="_blank" rel="noreferrer">원문 링크</a>
    ${readCardHtml}
    <div class="save-row">
      <span id="saveStatus" class="save-status">${escapeHtml(saveStatusText)}</span>
    </div>
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
    ${readingBlock}
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
  const resumeWebReadBtn = document.getElementById("resumeWebReadBtn");
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

  renderTagEditor();

  const onDescInput = () => {
    draftDesc = descInput.value;
    scheduleAutoSave();
  };
  descInput.addEventListener("input", onDescInput);

  const onNewTagKeydown = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addTag(newTagInput.value);
    newTagInput.value = "";
  };
  newTagInput.addEventListener("keydown", onNewTagKeydown);

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
  const onResumeWebReadClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openWebLinkInNewTab(link);
  };

  if (openPdfBtn) openPdfBtn.addEventListener("click", onOpenPdfClick);
  if (restartPdfBtn) restartPdfBtn.addEventListener("click", onRestartPdfClick);
  if (clearPdfBtn) clearPdfBtn.addEventListener("click", onClearPdfClick);
  if (resumeWebReadBtn) resumeWebReadBtn.addEventListener("click", onResumeWebReadClick);

  const onShareClick = () => shareLink(link.id);
  const onDeleteClick = () => deleteLink(link.id);
  const shareCurrentBtn = document.getElementById("shareCurrentBtn");
  const deleteCurrentBtn = document.getElementById("deleteCurrentBtn");
  shareCurrentBtn.addEventListener("click", onShareClick);
  deleteCurrentBtn.addEventListener("click", onDeleteClick);

  teardownDetailView = () => {
    clearTimeout(autoSaveTimers.get(link.id));
    clearTimeout(readPositionTimers.get(link.id));
    descInput.removeEventListener("input", onDescInput);
    newTagInput.removeEventListener("keydown", onNewTagKeydown);
    if (openPdfBtn) openPdfBtn.removeEventListener("click", onOpenPdfClick);
    if (restartPdfBtn) restartPdfBtn.removeEventListener("click", onRestartPdfClick);
    if (clearPdfBtn) clearPdfBtn.removeEventListener("click", onClearPdfClick);
    if (resumeWebReadBtn) resumeWebReadBtn.removeEventListener("click", onResumeWebReadClick);
    shareCurrentBtn.removeEventListener("click", onShareClick);
    deleteCurrentBtn.removeEventListener("click", onDeleteClick);
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
  if (!confirm(`'${category.name}' 카테고리를 삭제할까요?\n해당 링크도 함께 삭제됩니다.`)) return;

  state.categories = state.categories.filter((item) => item.id !== category.id);
  state.links = state.links.filter((item) => item.categoryId !== category.id);
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
  const payload = [
    `카테고리: ${category?.name || "없음"}`,
    `제목: ${link.title}`,
    `링크: ${link.url}`,
    `설명: ${link.description || "없음"}`
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

function normalizeState() {
  if (!state.ui || typeof state.ui !== "object") state.ui = {};
  if (!Array.isArray(state.localPdfs)) state.localPdfs = [];
  if (!state.profile || typeof state.profile !== "object") state.profile = { name: "게스트" };
  if (!state.ui.loginPromptedForLimit) state.ui.loginPromptedForLimit = false;
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
  const href = window.location.href.split("#")[0];
  const slash = Math.max(href.lastIndexOf("/"), href.lastIndexOf("\\"));
  const baseDir = slash >= 0 ? href.slice(0, slash + 1) : `${href}/`;
  return `${baseDir}pdf-viewer.html?${qs.toString()}`;
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
  const normalized = normalizeUrl(link.url);
  if (!normalized) {
    alert("열 수 없는 링크입니다.");
    return;
  }
  link.lastVisitedAt = new Date().toISOString();
  window.open(normalized, "_blank", "noopener,noreferrer");
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
    openWebLinkInNewTab(link);
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

render();
