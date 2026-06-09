// 간편 로그인용 클라이언트 ID
// 1) 로컬 서버로 실행 (파일 더블클릭 X) → npx serve . 또는 python -m http.server 8080
// 2) Google / 네이버 개발자 콘솔에서 앱 등록 후 아래에 ID 입력
// 3) 앱 로그인 창 → 「간편 로그인이 안 되나요? 설정 방법」에서 등록할 주소 확인
window.KEEPPOINT_AUTH_CONFIG = {
  googleClientId: "",
  naverClientId: ""
};
