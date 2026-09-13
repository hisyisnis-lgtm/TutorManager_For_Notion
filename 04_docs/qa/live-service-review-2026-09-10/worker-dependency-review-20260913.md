# 강사·학생 앱 배포용 Worker·자동화 의존성 검토

2026-09-13. 이 문서는 배포 후보의 범위와 격리 검증을 기록한다. 실제 배포 완료를 뜻하지 않는다. 운영 D1·GitHub 변수·Cloudflare 배포는 배포 담당자가 별도로 수행한다. 이 검토에서 운영 API 쓰기, 알림 전송, 커밋·푸시는 하지 않았다.

## 후보와 기준

- 후보: `99_external/pwa-live-service-release-20260913/`.
- Worker 기준: `.tmp_qa/game-site-release/worker/`. 배포 담당자가 현 운영 version `60d9b489-67dc-4b10-8d26-c1633ed4be6a` 100%를 읽기로 재확인했다.
- 작업 전 원본: `.tmp_qa/live-service-improvement-20260910/baseline/`. 공유 체크아웃의 작업 중 변경을 통째로 복사하지 않고, 이번 기능의 차이만 운영 기준에 적용했다.
- 자동화 기준: 후보의 Git main `b8ecfc4`. main에는 이미 서명 이력과 백업 실행 가드가 있으므로 해당 동작을 유지하고 후속 결과 연결만 추가했다.
- main에는 일부 기존 운영 게임 CAS 저장·측정 코드가 없었다. 후보의 해당 차이는 새 게임 기능 추가가 아니라 기존 운영 Worker 동작 보존이다.

## 이번 런타임 변경

| 파일 | 포함한 변경 |
|---|---|
| `worker/src/index.js` | 인증 동의서 경로, 후속 기록 생산·GET/PATCH·HMAC ingest, 학생 조회의 두 시간 값 계산과 오류 보존 |
| `worker/lib/security.js` | 학생 동의서 경로의 학생 코드를 기존 로그 마스킹 대상에 추가 |
| `worker/lib/consentTerms.js` | 강사 JWT 또는 본인 학생 세션으로 검증한 뒤 기존 동의서 원문 반환 |
| `worker/lib/studentLedger.js` | 결제 formula·학생 사용 rollup·예정 수업 formula를 이용한 일관된 시간 계산, 누락·잘못된 조회 결과 보존 |
| `worker/lib/notificationFollowups.js` | 접수 결과와 운영자 처리 내역을 별도로 보관하고 권한·서명·중복·용량을 검증 |
| `worker/migrations/0003_notification_followups.sql` | 기존 GAME_DB에 후속 기록 테이블과 인덱스만 추가 |

줄바꿈을 제외한 비교로 나머지 런타임 모듈과 `package.json`, `package-lock.json`, `wrangler.toml`은 운영 기준과 동일함을 확인했다. Worker index는 운영 대비 62줄 추가·59줄 삭제이며, 신규 모듈에는 별도 런타임 의존성이나 시크릿이 필요하지 않다.

공통 `requireJwt`·`enforceStudentSession`, 게임 CAS·OAuth·대시보드, 기존 공개 측정과 인증 보고서는 운영 동작을 유지한다. 공유 소스의 Cloudflare Access 게임 대시보드 전환, `/analytics/operations`, 외부 감시·백업 개선은 이번 후보에 넣지 않았다.

## 학생 MY의 두 숫자

최종 화면은 `paidHours`와 `remainingHours`만 사용한다. `timeLedger` 상세 응답 필드는 후보에서 제외했다.

- 결제한 시간: 환불이 반영된 결제별 유효 시간 formula 합계.
- 남은 수업 시간: 유효 결제 시간 − 사용·예정 시간 rollup + 예정 수업 시간. 예정 수업을 포함한 학생 잔여 시간이다.
- 누락된 formula·날짜를 0으로 바꾸지 않는다. 확인할 수 없는 값은 null을 반환해 앱의 ‘확인 필요’ 표시와 연결한다.
- 하위 Notion 조회 오류나 불완전한 페이지 순회를 빈 결과로 취급하지 않는다. 학생 조회 오류를 코드 없음 404로 바꾸지 않아 기존 학생 캐시를 잘못 지우지 않는다.
- 공유일 이후 판다 먹이 계산과 기존 예약 검증은 유지한다. 상세 금액·메모·전화번호를 새 시간 응답에 노출하지 않는다.

