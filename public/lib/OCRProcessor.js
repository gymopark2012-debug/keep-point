let tesseractModulePromise = null;

async function loadTesseract() {
  if (!tesseractModulePromise) {
    tesseractModulePromise = import("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js");
  }
  return tesseractModulePromise;
}

export async function extractTextFromImage(dataUrl) {
  const src = String(dataUrl || "").trim();
  if (!src) return "";

  try {
    const mod = await loadTesseract();
    const Tesseract = mod.default || mod;
    const { data } = await Tesseract.recognize(src, "kor+eng", {
      logger: () => {}
    });
    return String(data?.text || "").trim();
  } catch (err) {
    console.warn("[OCRProcessor]", err);
    return "";
  }
}
