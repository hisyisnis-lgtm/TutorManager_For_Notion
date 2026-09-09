# ntfy 코드 입력·알림함 연결 복원

- 대상: 설정(`/settings`), 알림함(`/notifications`), ntfy 설정 저장·인증 만료 시 정리.
- 상태: 로컬 구현·검수 완료, **PWA v2.47.11 배포 대상**. Worker 변경·배포 없이 ntfy 코드 입력과 알림함 연결을 복원함.
- 제거 원인: Web Push 도입 전 보안 커밋 `d094e9c`가 ntfy 토픽 코드 입력란을 제거해 Web Push 커밋 원복에 포함되지 않았음.
- 기존 토픽 코드 입력 방식 복원. 코드만 저장하며 ntfy API 토큰이나 앱 JWT를 ntfy에 전송하지 않음. 공개 읽기가 가능한 토픽 대상.
- 저장 코드는 재실행 후 유지, 로그아웃·인증 만료 시 삭제. 알림 본문은 세션 저장소에서 토픽별로 분리하며 코드 변경·해제 시 비움.
- 최근 24시간 이력·SSE 구독, 중복 제거, 줄바꿈 유지. 백그라운드 복귀 시 이력 재조회. 휴대폰 푸시는 ntfy 앱의 기존 구독 기능이며 Web Push를 재도입하지 않음.

## 검증

- 관련 Vitest **31/31 통과**: 설정 7, 알림함 10, ntfy 설정 6, 인증 8.
- PWA 빌드 통과. 기존 큰 번들·단어 중복 경고는 이번 변경과 무관.
- 변경 파일 ESLint 통과. design-audit **ERROR 0 / WARN 0**, 기존 REVIEW 99.
- Chrome 실제 로컬 빌드 `http://127.0.0.1:5180`, 모바일 390×844·데스크톱 1280×900 검수.
- 입력 오류/저장/새로고침 후 코드 유지/알림함 이동/실시간 도착/줄바꿈/긴 본문 가로 넘침 없음/연결 해제/페이지 JS 오류 없음 확인.
- API·ntfy는 **격리된 fixture**로 대체. 운영 토픽 연결이나 실제 휴대폰 수신을 검증했다고 주장하지 않음. 실제 알림 발송 **0회**.
- 관련 7개 소스·테스트 파일만 공유 루트로 동기화. 게임·기타 작업은 변경하지 않음. 배포 버전은 v2.47.11.

실행: 레포 루트에서 `node 04_docs/qa/ntfy-code-restore-2026-09-09/verify.mjs` (해당 PC의 Chrome/Playwright 경로 사용).

증거: `mobile-settings.png`, `mobile-settings-error.png`, `desktop-settings.png`, `mobile-notifications.png`, `desktop-notifications.png`, `mobile-disconnected.png`.
