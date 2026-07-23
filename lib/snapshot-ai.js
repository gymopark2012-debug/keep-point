import { generateKeywordsFromText } from "./keyword-generator.js";

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

export async function extractKeywordFromOcr({ ocrText, title, url, heuristicKeyword }) {
  const fallback =
    heuristicKeyword ||
    generateKeywordsFromText(ocrText, { max: 1 })[0] ||
    String(title || "").replace(/\s*[|\-–—:].*$/, "").trim().slice(0, 16) ||
    "";

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !String(ocrText || "").trim()) {
    return { keyword: fallback.slice(0, 16), source: "heuristic" };
  }

  const prompt = [
    "스크린샷 OCR 텍스트에서 '읽던 순간'을 떠올릴 대표 키워드 1개만 고르세요.",
    "요약·분석·문장 생성·excerpt는 하지 마세요.",
    'JSON만 출력: { "keyword": "2~16자" }',
    "",
    `페이지 제목(참고): ${title || "없음"}`,
    `URL(참고): ${url || "없음"}`,
    "",
    "OCR 텍스트:",
    String(ocrText).slice(0, 4000)
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
        max_tokens: 60,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!res.ok) throw new Error("ai failed");
    const data = await res.json();
    const parsed = parseJsonObject(data?.choices?.[0]?.message?.content);
    const keyword = String(parsed?.keyword || fallback || "").trim().slice(0, 16);
    return { keyword: keyword || fallback.slice(0, 16), source: "ai" };
  } catch {
    return { keyword: fallback.slice(0, 16), source: "heuristic" };
  }
}
