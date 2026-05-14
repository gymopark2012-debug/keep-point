# KeepPoint Chrome Extension (MVP)

일반 웹페이지(`http` / `https`)에서 스크롤·텍스트 선택을 감지해 `chrome.storage.local`에 읽기 위치를 저장하고, 같은 URL로 다시 들어오면 복원을 시도합니다.

## 설치 방법

1. Chrome에서 `chrome://extensions` 를 엽니다.
2. 우측 상단 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 누릅니다.
4. 이 폴더(`extension`)를 선택합니다.

## 동작 요약

- **스크롤**: 최대 약 1초에 한 번 `scrollY`, `scrollPercent`, `centerText` 저장
- **선택**: `mouseup` 시 드래그한 문자열을 `selectedText`로 저장
- **복원**: 페이지 로드 후 짧은 지연 뒤 자동 시도  
  1) 저장된 `scrollY`가 0보다 크면 해당 위치로 스크롤  
  2) 아니면 `scrollPercent`  
  3) 아니면 `selectedText`로 텍스트 찾아 스크롤
- **버튼**: 화면 우하단 **KeepPoint: 지난번 위치로 이동** — 클릭 시 같은 순서로 다시 복원

## 저장 키

`keepPoint_ext_reading_` + `encodeURIComponent(전체 URL)`

## 한계 (의도된 MVP)

- SPA는 초기 렌더 전에 복원하면 실패할 수 있습니다. 버튼으로 다시 시도하세요.
- `chrome.storage`는 확장 전용입니다. KeepPoint 웹앱(`file://` 또는 로컬 서버)과 자동 동기화되지는 않으며, 이후 메시지 연동으로 확장할 수 있습니다.
