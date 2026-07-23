import { fetchLinkMeta } from "@/lib/fetch-link-meta.js";

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
  if (!url || !isValidHttpUrl(url)) {
    return Response.json({ error: "Valid http(s) url is required" }, { status: 400 });
  }

  const result = await fetchLinkMeta(url);
  return Response.json(result);
}
