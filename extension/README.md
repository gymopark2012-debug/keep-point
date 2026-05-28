# KeepPoint Chrome Extension (Manifest V3)

모든 `http` / `https` 페이지에서 `content.js`가 실행되어 읽기 위치를 `chrome.storage.local`에 저장하고, 같은 URL로 다시 들어오면 복원합니다.

## 설치 방법

1. Chrome에서 `chrome://extensions` 를 엽니다.
2. 우측 상단 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 누릅니다.
4. 이 폴더(`extension`)를 선택합니다.

## 저장 필드

| 필드 | 설명 |
|------|------|
| `url` | 전체 URL |
| `title` | `document.title` |
| `scrollY` | 세로 스크롤 픽셀 |
| `scrollPercent` | 문서 높이 대비 스크롤 비율(%) |
| `selectedText` | 사용자가 드래그해 선택한 문자열(최근 값 유지) |
| `centerText` | 뷰포트 중앙 근처에서 샘플링한 짧은 텍스트 |
| `updatedAt` | ISO 시각 |

## 동작

- **스크롤**: 이벤트마다 즉시 저장하지 않고, **최소 1초 간격**으로 위 필드를 묶어 저장합니다.
- **선택**: `selectionchange` / `mouseup` 후 짧게 디바운스하여, 선택 문자열이 있으면 `selectedText`를 갱신해 저장합니다.
- **복원**(페이지 로드 후 여러 시점에 시도):  
  1. `selectedText`로 위치 찾기(`window.find` + `scrollIntoView`)  
  2. 실패 시 `scrollY`  
  3. 실패 시 `scrollPercent`
- **버튼**: 우측 하단 **KeepPoint 마지막 위치로 이동** — 클릭 시 위와 같은 순서로 다시 복원합니다.

## 저장 키

`keepPoint_ext_reading_` + `encodeURIComponent(전체 URL)`

## 한계

- SPA·지연 로딩 페이지는 첫 복원이 빗나갈 수 있어, 여러 번 재시도합니다. 그래도 안 되면 FAB으로 다시 시도하세요.
- `chrome.storage`는 확장 전용입니다. KeepPoint 웹앱과는 별도 저장소입니다.
