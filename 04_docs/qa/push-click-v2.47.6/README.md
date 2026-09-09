# 열린 앱의 푸시 클릭 보완 — v2.47.6

- 실기기 범위 정정: iOS 27.0 홈 화면 앱 v2.47.5에서 앱 완전 종료 후 클릭(run34320470116)은 전체 팝업 성공. 백그라운드 상태 클릭(run34320642460)은 이전 화면 그대로여서 실패했다. 두 결과를 구분한다.
- native navigate를 hash-only URL에서 `/?push_notification=<id>`로 변경한다. 앱이 새 문서 주소로 인식하게 하고, 초기 진입/복귀 시 검증 후 기존 알림 상세 hash로 한 번만 정규화한다. 기존 Android/구형 브라우저용 notificationclick과 data.url은 유지한다.
- 복귀 때 실제 알림 hash와 React Router 상태가 다른 경우에만 맞춘다. Chrome의 정상 hash 이벤트뿐 아니라 URL만 변경되고 이벤트가 누락된 경계도 재현한다.
- 근거: [다른 PWA 개발팀의 iOS query/hash 분리 구현 기록](https://github.com/lucidos-dev/lucidos/blob/main/docs/adr/0048-deep-links-are-https-into-the-engines-url-space.md), [WebKit native navigate 클릭 분기](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/API/Cocoa/WKWebsiteDataStore.mm#L1202). 사용자 기기의 내부 이벤트 로그는 없으므로 hash 무시를 확정 원인이라고 보고하지 않는다.

## 검증

- 관련 단위 74개(pushNavigation44 + RouterSync10 + NotificationsPage8 + SW12), lint error0, production build, design audit ERROR0/WARN0 통과.
- 실제 빌드 SW·격리 Chrome·외부 API fixture, localhost:5180에서 query URL 시작→상세 팝업→query 소비, 구 pending 우선순위, 닫기 후 재시작을 검수했다.
- 이미 열린 앱에 `history.replaceState`로 알림 hash 또는 native query만 반영해 popstate/hashchange를 발생시키지 않은 뒤 focus 복귀했을 때 해당 팝업이 열리는 것을 확인했다. 기존 cold/warm fallback·지연 기록·재클릭·로그인 복구도 통과했다.
- 모바일320×640 긴 본문 스크롤/마지막 닫기 접근 가능, 가로 넘침 없음, 앱 오류0. 캡처 mobile-dialog/desktop-dialog/mobile-inbox/mobile-long-bottom.png, 재현 스크립트 `02_devtools/qa-push-click.mjs`.
- 운영 서버 데이터/구독 변경 없이 기존 PWA 범위에서 보완했다. 브라우저 검수는 iOS OS 네이티브 동작을 대신하지 않으며, 실제 iOS의 백그라운드 푸시 클릭 성공 여부는 별도 확인이 필요하다.
