const MAX_KEYWORDS = 5;

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "are",
  "was",
  "were",
  "have",
  "has",
  "had",
  "not",
  "but",
  "you",
  "your",
  "our",
  "their",
  "they",
  "them",
  "will",
  "can",
  "may",
  "about",
  "into",
  "over",
  "more",
  "also",
  "just",
  "like",
  "when",
  "what",
  "where",
  "which",
  "who",
  "how",
  "why",
  "및",
  "에서",
  "으로",
  "하는",
  "했다",
  "한다",
  "있는",
  "없는",
  "것은",
  "것을",
  "대한",
  "위한",
  "통해",
  "때문",
  "그리고",
  "하지만",
  "또한",
  "이번",
  "오늘",
  "어제",
  "내일"
]);

function tokenize(text) {
  return String(text || "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function isUsefulToken(token) {
  if (!token || token.length < 2 || token.length > 20) return false;
  if (/^\d+$/.test(token)) return false;
  if (STOP_WORDS.has(token.toLowerCase())) return false;
  return true;
}

export function generateKeywordsFromText(text, { max = MAX_KEYWORDS } = {}) {
  const lines = String(text || "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const freq = new Map();
  for (const line of lines) {
    for (const token of tokenize(line)) {
      if (!isUsefulToken(token)) continue;
      const key = token.toLowerCase();
      freq.set(key, (freq.get(key) || 0) + 1);
    }
  }

  const ranked = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([key]) => {
      for (const line of lines) {
        for (const token of tokenize(line)) {
          if (token.toLowerCase() === key) return token;
        }
      }
      return key;
    });

  const unique = [];
  const seen = new Set();
  for (const word of ranked) {
    const norm = word.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    unique.push(word.slice(0, 16));
    if (unique.length >= max) break;
  }

  if (unique.length === 0 && lines[0]) {
    unique.push(lines[0].slice(0, 16));
  }

  return unique;
}
