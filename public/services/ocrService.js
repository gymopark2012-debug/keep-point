import { extractTextFromImage } from "../lib/OCRProcessor.js";

export async function runOcr(dataUrl) {
  return extractTextFromImage(dataUrl);
}
