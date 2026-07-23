import { getMeaningfulSections } from "./analyze-sections.js";
import { anchorsToReadingPoints, fallbackMemoryAnchors } from "./fallback-memory-anchors.js";
import {
  MAX_POINTS,
  MIN_POINTS,
  clampLabel,
  isGenericReadingPoint,
  labelsFromPoints,
  validateReadingPoints
} from "./reading-point-quality.js";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

function pointsFromSections(sections) {
  const meaningful = getMeaningfulSections(sections);
  const points = [];

  for (const section of meaningful) {
    const label = clampLabel(section.title);
    if (!label || isGenericReadingPoint(label)) continue;
    if (points.some((p) => p.label.toLowerCase() === label.toLowerCase())) continue;
    points.push({
      id: `rp-${points.length}`,
      label,
      order: points.length,
      sectionId: section.id,
      source: "structure"
    });
  }

  return points.slice(0, MAX_POINTS);
}

async function aiReadingPointsFromParagraphs({ pageTitle, siteName, paragraphs }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !paragraphs?.length) return null;

  const excerpt = paragraphs
    .slice(0, 10)
    .map((p, i) => `${i + 1}. ${String(p).slice(0, 320)}`)
    .join("\n");

  const prompt = [
    "당신은 웹페이지를 분석해 '읽기 기억 포인트'만 만듭니다.",
    "요약·TL;DR·본문 재작성·Reader 역할은 하지 않습니다.",
    "목표: 사용자가 원본을 다시 열었을 때 '아 맞다.'라고 바로 떠올릴 단서.",
    "",
    "규칙:",
    `- ${MIN_POINTS}~${MAX_POINTS}개의 짧은 읽기 포인트를 JSON 문자열 배열로만 출력`,
    "- 각 포인트 2~16자, 사용자가 '아 맞다'라고 기억할 단어/구",
    "- 본문에 실제로 등장하는 주제·전환점을 반영",
    "- 금지: 시작, 중간, 끝, 전반부, 후반부, 마무리 같은 일반 구간명",
    "",
    `페이지 제목: ${pageTitle?.text || "없음"}`,
    `사이트: ${siteName || "없음"}`,
    "",
    "본문 발췌:",
    excerpt,
    "",
    '예: ["문제", "원인", "해결", "결과"]',
    "JSON 배열만 출력하세요."
  ].join("\n");

  const res = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.35,
      max_tokens: 280,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!res.ok) return null;
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content || "";
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return null;

    const points = [];
    for (const item of parsed) {
      const label = clampLabel(typeof item === "string" ? item : item?.label);
      if (!label || isGenericReadingPoint(label)) continue;
      if (points.some((p) => p.label.toLowerCase() === label.toLowerCase())) continue;
      points.push({
        id: `rp-${points.length}`,
        label,
        order: points.length,
        sectionId: "",
        source: "ai-paragraph"
      });
    }

    const validated = validateReadingPoints(points);
    return validated.ok ? validated.points : null;
  } catch {
    return null;
  }
}

export async function generateReadingPoints({
  pageTitle,
  siteName,
  sections,
  paragraphs,
  structureMethod,
  url,
  description
}) {
  const structurePoints = pointsFromSections(sections);
  if (structurePoints.length >= MIN_POINTS) {
    return {
      points: structurePoints,
      labels: labelsFromPoints(structurePoints),
      method: structureMethod || "structure",
      ok: true
    };
  }

  try {
    const aiPoints = await aiReadingPointsFromParagraphs({ pageTitle, siteName, paragraphs });
    if (aiPoints?.length >= MIN_POINTS) {
      return {
        points: aiPoints,
        labels: labelsFromPoints(aiPoints),
        method: "ai-semantic",
        ok: true
      };
    }
  } catch {
    /* fall through */
  }

  const anchorLabels = fallbackMemoryAnchors({
    pageTitle,
    url,
    description,
    siteName
  });
  if (anchorLabels.length >= MIN_POINTS) {
    const points = anchorsToReadingPoints(anchorLabels);
    return {
      points,
      labels: labelsFromPoints(points),
      method: "fallback-anchor",
      ok: true
    };
  }

  return {
    points: [],
    labels: [],
    method: "failed",
    ok: false
  };
}

export { MIN_POINTS, MAX_POINTS };
