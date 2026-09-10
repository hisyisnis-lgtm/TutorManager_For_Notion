# 전날 알림 백업의 구버전 로그 오류 수정 — 2026-09-10

## 상태

사용자 운영 반영 승인으로 **2026-09-10 16:25 KST main 푸시를 완료**했고, 16:26 KST GitHub Actions CI 성공을 확인했다. 다음 자동 실행부터 수정 코드가 적용된다. 실제 Notion 데이터 변경이나 카카오·ntfy 시험 발송은 없다.

## 확인한 장애

- 9월 9일 17시 본 작업은 정상 완료: [학생 2명 발송](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/34326807898), [상담·원데이 대상 0건](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/34326808564).
- 19:30 예정 백업이 23:41~43 KST에 실행됐다. [상담 백업](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/34365245691)과 [학생 백업](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/34365438056) 모두 `NOTIFICATION_LEDGER_UNAVAILABLE / unrecognized_log`로 종료했다.
- 21:03 배포에서 도입한 발송 이력 복원이 기존 성공 여부 검사보다 먼저 실행되면서, 서명 시작 표식이 없는 당일 구버전 로그를 읽다가 중단됐다.

## 수정

- `notification_ledger.mjs`: 구성 검증과 서명 시작 기록을 남긴 뒤 선택적 `shouldSkip` 가드를 실행한다. 명시적으로 `true`이면 이력을 다운로드하지 않고 `null`을 반환한다. 실제 발송 경로의 이력·서명 검증은 유지한다.
- 학생·상담 스크립트: 성공한 자동 실행의 백업 생략 판단을 위 가드로 전달한다. 구버전 로그를 복원하기 전에 정상 종료하며, 자체 서명 기록은 다음 재실행에서도 인식할 수 있다.
- `notion_utils.mjs`: D-1 두 호출에만 `failOnMiss: true`를 적용한다. 발송 한계가 지났는데 성공을 확인할 수 없으면 오류를 전달해 실패로 남기고 `runWithAlert`가 한 번만 경고한다. 미발송을 정상 실행으로 기록하지 않는다. 다른 자동화의 기본 동작은 유지한다.
- 수동 실행, 이전 실패·결과 불명, 읽을 수 없는 이력을 실제 재발송의 근거로 사용하지 않는다.

## 검증

수정 전 통합 테스트에서 구버전 성공 로그 후 자동 백업의 8개 경로가 종료 코드 1로 실패하는 것을 재현했다. 수정 후 다음 명령은 **4개 파일, 190개 테스트 통과**했다.

```text
# worker/에서 실행
npm test -- tests/notificationReminderScripts.integration.test.js tests/notificationLedger.test.js tests/notificationBatch.test.js tests/notificationAutomation.integration.test.js
```

- 학생·상담 각각 19:30 및 23:43의 schedule/repository_dispatch: 구버전 성공 확인 후 정상 종료, 이력 다운로드·Notion 조회·Solapi 발송·ntfy 경고 없음.
- 정상 발송 → 백업 생략 → 새 수동 프로세스: 서명 기록 복원 및 추가 발송 0건.
- 구버전 실패 기록, 수동 실행의 구버전 로그, 성공 조회 실패, 자정 이후 이력 복원과 새벽 자동 발송 차단 유지.
- 23:43까지 성공 미확인·조회 불가: 발송하지 않고 실패 종료, 경고 1회.
- `shouldSkip`의 명시적 true만 생략하며 잘못된 콜백 구성은 I/O 전에 거부한다.

모든 외부 API는 합성 응답으로 대체했고 별도 Node 프로세스에도 테스트용 환경변수만 전달했다. PWA 화면과 Worker 서비스 코드는 바꾸지 않아 앱 빌드·시각 검수·Worker 배포는 범위에 포함하지 않았다.

## 운영 반영

- 코드 커밋: [`20a0eb90194d504dd1ce91ee810ff5d5baf084d8`](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/commit/20a0eb90194d504dd1ce91ee810ff5d5baf084d8). 운영 main `e0c60d9`에서 별도 작업 디렉터리를 만들고 이번 코드·테스트 6개 파일만 반영했다. 기존 공유 체크아웃의 브랜치와 진행 중인 다른 변경은 보존했다.
- 격리된 반영 후보에서 잠금 파일 기준 `npm ci` 후 관련 190개 테스트를 다시 통과했다.
- [Worker CI 34449884892](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/34449884892): **29개 파일, 568개 테스트 통과**. Wrangler dry-run 통과(336.51 KiB / gzip 73.84 KiB), 2026-09-10 16:26:05 KST 완료.
- 반영 전 학생·상담 D-1에 진행 중인 실행이 없음을 확인했다. 실제 발송이 가능한 수동 재실행은 하지 않았다.
- D-1 자동화는 main의 스크립트를 사용하므로 별도 Worker 실배포나 PWA 태그 없이 다음 자동 실행부터 적용된다. 기존 발송 시각·concurrency·시크릿을 유지했다.
- 과거 실패 기록은 그대로 남는다. 이 기록을 지우거나 성공으로 변경하지 않았다.
- 롤백이 필요하면 위 코드 커밋을 역적용한 새 커밋을 main에 반영한다. 공유 작업 트리 전체를 되돌리거나 force push하지 않는다.