## 알림 후속 연결과 설정

자동화 변경은 `01_automation/notification_followups.mjs` 신규 및 기존 `notification_batch.mjs`, `notify_student_tomorrow.mjs`, `notify_consult_tomorrow.mjs`, `notify_from_worker.mjs`의 결과 콜백이다. 대응 workflow 3개에는 `NOTIFICATION_FOLLOWUP_URL: ${{ vars.NOTIFICATION_FOLLOWUP_URL }}`만 추가했다. 기존 main의 스케줄·동시 실행·서명 이력·결과 불명 재발송 차단을 보존했다.

배포 담당자가 확인할 선행 조건:

1. `GAME_DB`의 migration 이력·테이블을 읽기로 대조한 뒤 `0003_notification_followups.sql` 적용. 기존 게임·인증 테이블을 변경하거나 삭제하지 않는다.
2. Worker 선행 배포. 동의서 API는 DB migration 없이 기존 인증을 사용하고 `private, no-store`로 반환한다.
3. GitHub 일반 변수 `NOTIFICATION_FOLLOWUP_URL`을 해당 Worker의 HTTPS `/notification-followups/ingest` 주소로 설정. 기존 Worker와 Actions의 `SOLAPI_API_SECRET`·`NTFY_TOKEN`을 용도별 HMAC 키로 재사용한다.
4. 자동화 3개 호출부와 PWA를 반영한다. 실제 발송을 새 검증 목적으로 실행하지 않는다.

후속 결과 보관 실패는 이미 끝난 업무 저장이나 공급자 접수를 되돌리지 않는다. queued 릴레이에 최종 콜백이 15분 동안 없으면 원래 접수 상태를 유지하며 확인 대상으로 표시한다. 처리 완료가 원래 실패·결과 불명을 성공으로 바꾸지 않고 자동 재발송도 하지 않는다. 새 목록에는 전화번호·학생 코드·OTP·메시지 원문·토큰을 저장하지 않는다.

## 검증

- 공유 소스의 관련 11개 파일 133개 테스트 통과: 인증·동의서·학생 시간·후속 이력·알림 실패와 업무 저장 분리.
- 후보 전체 Worker 37개 파일 625개 최종 통과. 최초 실행에서 이전 알림 테스트의 후속 metadata/추가 waitUntil 기대 4개와 자동화 child process 기동·5초 테스트 기한 초과 12개가 실패했다. 알림 기대를 보강한 뒤 영향 3개 파일 73개를 단일 threads/CLI testTimeout 30초로 재검증해 모두 통과했다. 나머지 552개는 최초 전체 실행에서 통과했으며 제품 소스를 바꾸거나 무관한 검사를 반복하지 않았다.
- 자동화 child process의 기존 10초 상한은 유지했다. 기동·5초 기한 실패는 단일 threads 실행에서 사라졌고 제품의 발송/중복 차단 assertion은 모두 통과했다.
- 보강된 검증은 실제 공급자/릴레이 호출 1회, 발송 결과와 D1 행의 일치, 원래 오류 응답과 저장 성공, 민감 정보 마스킹을 함께 확인한다.
- 후보 `git diff --check`, Worker index와 신규 자동화 모듈의 Node 구문 검사 통과.
- 모든 테스트는 가짜 fetch와 격리 SQLite를 사용한다. 실제 외부 공급자·운영 DB의 수신 결과를 확인한 것으로 취급하지 않는다.

이번 검토 범위에서 새 중대 보안·기록 손실 회귀를 발견하지 않았다. DB migration 적용, 서명 키의 양쪽 설정 일치, 배포 후 인증 경계는 배포 담당자의 운영 확인 범위다.

실행 명령은 후보 `worker/`에서 `npm test -- --maxWorkers=2`, 영향 재검증은 `npm test -- tests/notificationPublish.integration.test.js tests/notificationDelivery.integration.test.js tests/notificationReminderScripts.integration.test.js --pool=threads --maxWorkers=1 --testTimeout=30000`이다.

Cloudflare [Workers 운영 권장사항](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)과 [D1 migration 문서](https://developers.cloudflare.com/d1/reference/migrations/)를 확인했다. 요청별 인증과 prepared SQL을 사용하고 부가 기록은 `ctx.waitUntil`로 유지한다. 공개 ingest는 HMAC 검증, ±5분 타임스탬프, 4 KiB 본문 제한을 별도로 적용한다.
