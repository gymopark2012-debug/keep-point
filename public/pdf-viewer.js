(async () => {
  const PDF_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const HIGHLIGHT_WIDTH = 22;

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
  const pdfStage = document.getElementById("pdfStage");
  const pdfCanvas = document.getElementById("pdfCanvas");
  const annotationSvg = document.getElementById("annotationSvg");
  const annotationLayer = document.getElementById("annotationLayer");
  const pdfError = document.getElementById("pdfError");
  const toolPen = document.getElementById("toolPen");
  const toolMemo = document.getElementById("toolMemo");
  const deleteAllBtn = document.getElementById("deleteAllBtn");
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
  let currentTool = "pen";
  let annotationsByPage = {};
  let pendingMemo = null;
  let penState = null;
  let livePenPath = null;

  function getStorageKey() {
    if (localIdMode && localId) {
      return `keepPoint_pdf_local_${localId}`;
    }
    return `keepPoint_pdf_reading_${encodeURIComponent(pdfUrlParam || pdfSrc)}`;
  }

  function indexPageHref() {
    return "/";
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

  function getDisplayMetrics() {
    const rect = pdfCanvas.getBoundingClientRect();
    return {
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
      left: rect.left,
      top: rect.top
    };
  }

  function getLayerSize() {
    const { width, height } = getDisplayMetrics();
    return { width, height };
  }

  function syncAnnotationOverlay() {
    const { width, height } = getDisplayMetrics();
    const w = `${width}px`;
    const h = `${height}px`;
    if (pdfStage) {
      pdfStage.style.width = w;
      pdfStage.style.height = h;
    }
    annotationLayer.style.width = w;
    annotationLayer.style.height = h;
    annotationLayer.style.left = "0";
    annotationLayer.style.top = "0";
    annotationSvg.style.width = w;
    annotationSvg.style.height = h;
    annotationSvg.style.left = "0";
    annotationSvg.style.top = "0";
    annotationSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    annotationSvg.removeAttribute("width");
    annotationSvg.removeAttribute("height");
  }

  function normPoint(x, y) {
    const { width, height } = getLayerSize();
    return {
      x: Math.max(0, Math.min(1, x / width)),
      y: Math.max(0, Math.min(1, y / height))
    };
  }

  function pointToPx(p) {
    const { width, height } = getLayerSize();
    return { x: p.x * width, y: p.y * height };
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

  function pointsToPathD(points) {
    if (!points.length) return "";
    const px = points.map(pointToPx);
    let d = `M ${px[0].x} ${px[0].y}`;
    for (let i = 1; i < px.length; i += 1) {
      d += ` L ${px[i].x} ${px[i].y}`;
    }
    return d;
  }

  function setTool(tool) {
    currentTool = tool;
    [toolPen, toolMemo].forEach((btn) => {
      if (!btn) return;
      btn.classList.toggle("active", btn.dataset.tool === tool);
      btn.classList.toggle("ghost", btn.dataset.tool !== tool);
    });
    annotationLayer.classList.toggle("tool-pen", tool === "pen");
    annotationLayer.classList.toggle("tool-memo", tool === "memo");
    if (tool !== "memo") closeMemoPanel();
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
    pageAnns.push({
      id: createId("m"),
      type: "memo",
      left: pendingMemo.left,
      top: pendingMemo.top,
      note,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    closeMemoPanel();
    persistState();
    renderAnnotations();
  }

  function deleteAnnotationById(id, pageNum) {
    const page = pageNum ?? currentPage;
    const pageAnns = getPageAnnotations(page);
    const idx = pageAnns.findIndex((a) => a.id === id);
    if (idx < 0) return;
    pageAnns.splice(idx, 1);
    persistState();
    renderAnnotations();
  }

  function deleteAllAnnotations() {
    const total = Object.values(annotationsByPage).reduce(
      (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
      0
    );
    if (total === 0) {
      alert("삭제할 밑줄·메모가 없습니다.");
      return;
    }
    if (!confirm(`모든 페이지의 밑줄·메모 ${total}개를 전부 삭제할까요?`)) return;
    annotationsByPage = {};
    closeMemoPanel();
    persistState();
    renderAnnotations();
  }

  function renderAnnotations() {
    syncAnnotationOverlay();
    annotationSvg.innerHTML = "";
    annotationLayer.innerHTML = "";

    const pageAnns = getPageAnnotations(currentPage);
    for (const ann of pageAnns) {
      if (ann.type === "pen" && Array.isArray(ann.points) && ann.points.length > 1) {
        const strokeW =
          !ann.strokeWidth || ann.strokeWidth < 10 ? HIGHLIGHT_WIDTH : ann.strokeWidth;
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.dataset.annId = ann.id;

        const pathD = pointsToPathD(ann.points);

        const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
        hit.setAttribute("d", pathD);
        hit.setAttribute("fill", "none");
        hit.setAttribute("class", "pv-pen-hit");
        hit.setAttribute("stroke", "transparent");
        hit.setAttribute("stroke-width", String(strokeW + 14));
        hit.addEventListener("click", (e) => {
          e.stopPropagation();
          deleteAnnotationById(ann.id);
        });

        const visible = document.createElementNS("http://www.w3.org/2000/svg", "path");
        visible.setAttribute("d", pathD);
        visible.setAttribute("fill", "none");
        visible.setAttribute("class", "pv-highlighter-stroke");
        visible.setAttribute("stroke-width", String(strokeW));

        g.appendChild(hit);
        g.appendChild(visible);
        annotationSvg.appendChild(g);
      } else if (ann.type === "underline" || ann.type === "highlight") {
        const px = rectToPx(ann);
        const el = document.createElement("div");
        el.className = "pv-highlight";
        el.dataset.annId = ann.id;
        el.style.left = `${px.left}px`;
        el.style.top = `${px.top}px`;
        el.style.width = `${px.width}px`;
        el.style.height = `${px.height}px`;
        el.title = "클릭하면 삭제";
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          deleteAnnotationById(ann.id);
        });
        annotationLayer.appendChild(el);
      } else if (ann.type === "memo") {
        const px = pointToPx({ x: ann.left, y: ann.top });
        const el = document.createElement("button");
        el.type = "button";
        el.className = "pv-memo-pin";
        el.dataset.annId = ann.id;
        el.style.left = `${px.x}px`;
        el.style.top = `${px.y}px`;
        el.textContent = "M";
        el.dataset.preview = ann.note || "";
        el.title = `${ann.note || "메모"} (클릭하면 삭제)`;
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          deleteAnnotationById(ann.id);
        });
        annotationLayer.appendChild(el);
      }
    }
  }

  function layerCoords(event) {
    const { left, top } = getDisplayMetrics();
    return {
      x: event.clientX - left,
      y: event.clientY - top
    };
  }

  function pointsToPathDFromPx(points) {
    if (!points.length) return "";
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i += 1) {
      d += ` L ${points[i].x} ${points[i].y}`;
    }
    return d;
  }

  function startLivePen(points) {
    syncAnnotationOverlay();
    if (livePenPath) livePenPath.remove();
    livePenPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    livePenPath.setAttribute("fill", "none");
    livePenPath.setAttribute("class", "pv-highlighter-live");
    livePenPath.setAttribute("stroke-width", String(HIGHLIGHT_WIDTH));
    livePenPath.setAttribute("d", pointsToPathDFromPx(points));
    annotationSvg.appendChild(livePenPath);
  }

  function updateLivePen(points) {
    if (!livePenPath) return;
    syncAnnotationOverlay();
    livePenPath.setAttribute("d", pointsToPathDFromPx(points));
  }

  function clearLivePen() {
    if (livePenPath) {
      livePenPath.remove();
      livePenPath = null;
    }
  }

  function onLayerPointerDown(event) {
    if (event.button !== 0) return;
    if (event.target.closest("[data-ann-id]")) return;

    if (currentTool === "pen") {
      syncAnnotationOverlay();
      const { x, y } = layerCoords(event);
      penState = { points: [{ x, y }] };
      startLivePen(penState.points);
      event.preventDefault();
      return;
    }
    if (currentTool === "memo") {
      const { x, y } = layerCoords(event);
      const n = normPoint(x, y);
      openMemoPanel({
        page: currentPage,
        left: n.x,
        top: n.y,
        note: ""
      });
      event.preventDefault();
    }
  }

  function onLayerPointerMove(event) {
    if (!penState) return;
    const { x, y } = layerCoords(event);
    const last = penState.points[penState.points.length - 1];
    if (Math.hypot(x - last.x, y - last.y) < 1.5) return;
    penState.points.push({ x, y });
    updateLivePen(penState.points);
  }

  function onLayerPointerUp() {
    if (!penState) return;
    clearLivePen();
    if (penState.points.length < 2) {
      penState = null;
      return;
    }
    const normalized = penState.points.map((p) => normPoint(p.x, p.y));
    getPageAnnotations(currentPage).push({
      id: createId("p"),
      type: "pen",
      points: normalized,
      strokeWidth: HIGHLIGHT_WIDTH,
      createdAt: new Date().toISOString()
    });
    penState = null;
    persistState();
    renderAnnotations();
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
  }

  async function goToPage(delta) {
    const next = currentPage + delta;
    if (next < 1 || next > totalPages) return;
    currentPage = next;
    await renderPage().catch((e) => showErr(e));
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

  toolPen?.addEventListener("click", () => setTool("pen"));
  toolMemo?.addEventListener("click", () => setTool("memo"));
  deleteAllBtn?.addEventListener("click", deleteAllAnnotations);
  memoSaveBtn?.addEventListener("click", saveMemoFromPanel);
  memoCancelBtn?.addEventListener("click", closeMemoPanel);

  annotationLayer.addEventListener("mousedown", onLayerPointerDown);
  window.addEventListener("mousemove", onLayerPointerMove);
  window.addEventListener("mouseup", onLayerPointerUp);

  if (typeof ResizeObserver !== "undefined") {
    const overlayResizeObserver = new ResizeObserver(() => {
      if (!pdfDoc) return;
      syncAnnotationOverlay();
      if (!penState) renderAnnotations();
    });
    overlayResizeObserver.observe(pdfCanvas);
  } else {
    window.addEventListener("resize", () => {
      if (!pdfDoc) return;
      syncAnnotationOverlay();
      if (!penState) renderAnnotations();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (isTypingTarget(document.activeElement)) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      goToPage(-1);
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      goToPage(1);
    }
  });

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
    closeMemoPanel();
    clearLivePen();
    penState = null;
    const page = await pdfDoc.getPage(currentPage);
    const baseScale = 1.35;
    const baseViewport = page.getViewport({ scale: baseScale });
    const maxWidth = Math.max(280, pdfScroll.clientWidth - 32);
    const fitScale = Math.min(1, maxWidth / baseViewport.width);
    const displayWidth = baseViewport.width * fitScale;
    const displayHeight = baseViewport.height * fitScale;
    const viewport = page.getViewport({ scale: baseScale * fitScale });
    const dpr = window.devicePixelRatio || 1;
    const ctx = pdfCanvas.getContext("2d");
    pdfCanvas.width = Math.floor(displayWidth * dpr);
    pdfCanvas.height = Math.floor(displayHeight * dpr);
    pdfCanvas.style.width = `${displayWidth}px`;
    pdfCanvas.style.height = `${displayHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    await page.render({ canvasContext: ctx, viewport }).promise;
    pageLabel.textContent = `${currentPage} / ${totalPages}`;
    persistState();
    pdfScroll.scrollTop = 0;
    requestAnimationFrame(() => {
      syncAnnotationOverlay();
      renderAnnotations();
    });
  }

  prevPage.addEventListener("click", () => goToPage(-1));
  nextPage.addEventListener("click", () => goToPage(1));

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
      setTool("pen");
      await renderPage();
    })
    .catch((err) => showErr(err));
})();
