const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const VISION_MODEL = "gpt-4o-mini";

function stripDataUrlPrefix(dataUrl) {
  return String(dataUrl || "").replace(/^data:image\/\w+;base64,/, "");
}

async function extractWithVision(base64Image) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const imageData = stripDataUrlPrefix(base64Image);
  if (!imageData) return null;

  const res = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      temperature: 0,
      max_tokens: 1200,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "스크린샷에 보이는 글자를 OCR하세요. 요약·해석 없이 보이는 텍스트만 줄바꿈을 유지해 그대로 출력하세요."
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${imageData}`
              }
            }
          ]
        }
      ]
    })
  });

  if (!res.ok) return null;
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  return text || null;
}

async function extractWithTesseract() {
  return null;
}

export async function extractTextFromScreenshot(base64Image) {
  const fromTesseract = await extractWithTesseract(base64Image);
  if (fromTesseract) {
    return { text: fromTesseract, source: "tesseract" };
  }

  const fromVision = await extractWithVision(base64Image);
  if (fromVision) {
    return { text: fromVision, source: "openai-vision" };
  }

  return { text: "", source: "none" };
}

export async function extractTextFromOcrInput({ ocrText, screenshot }) {
  const direct = String(ocrText || "").trim();
  if (direct) {
    return { text: direct, source: "client-ocr" };
  }
  if (screenshot) {
    return extractTextFromScreenshot(screenshot);
  }
  return { text: "", source: "none" };
}
