(async () => {
  const PDF_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

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

  async function idbGetLocalPdfRecord(id) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const r = tx.objectStore(IDB_STORE).get(id);
      r.onerror = () => reject(r.error);
      r.onsuccess = () => resolve(r.result);
    });
  }

  const params = new URLSearchParams(window.location.search);
  const localId = String(params.get("localId") || "").trim();
  const rawUrl = params.get("url");
  const isRestart = params.get("mode") === "restart";

  const backBtn = document.getElementById("backBtn");
  const docTitle = document.getElementById("docTitle");
  const sourceLink = document.getElementById("sourceLink");
  const prevPage = document.getElementById("prevPage");
  const nextPage = document.getElementById("nextPage");
  const pageLabel = document.getElementById("pageLabel");
  const pdfScroll = document.getElementById("pdfScroll");
  const pdfCanvas = document.getElementById("pdfCanvas");
  const pdfStage = document.getElementById("pdfStage");
  const annotationLayer = document.getElementById("annotationLayer");
  const dragPreview = document.getElementById("dragPreview");
  const pdfError = document.getElementById("pdfError");
  const toolHighlight = document.getElementById("toolHighlight");
  const toolMemo = document.getElementById("toolMemo");
  const toolSelect = document.getElementById("toolSelect");
  const deleteAnnotationBtn = document.getElementById("deleteAnnotationBtn");
  const memoPanel = document.getElementById("memoPanel");
  const memoEditor = document.getElementById("memoEditor");
  const memoSaveBtn = document.getElementById("memoSaveBtn");
  const memoCancelBtn = document.getElementById("memoCancelBtn");

  const pdfUrlParam = rawUrl ? String(rawUrl).trim() : "";

  let pdfSrc = "";
  let localIdMode = false;
  let localMeta = null;
  let revokeOnHide = null;
  let currentPage = 1;
  let pdfDoc = null;
  let totalPages = 0;
  let currentTool = "highlight";
  let annotationsByPage = {};
  let selectedAnnotationId = null;
  let pendingMemo = null;
  let dragState = null;
  let pageTextItems = [];

  function getStorageKey() {
    if (localIdMode && localId) {
      return `keepPoint_pdf_local_${localId}`;
    }
    return `keepPoint_pdf_reading_${encodeURIComponent(pdfUrlParam || pdfSrc)}`;
  }

  function indexPageHref() {
    const href = window.location.href.split("#")[0];
    const slash = Math.max(href.lastIndexOf("/"), href.lastIndexOf("\\"));
    const baseDir = slash >= 0 ? href.slice(0, slash + 1) : "";
    return `${baseDir}index.html`;
  }

  function isPdfPath(u) {
    const base = String(u || "").split(/[?#]/)[0].toLowerCase();
    return base.endsWith(".pdf");
  }

  function looksLikeHttpUrl(u) {
    try {
      const x = new URL(u, window.location.href);
      return x.protocol === "http:" || x.protocol === "https:";
    } catch {
      return false;
    }
  }

  function createId(prefix) {
    return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  function loadSavedState() {
    if (isRestart) {
      localStorage.removeItem(getStorageKey());
      return { pageNumber: 1, annotations: {} };
    }
    try {
      const raw = localStorage.getItem(getStorageKey());
      if (!raw) return { pageNumber: 1, annotations: {} };
      const o = JSON.parse(raw);
      const pageNumber = Math.max(1, Number.parseInt(String(o.pageNumber), 10) || 1);
      const annotations =
        o.annotations && typeof o.annotations === "object" ? o.annotations : {};
      return { pageNumber, annotations };
    } catch {
      return { pageNumber: 1, annotations: {} };
    }
  }

  function persistState() {
    const payload = {
      pageNumber: currentPage,
      url: localIdMode ? null : pdfUrlParam,
      localId: localIdMode ? localId : null,
      annotations: annotationsByPage
    };
    localStorage.setItem(getStorageKey(), JSON.stringify(payload));
  }

  function getPageAnnotations(pageNum) {
    const key = String(pageNum);
    if (!Array.isArray(annotationsByPage[key])) {
      annotationsByPage[key] = [];
    }
    return annotationsByPage[key];
  }

  function getLayerSize() {
    return {
      width: pdfCanvas.clientWidth || pdfCanvas.width,
      height: pdfCanvas.clientHeight || pdfCanvas.height
    };
  }

  function normRect(x1, y1, x2, y2) {
    const { width, height } = getLayerSize();
    const left = Math.min(x1, x2) / width;
    const top = Math.min(y1, y2) / height;
    const w = Math.abs(x2 - x1) / width;
    const h = Math.abs(y2 - y1) / height;
    return {
      left: Math.max(0, Math.min(1, left)),
      top: Math.max(0, Math.min(1, top)),
      width: Math.max(0.005, Math.min(1, w)),
      height: Math.max(0.008, Math.min(1, h))
    };
  }

  function rectToPx(rect) {
    const { width, height } = getLayerSize();
    return {
      left: rect.left * width,
      top: rect.top * height,
      width: rect.width * width,
      height: rect.height * height
    };
  }

  async function loadPageTextItems(pageNum) {
    if (!pdfDoc) return [];
    try {
      const page = await pdfDoc.getPage(pageNum);
      const content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1.35 });
      const items = [];
      for (const item of content.items) {
        if (!item.str || !item.transform) continue;
        const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
        const fontHeight = Math.hypot(tx[2], tx[3]);
        const x = tx[4];
        const y = tx[5] - fontHeight;
        const w = item.width * viewport.scale;
        const h = fontHeight * 1.2;
        items.push({ text: item.str, x, y, w, h });
      }
      return items;
    } catch {
      return [];
    }
  }

  function extractTextInRect(rect) {
    const px = rectToPx(rect);
    const x2 = px.left + px.width;
    const y2 = px.top + px.height;
    const parts = [];
    for (const item of pageTextItems) {
      const ix2 = item.x + item.w;
      const iy2 = item.y + item.h;
      const overlap =
        item.x < x2 && ix2 > px.left && item.y < y2 && iy2 > px.top;
      if (overlap) parts.push(item.text);
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  function setTool(tool) {
    currentTool = tool;
    [toolHighlight, toolMemo, toolSelect].forEach((btn) => {
      if (!btn) return;
      btn.classList.toggle("active", btn.dataset.tool === tool);
      btn.classList.toggle("ghost", btn.dataset.tool !== tool);
    });
    annotationLayer.classList.toggle("tool-select", tool === "select");
    annotationLayer.classList.toggle("tool-memo", tool === "memo");
    if (tool !== "memo") closeMemoPanel();
  }

  function selectAnnotation(id) {
    selectedAnnotationId = id;
    if (deleteAnnotationBtn) deleteAnnotationBtn.disabled = !id;
    annotationLayer.querySelectorAll("[data-ann-id]").forEach((el) => {
      el.classList.toggle("selected", el.dataset.annId === id);
    });
  }

  function closeMemoPanel() {
    pendingMemo = null;
    memoPanel?.classList.add("hidden");
    if (memoEditor) memoEditor.value = "";
  }

  function openMemoPanel(draft) {
    pendingMemo = draft;
    if (memoEditor) memoEditor.value = draft.note || "";
    memoPanel?.classList.remove("hidden");
    memoEditor?.focus();
  }

  function saveMemoFromPanel() {
    if (!pendingMemo) return;
    const note = String(memoEditor?.value || "").trim();
    if (!note) {
      alert("메모 내용을 입력해 주세요.");
      return;
    }
    const pageAnns = getPageAnnotations(pendingMemo.page);
    if (pendingMemo.id) {
      const existing = pageAnns.find((a) => a.id === pendingMemo.id);
      if (existing) {
        existing.note = note;
        existing.updatedAt = new Date().toISOString();
      }
    } else {
      pageAnns.push({
        id: createId("m"),
        type: "memo",
        left: pendingMemo.left,
        top: pendingMemo.top,
        note,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    closeMemoPanel();
    persistState();
    renderAnnotations();
  }

  function deleteSelectedAnnotation() {
    if (!selectedAnnotationId) return;
    const pageAnns = getPageAnnotations(currentPage);
    const idx = pageAnns.findIndex((a) => a.id === selectedAnnotationId);
    if (idx < 0) return;
    pageAnns.splice(idx, 1);
    selectAnnotation(null);
    persistState();
    renderAnnotations();
  }

  function renderAnnotations() {
    annotationLayer.innerHTML = "";
    const { width, height } = getLayerSize();
    annotationLayer.style.width = `${width}px`;
    annotationLayer.style.height = `${height}px`;

    const pageAnns = getPageAnnotations(currentPage);
    for (const ann of pageAnns) {
      if (ann.type === "underline" || ann.type === "highlight") {
        const px = rectToPx(ann);
        const el = document.createElement("div");
        el.className = "pv-highlight";
        el.dataset.annId = ann.id;
        el.style.left = `${px.left}px`;
        el.style.top = `${px.top}px`;
        el.style.width = `${px.width}px`;
        el.style.height = `${px.height}px`;
        el.title = ann.text || "밑줄";
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          setTool("select");
          selectAnnotation(ann.id);
        });
        annotationLayer.appendChild(el);
      } else if (ann.type === "memo") {
        const px = rectToPx({ left: ann.left, top: ann.top, width: 0, height: 0 });
        const el = document.createElement("button");
        el.type = "button";
        el.className = "pv-memo-pin";
        el.dataset.annId = ann.id;
        el.style.left = `${px.left}px`;
        el.style.top = `${px.top}px`;
        el.textContent = "M";
        el.dataset.preview = ann.note || "";
        el.title = ann.note || "메모";
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          setTool("select");
          selectAnnotation(ann.id);
          openMemoPanel({
            id: ann.id,
            page: currentPage,
            left: ann.left,
            top: ann.top,
            note: ann.note
          });
        });
        annotationLayer.appendChild(el);
      }
    }
    if (selectedAnnotationId) {
      selectAnnotation(selectedAnnotationId);
    }
  }

  function layerCoords(event) {
    const rect = annotationLayer.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function onLayerPointerDown(event) {
    if (event.button !== 0) return;
    const target = event.target.closest("[data-ann-id]");
    if (target && currentTool === "select") {
      selectAnnotation(target.dataset.annId);
      return;
    }
    if (currentTool === "highlight") {
      const { x, y } = layerCoords(event);
      dragState = { x1: x, y1: y, x2: x, y2: y };
      dragPreview.classList.remove("hidden");
      updateDragPreview();
      event.preventDefault();
      return;
    }
    if (currentTool === "memo") {
      const { width, height } = getLayerSize();
      const { x, y } = layerCoords(event);
      openMemoPanel({
        page: currentPage,
        left: Math.max(0, Math.min(1, x / width)),
        top: Math.max(0, Math.min(1, y / height)),
        note: ""
      });
      event.preventDefault();
    }
  }

  function updateDragPreview() {
    if (!dragState) return;
    const px = {
      left: Math.min(dragState.x1, dragState.x2),
      top: Math.min(dragState.y1, dragState.y2),
      width: Math.abs(dragState.x2 - dragState.x1),
      height: Math.abs(dragState.y2 - dragState.y1)
    };
    dragPreview.style.left = `${px.left}px`;
    dragPreview.style.top = `${px.top}px`;
    dragPreview.style.width = `${px.width}px`;
    dragPreview.style.height = `${px.height}px`;
  }

  function onLayerPointerMove(event) {
    if (!dragState) return;
    const { x, y } = layerCoords(event);
    dragState.x2 = x;
    dragState.y2 = y;
    updateDragPreview();
  }

  function onLayerPointerUp() {
    if (!dragState) return;
    const { width, height } = getLayerSize();
    const minSize = 6;
    if (
      Math.abs(dragState.x2 - dragState.x1) < minSize &&
      Math.abs(dragState.y2 - dragState.y1) < minSize
    ) {
      dragState = null;
      dragPreview.classList.add("hidden");
      return;
    }
    const rect = normRect(dragState.x1, dragState.y1, dragState.x2, dragState.y2);
    const text = extractTextInRect(rect);
    getPageAnnotations(currentPage).push({
      id: createId("u"),
      type: "underline",
      ...rect,
      text,
      createdAt: new Date().toISOString()
    });
    dragState = null;
    dragPreview.classList.add("hidden");
    persistState();
    renderAnnotations();
  }

  if (typeof pdfjsLib !== "undefined") {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
  }

  backBtn.addEventListener("click", () => {
    persistState();
    window.location.href = indexPageHref();
  });

  function showErr(err) {
    pdfError.classList.remove("hidden");
    pdfError.textContent = err && err.message ? String(err.message) : "PDF 로드 실패";
  }

  toolHighlight?.addEventListener("click", () => setTool("highlight"));
  toolMemo?.addEventListener("click", () => setTool("memo"));
  toolSelect?.addEventListener("click", () => setTool("select"));
  deleteAnnotationBtn?.addEventListener("click", deleteSelectedAnnotation);
  memoSaveBtn?.addEventListener("click", saveMemoFromPanel);
  memoCancelBtn?.addEventListener("click", closeMemoPanel);

  annotationLayer.addEventListener("mousedown", onLayerPointerDown);
  window.addEventListener("mousemove", onLayerPointerMove);
  window.addEventListener("mouseup", onLayerPointerUp);

  try {
    if (localId) {
      localIdMode = true;
      const rec = await idbGetLocalPdfRecord(localId);
      if (!rec?.blob) {
        throw new Error("IndexedDB에 PDF가 없습니다. 메인 화면에서 다시 추가해 주세요.");
      }
      localMeta = rec;
      const blobUrl = URL.createObjectURL(rec.blob);
      pdfSrc = blobUrl;
      revokeOnHide = blobUrl;
    } else {
      if (!pdfUrlParam || pdfUrlParam.startsWith("blob:")) {
        throw new Error("PDF가 필요합니다. 링크(?url=…pdf) 또는 내 PC PDF는 「이어 읽기」로 열어 주세요.");
      }
      if (!isPdfPath(pdfUrlParam) && !looksLikeHttpUrl(pdfUrlParam)) {
        throw new Error("PDF 주소가 올바르지 않습니다. (.pdf 링크 또는 http(s) URL)");
      }
      pdfSrc = new URL(pdfUrlParam, window.location.href).href;
    }
  } catch (e) {
    showErr(e);
    return;
  }

  if (revokeOnHide) {
    window.addEventListener(
      "pagehide",
      () => {
        persistState();
        try {
          URL.revokeObjectURL(revokeOnHide);
        } catch {
          /* ignore */
        }
      },
      { once: true }
    );
  }

  window.addEventListener("beforeunload", () => persistState());

  if (localIdMode) {
    sourceLink.href = "#";
    sourceLink.textContent = localMeta?.fileName || "로컬 PDF";
    sourceLink.title = "이 기기에 저장된 PDF";
  } else {
    sourceLink.href = pdfSrc;
    sourceLink.textContent = pdfUrlParam;
    sourceLink.removeAttribute("download");
  }

  const saved = loadSavedState();
  currentPage = saved.pageNumber;
  annotationsByPage = saved.annotations;

  async function renderPage() {
    if (!pdfDoc) return;
    currentPage = Math.min(Math.max(1, currentPage), totalPages);
    selectAnnotation(null);
    closeMemoPanel();
    pageTextItems = await loadPageTextItems(currentPage);
    const page = await pdfDoc.getPage(currentPage);
    const viewport = page.getViewport({ scale: 1.35 });
    const ctx = pdfCanvas.getContext("2d");
    pdfCanvas.height = viewport.height;
    pdfCanvas.width = viewport.width;
    await page.render({ canvasContext: ctx, viewport }).promise;
    pageLabel.textContent = `${currentPage} / ${totalPages}`;
    persistState();
    pdfScroll.scrollTop = 0;
    requestAnimationFrame(() => renderAnnotations());
  }

  prevPage.addEventListener("click", async () => {
    if (currentPage <= 1) return;
    currentPage -= 1;
    await renderPage().catch((e) => showErr(e));
  });

  nextPage.addEventListener("click", async () => {
    if (currentPage >= totalPages) return;
    currentPage += 1;
    await renderPage().catch((e) => showErr(e));
  });

  async function openPdfDocument() {
    const opts = { url: pdfSrc, withCredentials: false, disableRange: true, disableStream: true };
    try {
      const task = pdfjsLib.getDocument(opts);
      return await task.promise;
    } catch {
      const res = await fetch(pdfSrc, { mode: "cors", credentials: "omit" });
      if (!res.ok) throw new Error(`PDF fetch HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const task2 = pdfjsLib.getDocument({ data: buf });
      return await task2.promise;
    }
  }

  if (typeof pdfjsLib === "undefined") {
    showErr(new Error("PDF.js 스크립트를 불러오지 못했습니다."));
    return;
  }

  openPdfDocument()
    .then(async (doc) => {
      pdfDoc = doc;
      totalPages = doc.numPages;
      let titleFromUser = false;
      if (localIdMode && localMeta?.title && String(localMeta.title).trim()) {
        docTitle.textContent = String(localMeta.title).trim();
        titleFromUser = true;
      } else {
        docTitle.textContent = "PDF";
      }
      if (!titleFromUser) {
        try {
          const meta = await doc.getMetadata();
          const t = meta?.info?.Title;
          if (t && String(t).trim()) docTitle.textContent = String(t).trim();
        } catch {
          /* ignore */
        }
      }
      currentPage = Math.min(Math.max(1, currentPage), totalPages);
      setTool("highlight");
      await renderPage();
    })
    .catch((err) => showErr(err));
})();
