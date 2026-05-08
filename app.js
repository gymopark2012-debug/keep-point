const STORAGE_KEY = "keepPointDataV2";
const ALL_CATEGORY = "all";

const defaultData = {
  profile: { name: "박경모" },
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
    }
  ],
  ui: {
    selectedCategoryId: ALL_CATEGORY,
    selectedLinkId: "l2",
    expandedDescription: false,
    readPositions: {}
  }
};

const state = load();
normalizeState();
const autoSaveTimers = new Map();
const readPositionTimers = new Map();
const runtimeSaveStatus = {};

const categoryTabs = document.getElementById("categoryTabs");
const recentList = document.getElementById("recentList");
const linkList = document.getElementById("linkList");
const detailView = document.getElementById("detailView");
const currentCategoryTitle = document.getElementById("currentCategoryTitle");
const profileName = document.getElementById("profileName");
const quickAddInput = document.getElementById("quickAddInput");
const categoryModal = document.getElementById("categoryModal");
const categoryForm = document.getElementById("categoryForm");
const categoryNameInput = document.getElementById("categoryNameInput");

document.getElementById("addCategoryBtn").addEventListener("click", () => {
  categoryNameInput.value = "";
  categoryModal.showModal();
});
document.getElementById("deleteCategoryBtn").addEventListener("click", deleteSelectedCategory);
categoryForm.addEventListener("submit", onCreateCategory);
quickAddInput.addEventListener("keydown", onQuickAdd);

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
    alert("올바른 링크를 붙여넣어 주세요.");
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
}

function render() {
  profileName.textContent = state.profile.name;
  renderTabs();
  renderRecent();
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
        <button class="btn ghost" data-action="share">공유</button>
        <button class="btn danger" data-action="delete">삭제</button>
      </div>
    `;

    li.addEventListener("click", (event) => {
      const action = event.target?.dataset?.action;
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
  const link = state.links.find((item) => item.id === state.ui.selectedLinkId);
  if (!link) {
    detailView.classList.add("empty");
    detailView.textContent = "링크가 없습니다. 링크를 붙여넣어 바로 추가해 보세요.";
    return;
  }

  detailView.classList.remove("empty");
  const savedReadPosition = getReadPosition(link.id);
  const readPercent = savedReadPosition.scrollProgress;
  const saveStatusText = runtimeSaveStatus[link.id] || "저장됨";

  detailView.innerHTML = `
    <div class="hover-actions">
      <button class="btn ghost" id="shareCurrentBtn">공유</button>
      <button class="btn danger" id="deleteCurrentBtn">삭제</button>
    </div>
    <h3>${escapeHtml(link.title)}</h3>
    <a href="${escapeAttr(link.url)}" target="_blank" rel="noreferrer">원문 링크</a>
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
    <section>
      <h4>읽기 보기</h4>
      <div class="reading-wrap">
        <div id="readingSurface" class="reading-surface">${escapeHtml(link.description || "설명 없음")}</div>
        <div class="reading-cursor" aria-hidden="true">현재 읽는 위치</div>
      </div>
      <div id="readingFocusText" class="reading-focus-text"></div>
    </section>
    <div id="readMarker" class="read-marker">── 여기까지 읽음 ── ${readPercent}%</div>
    <div class="meta">📍 마지막 위치: ${relativeTime(link.lastVisitedAt)}</div>
  `;

  const statusEl = document.getElementById("saveStatus");
  const descInput = document.getElementById("editDescInput");
  const selectedTagsEl = document.getElementById("selectedTags");
  const tagSuggestionsEl = document.getElementById("tagSuggestions");
  const newTagInput = document.getElementById("newTagInput");
  const readMarkerEl = document.getElementById("readMarker");
  const readingSurface = document.getElementById("readingSurface");
  const readingFocusTextEl = document.getElementById("readingFocusText");
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
    if (readingSurface) {
      readingSurface.textContent = link.description || "설명 없음";
    }
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
  descInput.addEventListener("input", () => {
    draftDesc = descInput.value;
    scheduleAutoSave();
  });
  newTagInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addTag(newTagInput.value);
    newTagInput.value = "";
  });

  const restoreReadPosition = (behavior) => {
    if (!readingSurface) return;
    const targetY = resolveRestoreScrollY(link, readingSurface, savedReadPosition);
    readingSurface.scrollTo({ top: targetY, behavior });
  };

  const updateReadingDisplay = (position) => {
    if (readMarkerEl) readMarkerEl.textContent = `── 현재 읽는 위치 ── ${position.scrollProgress}%`;
    if (!readingFocusTextEl) return;
    const source = (draftDesc || "").trim();
    if (!source) {
      readingFocusTextEl.textContent = "설명을 입력하면 현재 읽는 위치 미리보기가 표시됩니다.";
      return;
    }
    const cursorIndex = Math.min(source.length - 1, Math.max(0, Math.floor((position.scrollProgress / 100) * source.length)));
    const preview = source.slice(Math.max(0, cursorIndex - 28), Math.min(source.length, cursorIndex + 28));
    readingFocusTextEl.textContent = `읽는 부분: ...${preview}...`;
  };

  requestAnimationFrame(() => restoreReadPosition(savedReadPosition.scrollY > 0 ? "smooth" : "auto"));
  requestAnimationFrame(() => updateReadingDisplay(savedReadPosition));

  readingSurface.addEventListener("scroll", () => {
    const livePosition = getReadPositionFromElement(readingSurface);
    updateReadingDisplay(livePosition);

    clearTimeout(readPositionTimers.get(link.id));
    const timer = setTimeout(() => {
      const nextPosition = saveReadPosition(link.id, readingSurface);
      updateReadingDisplay(nextPosition);
    }, 1000);
    readPositionTimers.set(link.id, timer);
  });

  document.getElementById("shareCurrentBtn").addEventListener("click", () => shareLink(link.id));
  document.getElementById("deleteCurrentBtn").addEventListener("click", () => deleteLink(link.id));
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
  clearTimeout(readPositionTimers.get(linkId));
  state.ui.selectedLinkId = getVisibleLinks()[0]?.id || null;
  saveAndRender();
}

function shareLink(linkId) {
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
  try {
    return new URL(value).toString();
  } catch {
    try {
      return new URL(`https://${value}`).toString();
    } catch {
      return null;
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

function saveAndRender() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
}

function load() {
  try {
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
