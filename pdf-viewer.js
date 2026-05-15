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
  const pdfError = document.getElementById("pdfError");

  const pdfUrlParam = rawUrl ? String(rawUrl).trim() : "";

  let pdfSrc = "";
  let localIdMode = false;
  let localMeta = null;
  let revokeOnHide = null;

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

  function loadSavedPageNumber() {
    if (isRestart) {
      localStorage.removeItem(getStorageKey());
      return 1;
    }
    try {
      const raw = localStorage.getItem(getStorageKey());
      if (!raw) return 1;
      const o = JSON.parse(raw);
      return Math.max(1, Number.parseInt(String(o.pageNumber), 10) || 1);
    } catch {
      return 1;
    }
  }

  function persistPageNumber(pageNumber) {
    const payload = {
      pageNumber,
      url: localIdMode ? null : pdfUrlParam,
      localId: localIdMode ? localId : null
    };
    localStorage.setItem(getStorageKey(), JSON.stringify(payload));
  }

  if (typeof pdfjsLib !== "undefined") {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
  }

  backBtn.addEventListener("click", () => {
    window.location.href = indexPageHref();
  });

  function showErr(err) {
    pdfError.classList.remove("hidden");
    pdfError.textContent = err && err.message ? String(err.message) : "PDF 로드 실패";
  }

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
        try {
          URL.revokeObjectURL(revokeOnHide);
        } catch {
          /* ignore */
        }
      },
      { once: true }
    );
  }

  if (localIdMode) {
    sourceLink.href = "#";
    sourceLink.textContent = localMeta?.fileName || "로컬 PDF";
    sourceLink.title = "이 기기에 저장된 PDF";
  } else {
    sourceLink.href = pdfSrc;
    sourceLink.textContent = pdfUrlParam;
    sourceLink.removeAttribute("download");
  }

  let currentPage = loadSavedPageNumber();
  let pdfDoc = null;
  let totalPages = 0;

  async function renderPage() {
    if (!pdfDoc) return;
    currentPage = Math.min(Math.max(1, currentPage), totalPages);
    const page = await pdfDoc.getPage(currentPage);
    const viewport = page.getViewport({ scale: 1.35 });
    const ctx = pdfCanvas.getContext("2d");
    pdfCanvas.height = viewport.height;
    pdfCanvas.width = viewport.width;
    await page.render({ canvasContext: ctx, viewport }).promise;
    pageLabel.textContent = `${currentPage} / ${totalPages}`;
    persistPageNumber(currentPage);
    pdfScroll.scrollTop = 0;
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
    } catch (e1) {
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
      await renderPage();
    })
    .catch((err) => showErr(err));
})();
