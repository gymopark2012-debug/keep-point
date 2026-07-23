const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

function parseJsonObject(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export async function refineMomentFromMeta({
  title,
  url,
  siteName,
  description,
  heuristicKeyword,
  heuristicExcerpt
}) {
  const fallback = {
    keyword: heuristicKeyword,
    excerpt: heuristicExcerpt,
    source: "heuristic"
  };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallback;

  const prompt = [
    "당신은 'Reading Moment' 기억 단서를 만듭니다.",
    "사용자가 링크를 다시 열었을 때 3초 안에 '아 맞다, 여기였지'가 떠오를 단서만 만드세요.",
    "요약·TL;DR·본문 재작성은 하지 않습니다.",
    "",
    "출력 JSON:",
    '{ "keyword": "대표 키워드 1개 (2~16자)", "excerpt": "대표 문장 1줄 (120자 이내, 없으면 빈 문자열)" }',
    "",
    `페이지 제목: ${title || "없음"}`,
    `사이트: ${siteName || "없음"}`,
    `URL: ${url || "없음"}`,
    `설명: ${String(description || "").slice(0, 400) || "없음"}`
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
        temperature: 0.25,
        max_tokens: 180,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!res.ok) throw new Error("ai failed");
    const data = await res.json();
    const parsed = parseJsonObject(data?.choices?.[0]?.message?.content);
    if (!parsed) throw new Error("invalid json");

    const keyword = String(parsed.keyword || heuristicKeyword || "").trim().slice(0, 16);
    const excerpt = String(parsed.excerpt || heuristicExcerpt || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);

    return {
      keyword: keyword || heuristicKeyword,
      excerpt: excerpt || heuristicExcerpt,
      source: "ai"
    };
  } catch {
    return fallback;
  }
}
