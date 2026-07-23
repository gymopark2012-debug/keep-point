export async function generateMomentFromApi({ linkId, url, title, siteName, description, ogImage }) {
  const res = await fetch("/api/moment/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ linkId, url, title, siteName, description, ogImage })
  });
  if (!res.ok) throw new Error("moment generate failed");
  return res.json();
}

export async function captureMomentFromApi(payload) {
  const res = await fetch("/api/moment/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("moment capture failed");
  return res.json();
}

export async function enrichMomentFromScreenshot({ link, dataUrl, ocrText }) {
  const res = await fetch("/api/snapshot/process", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      screenshot: ocrText ? "" : dataUrl,
      ocrText,
      title: link.title,
      url: link.originalUrl || link.url
    })
  });
  if (!res.ok) throw new Error("screenshot enrich failed");
  return res.json();
}
