import { generateReadingAnchorWithAI } from "@/lib/generate-reading-anchor.js";

export const runtime = "nodejs";

function isValidHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const url = String(body?.url || "").trim();
  const title = String(body?.title || "").trim();
  const ogTitle = String(body?.ogTitle || body?.title || "").trim();
  const description = String(body?.description || "").trim();
  const categoryName = String(body?.categoryName || "").trim();
  const sourceName = String(body?.sourceName || "").trim();

  if (url && !isValidHttpUrl(url)) {
    return Response.json({ error: "Valid http(s) url is required when url is provided" }, { status: 400 });
  }

  const result = await generateReadingAnchorWithAI({
    url,
    title,
    ogTitle,
    description,
    categoryName,
    sourceName
  });

  return Response.json({
    anchor: result.anchor,
    source: result.source
  });
}
