const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";
const MAX_POINTS = 6;
const MIN_POINTS = 3;

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
  "home",
  "page",
  "blog",
  "news",
  "index",
  "lets",
  "until",
  "have",
  "been",
  "finished",
  "loading",
  "display",
  "fallback",
  "children",
  "including",
  "exterior",
  "palette",
  "color",
  "colours",
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
  "관련",
  "안내",
  "자료",
  "문서",
  "페이지",
  "내용",
  "소개",
  "다룹니다",
  "추진한",
  "정리한",
  "설명한",
  "위한",
  "대한",
  "있는",
  "없는",
  "하는",
  "된",
  "할",
  "한",
  "등"
]);

const STOP_PATH = new Set([
  "www",
  "com",
  "net",
  "org",
  "co",
  "kr",
  "en",
  "ko",
  "blog",
  "post",
  "posts",
  "article",
  "articles",
  "news",
  "page",
  "pages",
  "index",
  "view",
  "detail",
  "docs",
  "doc",
  "wiki",
  "tag",
  "tags",
  "category",
  "categories",
  "search",
  "id",
  "amp"
]);

export function normalizeMemoryTag(value) {
  let text = String(value || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}_-]/gu, "");
  // Strip common Korean particles glued to nouns.
  text = text.replace(/(의|을|를|이|가|은|는|과|와|도|로|으로|에서|부터|까지|만|께|에게)$/u, "");
  if (!text) return "";
  if (text.length > 16) text = text.slice(0, 16);
  if (text.length < 2) return "";
  if (/^\d+$/.test(text)) return "";
  if (STOP_WORDS.has(text.toLowerCase())) return "";
  return text;
}

function tokenize(text) {
  return String(text || "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .split(/[\s_/|-]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function pathTokens(url) {
  try {
    const u = new URL(url);
    return u.pathname
      .split("/")
      .map((part) => {
        try {
          return decodeURIComponent(part);
        } catch {
          return part;
        }
      })
      .flatMap((part) => tokenize(part.replace(/[-_]+/g, " ")))
      .filter((part) => part && !STOP_PATH.has(part.toLowerCase()));
  } catch {
    return [];
  }
}

function uniqueTags(tags, max = MAX_POINTS) {
  const out = [];
  const seen = new Set();
  for (const raw of tags) {
    const tag = normalizeMemoryTag(raw);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Recommend objective memory-point tags from available meta only.
 * Never invents document body content or user intent.
 */
export function generateMemoryPoints({
  url = "",
  title = "",
  ogTitle = "",
  description = "",
  sourceName = ""
} = {}) {
  const scored = new Map();

  const bump = (token, weight) => {
    const tag = normalizeMemoryTag(token);
    if (!tag) return;
    const key = tag.toLowerCase();
    const prev = scored.get(key);
    if (!prev || weight > prev.weight || (weight === prev.weight && tag.length > prev.tag.length)) {
      scored.set(key, { tag, weight });
    }
  };

  for (const token of tokenize(ogTitle || title)) bump(token, 5);
  for (const token of tokenize(title)) bump(token, 4);
  for (const token of tokenize(description).slice(0, 24)) bump(token, 3);
  for (const token of pathTokens(url)) bump(token, 2);
  if (sourceName) bump(sourceName.replace(/\./g, ""), 1);

  const ranked = [...scored.values()]
    .sort((a, b) => b.weight - a.weight || b.tag.length - a.tag.length)
    .map((row) => row.tag);

  let points = uniqueTags(ranked, MAX_POINTS);
  if (points.length < MIN_POINTS) {
    const fallback = uniqueTags(
      [...tokenize(ogTitle || title), ...tokenize(description), ...pathTokens(url)],
      MAX_POINTS
    );
    points = uniqueTags([...points, ...fallback], MAX_POINTS);
  }
  return points;
}

function extractJsonTags(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.tags)) return parsed.tags;
    if (Array.isArray(parsed?.points)) return parsed.points;
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const arr = JSON.parse(match[0]);
        if (Array.isArray(arr)) return arr;
      } catch {
        /* ignore */
      }
    }
  }
  return [];
}

export async function generateMemoryPointsWithAI(input = {}) {
  const fallback = generateMemoryPoints(input);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { points: fallback, source: "heuristic" };

  const prompt = [
    "당신은 웹 링크의 '기억 포인트'를 만듭니다.",
    "목적은 검색용 태그가 아니라, 다음에 다시 왔을 때 '아 맞다. 이 내용을 보려고 했었지.'를 떠올리게 하는 단서입니다.",
    "",
    "규칙:",
    "- 문서 본문을 요약·추측하지 마세요.",
    "- 사용자 의도(발표, 시험, 회사교육 등)를 추측하지 마세요.",
    "- 제목·URL·description·사이트명에 실제로 드러난 객관적 키워드만 사용하세요.",
    `- 링크마다 다른 ${MIN_POINTS}~${MAX_POINTS}개`,
    "- 각 태그는 2~12자, # 없이 문자열만",
    "- 고유명사·주제 키워드 우선 (예: 송나라, 왕안석, Suspense, 슬레이트그레이)",
    '- JSON만 출력: {"tags":["송나라","왕안석","신법","중국사"]}',
    "",
    `URL: ${input.url || ""}`,
    `제목: ${input.title || ""}`,
    `OG 제목: ${input.ogTitle || ""}`,
    `description: ${String(input.description || "").slice(0, 280)}`,
    `사이트: ${input.sourceName || ""}`
  ].join("\n");

  try {
    const res = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 160,
        messages: [{ role: "user", content: prompt }]
      })
    });
    if (!res.ok) return { points: fallback, source: "heuristic" };
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    const points = uniqueTags(extractJsonTags(raw), MAX_POINTS);
    if (points.length < MIN_POINTS) return { points: fallback, source: "heuristic" };
    return { points, source: "ai" };
  } catch {
    return { points: fallback, source: "heuristic" };
  }
}
