import { buildMomentPayload } from "../../../../lib/moment-generate.js";

export async function POST(request) {
  try {
    const body = await request.json();
    const url = String(body?.url || "").trim();
    if (!url) {
      return Response.json({ error: "url required" }, { status: 400 });
    }

    const moment = await buildMomentPayload({
      linkId: String(body?.linkId || ""),
      url,
      title: String(body?.title || ""),
      siteName: String(body?.siteName || ""),
      description: String(body?.description || ""),
      ogImage: String(body?.ogImage || "")
    });

    return Response.json({ moment });
  } catch (err) {
    console.error("[moment/generate]", err);
    return Response.json({ error: "moment generate failed" }, { status: 500 });
  }
}
