import { runOcr } from "./ocrService.js";

export async function processSnapshotKeyword({ screenshot, ocrText, title, url }) {
  const res = await fetch("/api/snapshot/process", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ screenshot, ocrText, title, url })
  });
  if (!res.ok) throw new Error("snapshot process failed");
  return res.json();
}
