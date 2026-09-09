# 푸시 네이티브 이동 보완 — v2.47.5

- 실기기 결과: 사용자가 iOS 27.0 홈 화면 앱의 v2.47.4 표시를 확인한 후 최신 실제 브리핑(run `34318736585`)을 눌렀지만 앱만 열렸다고 보고했다. v2.47.4의 합성 클릭 검수 통과는 OS의 클릭 이벤트 전달을 증명하지 않는다.
- 변경: `showNotification`의 `navigate` 옵션에 같은 출처의 해당 알림 주소를 지정한다. 지원 브라우저는 클릭 이벤트 없이 직접 이동하고, 미지원 브라우저는 기존 `notificationclick`·보관/복구 처리를 유지한다. 서버 payload·구독·개인정보 접근 권한은 변경하지 않는다.
- 근거: [Notifications 표준](https://notifications.spec.whatwg.org/#activating-a-notification), [WebKit NotificationOptions](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/notifications/NotificationOptions.idl), [WebKit Notification 구현](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/notifications/Notification.cpp). [WebKit 268797](https://bugs.webkit.org/show_bug.cgi?id=268797#c35)에 유사한 이벤트 누락이 보고되어 있으나 사용자 기기의 원인으로 확정한 것은 아니다.
- 네이티브 주소에만 `via=push`를 붙여 이전 보관 클릭이 새 목적지를 덮지 않게 한다. 기존 이벤트의 `data.url`은 보존한다.

## 검증

- 관련 단위 테스트 52개, lint error 0, production build, design audit ERROR 0/WARN 0 통과.
- `02_devtools/qa-push-click.mjs`: 실제 빌드 SW + 격리 Chrome + 외부 API fixture. 클릭 이벤트를 발생시키지 않고 native 목적지 URL로 cold/warm 진입했을 때 해당 팝업 표시, 이전 pending이 다른 팝업을 덮지 않음, 닫고 새로고침 시 구 팝업 재열림 없음 확인.
- 기존 fallback의 cold/warm 전달 실패·지연 저장·같은 알림 재클릭·로그인 복구도 통과. 모바일 320×640 긴 본문 스크롤 가능, 가로 넘침 없음, 앱 JS 오류 0. 캡처는 같은 폴더의 mobile-dialog/desktop-dialog/mobile-inbox/mobile-long-bottom.png.
- 로컬 검수 주소 `http://localhost:5180`, 운영 API 요청은 모두 격리 fixture로 차단. 실제 iOS/Android OS의 알림 탭과 네이티브 이동 엔진을 검증한 것은 아니므로 실기기 성공 여부는 별도 사용자 확인이 필요하다.
