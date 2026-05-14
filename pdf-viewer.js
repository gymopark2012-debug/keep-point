(() => {
  const PDF_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const params = new URLSearchParams(window.location.search);
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
  const pdfSrc = pdfUrlParam ? new URL(pdfUrlParam, window.location.href).href : "";
  const storageKey = () => `keepPoint_pdf_reading_${encodeURIComponent(pdfUrlParam || pdfSrc)}`;

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

  function loadSavedPageNumber() {
    if (isRestart) {
      localStorage.removeItem(storageKey());
      return 1;
    }
    try {
      const raw = localStorage.getItem(storageKey());
      if (!raw) return 1;
      const o = JSON.parse(raw);
      return Math.max(1, Number.parseInt(String(o.pageNumber), 10) || 1);
    } catch {
      return 1;
    }
  }

  function persistPageNumber(pageNumber) {
    localStorage.setItem(storageKey(), JSON.stringify({ url: pdfUrlParam, pageNumber }));
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

  if (!pdfUrlParam || !isPdfPath(pdfUrlParam)) {
    showErr(new Error("PDF가 필요합니다. 예: pdf-viewer.html?url=sample.pdf"));
    return;
  }

  sourceLink.href = pdfSrc;
  sourceLink.textContent = pdfUrlParam;

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
      docTitle.textContent = "PDF";
      try {
        const meta = await doc.getMetadata();
        const t = meta?.info?.Title;
        if (t && String(t).trim()) docTitle.textContent = String(t).trim();
      } catch {
        /* ignore */
      }
      currentPage = Math.min(Math.max(1, currentPage), totalPages);
      await renderPage();
    })
    .catch((err) => showErr(err));
})();
