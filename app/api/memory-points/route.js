import { generateMemoryPointsWithAI } from "@/lib/generate-memory-points.js";

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
  if (url && !isValidHttpUrl(url)) {
    return Response.json({ error: "Valid http(s) url is required when url is provided" }, { status: 400 });
  }

  const result = await generateMemoryPointsWithAI({
    url,
    title: String(body?.title || "").trim(),
    ogTitle: String(body?.ogTitle || body?.title || "").trim(),
    description: String(body?.description || "").trim(),
    sourceName: String(body?.sourceName || "").trim()
  });

  return Response.json({
    points: result.points,
    tags: result.points,
    source: result.source
  });
}
