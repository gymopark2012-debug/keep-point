import { analyzePageFromFields } from "@/lib/analyze-page.js";
import { isValidHttpUrl } from "@/lib/fetch-page.js";

export const runtime = "nodejs";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const url = String(body?.url || "").trim();
  if (url && !isValidHttpUrl(url)) {
    return Response.json({ error: "Invalid URL" }, { status: 400 });
  }

  const result = await analyzePageFromFields(body);
  return Response.json(result);
}
