import Script from "next/script";

export const metadata = {
  title: "Reader · KeepPoint"
};

export default async function ReaderPage({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const restart = sp?.mode === "restart";

  return (
    <>
      <link rel="stylesheet" href="/reader.css" />
      <header className="reader-header">
        <button type="button" id="backBtn" className="btn ghost">
          ← 목록
        </button>
        <div className="reader-title-wrap">
          <h1 id="readerTitle">Reader</h1>
          <a id="originalLink" href="#" target="_blank" rel="noreferrer" className="reader-source">
            원본 보기
          </a>
        </div>
      </header>

      <main id="readerScroll" className="reader-scroll">
        <article id="readerArticle" className="reader-article" />
      </main>

      <aside id="readerEmpty" className="reader-empty hidden">
        <h2>본문이 없습니다</h2>
        <p id="readerEmptyText">본문 추출 실패, 직접 붙여넣기 필요</p>
        <button type="button" id="goDetailBtn" className="btn">
          목록에서 본문 붙여넣기
        </button>
        <button type="button" id="openOriginalBtn" className="btn ghost">
          원본 사이트 열기
        </button>
      </aside>

      <footer className="reader-footer">
        <span id="readerProgress">0%</span>
        <span id="readerSaveStatus">저장됨</span>
      </footer>

      <Script id="reader-boot" strategy="beforeInteractive">
        {`window.__KEEPPOINT_READER__ = { id: ${JSON.stringify(id)}, restart: ${restart ? "true" : "false"} };`}
      </Script>
      <Script src="/reader.js" strategy="afterInteractive" />
    </>
  );
}
