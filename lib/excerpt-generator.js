function cleanLine(line) {
  return String(line || "")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreLine(line) {
  const len = line.length;
  if (len < 8) return 0;
  if (len > 120) return 0.3;
  if (/^[\d\s\-–—|·•]+$/.test(line)) return 0;
  if (/^(http|www\.)/i.test(line)) return 0.1;
  return Math.min(1, len / 60);
}

export function generateExcerptFromText(text) {
  const lines = String(text || "")
    .split(/\n+/)
    .map(cleanLine)
    .filter(Boolean);

  if (!lines.length) return "";

  let best = lines[0];
  let bestScore = scoreLine(best);

  for (const line of lines.slice(1, 24)) {
    const score = scoreLine(line);
    if (score > bestScore) {
      best = line;
      bestScore = score;
    }
  }

  return best.slice(0, 120);
}
