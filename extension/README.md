# KeepPoint Chrome Extension (Manifest V3)

모든 `http` / `https` 페이지에서 `content.js`가 실행되어 우측 하단에 **Save to KeepPoint** 버튼을 표시합니다.

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
| `progressPercent` | 사용자가 입력한 읽은 퍼센트(선택) |
| `selectedText` | 사용자가 드래그한 텍스트(저장 시점) |
| `memo` | 저장 시 사용자가 입력한 메모 |
| `updatedAt` | ISO 시각 |

## 동작

- **자동 스크롤 추적/복원 없음**: 사용자가 직접 버튼을 눌러 저장합니다.
- **버튼**: 우측 하단 **Save to KeepPoint**
  - 클릭 시 메모/읽은 퍼센트를 입력받고
  - 현재 URL, 제목, 선택 텍스트와 함께 `chrome.storage.local`에 저장합니다.

## 저장 키

배열 키: `keepPoint_extension_clips`

## 한계

- `chrome.storage`는 확장 전용입니다. KeepPoint 웹앱과는 별도 저장소입니다.
