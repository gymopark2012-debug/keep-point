import { analyzePage } from "../lib/analyze-page.js";

const html = `<!DOCTYPE html><html><head><title>고려의 멸망 - 위키</title><meta property="og:title" content="고려의 멸망과 그 이후"/></head><body><article><h1>고려의 멸망과 그 이후</h1><h2>건국과 전성기</h2><p>본문 내용입니다. 고려는 918년에 건국되었습니다.</p><h2>무신정권</h2><p>본문 내용입니다. 1170년 무신들이 정권을 장악했습니다.</p><h2>몽골 침입</h2><p>본문 내용입니다. 1231년 몽골군이 침입했습니다.</p><h2>멸망</h2><p>본문 내용입니다. 1392년 조선으로 대체되었습니다.</p></article></body></html>`;

const result = await analyzePage("https://example.com/goryeo", { html });

console.log(
  JSON.stringify(
    {
      title: result.title.text,
      method: result.method,
      structureMethod: result.meta.structureMethod,
      points: result.points,
      ok: result.ok
    },
    null,
    2
  )
);
