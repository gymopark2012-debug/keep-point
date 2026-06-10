# KeepPoint

링크·PDF를 카테고리별로 저장하고, **내부 Reader**에서 이어 읽는 앱입니다.

## 실행 방법 (Next.js)

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000` 을 엽니다.

- **웹 링크 본문 추출**: 서버 API `POST /api/extract` (cheerio, CORS 없음)
- **Reader**: `/reader/[링크ID]`
- **정적 UI**: `public/` (index.html, app.js, reader 등)

## API

```http
POST /api/extract
Content-Type: application/json

{ "url": "https://example.com/article" }
```

응답:

```json
{
  "originalUrl": "https://example.com/article",
  "title": "제목",
  "content": "<p id=\"kp-p-0\">...</p>",
  "status": "ready"
}
```

`status`가 `failed`이면 앱에서 「본문 추출 실패, 직접 붙여넣기 필요」가 표시됩니다.

## 포함 기능

- 카테고리·링크 목록, 메모
- **웹**: 서버 추출 → KeepPoint Reader에서 읽기 + 스크롤 위치 저장
- **PDF**: `pdf-viewer.html` (PDF.js)
- Chrome 확장 (`extension/`)

## 레거시 (API 없이 정적만)

```bash
npm run legacy:static
```

※ 이 모드에서는 `/api/extract`가 없어 **본문 자동 추출이 동작하지 않습니다.**
