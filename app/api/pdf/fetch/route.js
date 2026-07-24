const FETCH_TIMEOUT_MS = 20000;
const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; KeepPoint/1.0; +https://keeppoint.app)",
  Accept: "application/pdf,*/*;q=0.8"
};

export const runtime = "nodejs";

function isValidHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export async function GET(request) {
  const url = new URL(request.url).searchParams.get("url")?.trim() || "";
  if (!url || !isValidHttpUrl(url)) {
    return Response.json({ error: "Valid http(s) url is required" }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: FETCH_HEADERS,
      redirect: "follow"
    });

    if (!res.ok) {
      return Response.json({ error: `PDF fetch failed (${res.status})` }, { status: 502 });
    }

    const contentType = String(res.headers.get("content-type") || "").toLowerCase();
    const path = url.split(/[?#]/)[0].toLowerCase();
    if (!path.endsWith(".pdf") && !contentType.includes("pdf")) {
      return Response.json({ error: "URL does not look like a PDF" }, { status: 400 });
    }

    const data = await res.arrayBuffer();
    if (!data || data.byteLength < 64) {
      return Response.json({ error: "PDF response was empty" }, { status: 502 });
    }

    return new Response(data, {
      status: 200,
      headers: {
        "Content-Type": contentType.includes("pdf") ? contentType : "application/pdf",
        "Cache-Control": "private, max-age=300"
      }
    });
  } catch (err) {
    console.error("[pdf/fetch]", err);
    return Response.json({ error: "PDF fetch failed" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
