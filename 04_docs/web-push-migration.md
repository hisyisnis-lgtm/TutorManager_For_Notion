# 강사 알림 Web Push 전환

## 결과

강사용 비즈니스 알림(아침 브리핑, 내일 수업, 상담 신청, 숙제 제출, 수업 충돌, 수납 오류)은 공개 ntfy.sh 토픽 대신 강사 PWA의 표준 Web Push로 전달한다.

- 강사 JWT로 인증한 브라우저만 구독 등록·해제 및 알림 이력 조회 가능
- GitHub Actions 발송은 PUSH_PUBLISH_TOKEN 공유 시크릿으로 Worker의 /push/publish만 호출
- VAPID 기반 Web Push 암호화 사용
- 구독 endpoint와 키는 D1에 저장하며 404/410 만료 응답 시 자동 삭제
- 상세 알림 이력은 D1에 30일 보관하고 최대 100건을 강사앱 알림함에 표시
- 운영체제 알림에는 첫 섹션 요약과 `눌러서 전체 내용 보기`를 표시하고, 전체 본문은 알림함에 보존
- 기본 클릭 URL에 알림 ID를 포함해 이미 열린 앱도 `/#/notifications?id=...`의 해당 항목으로 이동·강조
- 로그아웃·세션 만료 시 해당 기기의 로컬 PushSubscription을 해제
- 공개 토픽에는 학생 이름·연락처·금액·상세 URL을 다시 보내지 않음

운영 오류용 ntfy 토픽은 기존의 개인정보 없는 고정 안내 경로로만 남겨 두었다. 강사가 실제로 사용하는 상세 비즈니스 알림과 분리된다.

## 운영 반영 절차

배포 시 실제 키 값은 터미널·문서·Git 로그에 남기지 않고 대화형 secret 입력으로 등록한다.

1. worker/에서 npx web-push generate-vapid-keys로 VAPID 키 쌍을 한 번 생성한다.
2. Worker secret에 VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_PUBLISH_TOKEN을 등록한다. VAPID_SUBJECT는 운영 연락처의 mailto: URI를 사용한다.
3. GitHub Repository Secret PUSH_PUBLISH_TOKEN에 Worker와 동일한 값을 등록한다.
4. worker/에서 npx wrangler d1 migrations apply tone-game-users --remote로 0003_web_push.sql을 적용한다.
5. Worker와 PWA를 각각 기존 배포 절차로 배포한다.
6. 강사 휴대폰에서 새 PWA 버전을 연 뒤 **설정 → 이 기기 푸시 알림 → 이 기기 알림 받기**를 누른다.

PUSH_WORKER_URL은 자동화 테스트나 Worker 주소 변경 때만 필요하다. 미설정 시 현재 운영 Worker 주소를 사용한다.

## 확인

- Android/PC: 브라우저 알림 권한 허용 후 앱을 닫은 상태에서 수신 확인
- iPhone/iPad: iOS 16.4 이상, 홈 화면에 설치한 PWA에서 권한 허용 후 확인
- 알림을 눌렀을 때 `/#/notifications?id=...`로 이동하고 해당 알림이 강조되는지 확인
- 앱 알림함에 상세 내용이 남고 로그아웃 후에는 새 상세 알림이 오지 않는지 확인
- 구독 기기가 하나도 없으면 발송 API가 성공으로 위장하지 않고 409를 반환하는지 확인

실제 운영 푸시는 배포 후 강사 기기 구독이 생성되어야 검증할 수 있다.
