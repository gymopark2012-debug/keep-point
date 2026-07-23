import { extractTextFromOcrInput } from "../../../../lib/ocr-extract.js";
import { generateKeywordsFromText } from "../../../../lib/keyword-generator.js";
import { extractKeywordFromOcr } from "../../../../lib/snapshot-ai.js";
import { createReadingSnapshot, normalizeReadingSnapshot } from "../../../../lib/reading-snapshot.js";

export async function POST(request) {
  try {
    const body = await request.json();
    const linkId = String(body?.linkId || "");
    const url = String(body?.url || "");
    const title = String(body?.title || "");
    const screenshot = typeof body?.screenshot === "string" ? body.screenshot : "";
    const ocrTextInput = typeof body?.ocrText === "string" ? body.ocrText : "";

    if (!linkId && !url) {
      return Response.json({ error: "linkId or url required" }, { status: 400 });
    }

    const snapshot = normalizeReadingSnapshot(body?.snapshot, { id: linkId, url, title });
    snapshot.linkId = linkId || snapshot.linkId;
    snapshot.screenshotRef = linkId || snapshot.screenshotRef;
    snapshot.status = "processing";

    const { text: ocrText } = await extractTextFromOcrInput({ ocrText: ocrTextInput, screenshot });
    const heuristicKeyword = generateKeywordsFromText(ocrText, { max: 1 })[0] || "";
    const { keyword } = await extractKeywordFromOcr({ ocrText, title, url, heuristicKeyword });

    snapshot.keyword = keyword;
    snapshot.savedAt = new Date().toISOString();
    snapshot.status = "ready";

    return Response.json({ snapshot });
  } catch (err) {
    console.error("[moment/capture]", err);
    return Response.json({ error: "snapshot capture failed" }, { status: 500 });
  }
}
