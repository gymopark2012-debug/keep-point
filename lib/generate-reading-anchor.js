const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";
const MIN_LEN = 8;
const MAX_LEN = 22;

const NOISE_TITLE_RE =
  /^(home|homepage|공식|홈|메인|untitled|new tab|로그인|sign in|welcome)$/i;

const STOP_PATH_SEGMENTS = new Set([
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

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s*[|·•]\s*.*$/, "")
    .replace(/\s+[-–—]\s+[^-–—]{2,40}$/, "")
    .trim();
}

function clampAnchor(text) {
  let value = cleanText(text)
    .replace(/^["'「『]|["'」』]$/g, "")
    .replace(/[.。!?？]+$/g, "")
    .trim();
  if (!value) return "";
  if (value.length > MAX_LEN) {
    const cut = value.slice(0, MAX_LEN);
    const boundary = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("/"), cut.lastIndexOf("-"));
    value = (boundary >= MIN_LEN ? cut.slice(0, boundary) : cut).trim();
  }
  return value;
}

function isWeakAnchor(text) {
  const value = cleanText(text);
  if (!value || value.length < 4) return true;
  if (NOISE_TITLE_RE.test(value)) return true;
  if (/^(새 링크|링크|문서|페이지|자료)$/i.test(value)) return true;
  return false;
}

function decodePathSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function meaningfulPathBits(url) {
  try {
    const u = new URL(url);
    return u.pathname
      .split("/")
      .map((part) => decodePathSegment(part))
      .map((part) => part.replace(/[-_]+/g, " ").trim())
      .filter((part) => part && !STOP_PATH_SEGMENTS.has(part.toLowerCase()) && !/^\d+$/.test(part))
      .filter((part) => /[\p{L}\p{N}]/u.test(part))
      .slice(-3);
  } catch {
    return [];
  }
}

function pickPhraseFromDescription(description) {
  const raw = cleanText(description);
  if (!raw) return "";
  const first = raw.split(/[.。!?\n]/)[0] || raw;
  const words = first.split(/\s+/).filter(Boolean);
  if (words.length <= 4) return clampAnchor(first);
  return clampAnchor(words.slice(0, 4).join(" "));
}

function withPurposeVerb(seed, categoryName) {
  const base = clampAnchor(seed);
  if (!base) return "";
  if (/(확인|이해|비교|참고|정리|검토|조사|찾기|검색)$/.test(base)) return base;
  if (base.length >= MAX_LEN - 2) return base;

  const cat = String(categoryName || "");
  const lower = base.toLowerCase();
  let verb = "확인";
  if (/가격|요금|비용|규제|대출|금리|시세|price|pricing|cost|fee|rate/.test(lower)) {
    verb = "확인";
  } else if (/비교|vs|versus|차이|compare|comparison/.test(lower)) {
    verb = "비교";
  } else if (/색|컬러|디자인|스타일|사진|이미지|color|colour|palette/.test(lower)) {
    verb = "참고";
  } else if (
    /과제|공부|학습|개념/.test(cat) ||
    /개념|원리|이란|뜻|suspense|hook|tutorial|guide|learn/.test(lower)
  ) {
    verb = "이해";
  }

  // Prefer compact noun phrase: drop leading English filler verbs.
  const trimmed = base.replace(/^(check|learn|read|see|view|how to)\s+/i, "").trim() || base;
  const candidate = clampAnchor(`${trimmed} ${verb}`);
  return candidate.length >= MIN_LEN ? candidate : clampAnchor(trimmed);
}

/**
 * Generate a short Reading Anchor: why the user saved this link.
 * Uses only URL / title / description / category — never invents page body content.
 */
export function generateReadingAnchor({
  url = "",
  title = "",
  ogTitle = "",
  description = "",
  categoryName = "",
  sourceName = ""
} = {}) {
  const titleText = cleanText(ogTitle || title);
  const descPhrase = pickPhraseFromDescription(description);
  const pathBits = meaningfulPathBits(url);
  const pathSeed = pathBits.length ? clampAnchor(pathBits.join(" ")) : "";

  let seed = "";
  if (titleText && !isWeakAnchor(titleText)) seed = titleText;
  else if (descPhrase && !isWeakAnchor(descPhrase)) seed = descPhrase;
  else if (pathSeed && !isWeakAnchor(pathSeed)) seed = pathSeed;
  else if (sourceName) seed = `${cleanText(sourceName)} 자료`;
  else seed = "저장한 자료";

  // Prefer concrete noun phrases from title; append purpose verb when short.
  let anchor = withPurposeVerb(seed, categoryName);
  if (isWeakAnchor(anchor) && descPhrase) anchor = withPurposeVerb(descPhrase, categoryName);
  if (isWeakAnchor(anchor) && pathSeed) anchor = withPurposeVerb(pathSeed, categoryName);

  anchor = clampAnchor(anchor);
  if (anchor.length > MAX_LEN) anchor = clampAnchor(anchor.slice(0, MAX_LEN));
  if (anchor.length < 4) anchor = clampAnchor(titleText || sourceName || "저장한 자료");
  return anchor;
}

function extractJsonString(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") return parsed;
    if (parsed && typeof parsed.anchor === "string") return parsed.anchor;
  } catch {
    const match = text.match(/"([^"]{4,40})"/);
    if (match) return match[1];
  }
  return text.replace(/^["']|["']$/g, "");
}

export async function generateReadingAnchorWithAI(input = {}) {
  const fallback = generateReadingAnchor(input);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { anchor: fallback, source: "heuristic" };

  const prompt = [
    "당신은 사용자가 링크를 저장한 '읽기 목적'을 한 줄로 적습니다.",
    "문서 내용을 요약하거나 추측하지 마세요.",
    "알 수 있는 것은 URL·제목·description·카테고리뿐입니다.",
    "",
    "규칙:",
    `- 한국어 한 줄, ${MIN_LEN}~${MAX_LEN}자`,
    "- '~확인', '~이해', '~비교', '~참고'처럼 짧은 목적형",
    "- 본문 내용·핵심 주장·앞부분/결론 언급 금지",
    "- JSON만 출력: {\"anchor\":\"...\"}",
    "",
    `URL: ${input.url || ""}`,
    `제목: ${input.title || ""}`,
    `OG 제목: ${input.ogTitle || ""}`,
    `description: ${String(input.description || "").slice(0, 240)}`,
    `카테고리: ${input.categoryName || ""}`,
    `사이트: ${input.sourceName || ""}`,
    "",
    "예: {\"anchor\":\"GPT-6 API 가격 확인\"}"
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
        max_tokens: 80,
        messages: [{ role: "user", content: prompt }]
      })
    });
    if (!res.ok) return { anchor: fallback, source: "heuristic" };
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    const anchor = clampAnchor(extractJsonString(raw));
    if (!anchor || isWeakAnchor(anchor)) return { anchor: fallback, source: "heuristic" };
    return { anchor, source: "ai" };
  } catch {
    return { anchor: fallback, source: "heuristic" };
  }
}
