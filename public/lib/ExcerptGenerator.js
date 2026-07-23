export function generateExcerptFromText(text) {
  const line = String(text || "")
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .find((l) => l.length >= 8);
  return line ? line.slice(0, 120) : "";
}
