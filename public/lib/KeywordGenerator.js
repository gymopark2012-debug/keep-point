export function generateKeywordsFromText(text, { max = 5 } = {}) {
  const lines = String(text || "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const words = lines.join(" ").split(/\s+/).filter((w) => w.length >= 2);
  const unique = [];
  const seen = new Set();
  for (const word of words) {
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(word.slice(0, 16));
    if (unique.length >= max) break;
  }
  return unique;
}
