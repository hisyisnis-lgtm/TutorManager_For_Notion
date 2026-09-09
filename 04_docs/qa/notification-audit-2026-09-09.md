# 알림 검수 — 2026-09-09

## 결론

**전부 정상으로 판정할 수 없음.** ntfy·카카오·SMS 발송 경로와 설정 연결은 확인했으나, 기존 코드에 **발송 실패를 성공으로 표시하거나 재시도에서 누락시키는 문제 3종**이 남아 있다. 검수 요청에 따라 발견 사실만 기록했으며, 아래 실패 처리 로직을 임의 변경하거나 실사용자에게 시험 알림을 보내지 않았다.

숙제 업로드와 공통 원인이던 Worker `redirect: 'error'` 문제는 별도 수정했다. 범위·314개 Worker 테스트 및 19개 자동화 테스트 결과는 [숙제 오류 검증 기록](./homework-redirect-2026-09-09.md)을 참조한다. 이 테스트 수가 모든 알림의 운영 수신을 의미하지는 않는다.

## 유형별 연결 확인

| 알림/기능 | 발송 또는 조회 경로 | 트리거·시간(KST) | 확인 범위 |
|---|---|---|---|
| 강사 아침 브리핑 | notify_daily_brief → ntfy | Worker 08~11시, GitHub 10:30 백업 | 워크플로·스크립트·토픽 연결 |
| 강사 내일 수업 | notify_upcoming_classes → ntfy | Worker 21~23시, GitHub 22:30 백업 | 동일 |
| 일반 학생 수업 D-1 | notify_student_tomorrow → Solapi 카카오 | Worker 17~21시, GitHub 19:30 백업 | 취소·상담·원데이 제외, 템플릿 연결 |
| 상담·원데이 D-1 | notify_consult_tomorrow → Solapi 카카오 | 위와 동일 | 유형별 대상·전용 템플릿 연결 |
| 상담 접수 | Worker → GitHub ntfy-relay → ntfy; 강사 카카오 | 접수 시 | 호출·릴레이·템플릿 연결 |
| 숙제 새 파일 제출 | Worker → GitHub ntfy-relay → ntfy | 학생 제출 시 | 호출 경로, 합성 런타임에서 제출→릴레이 요청 |
| 숙제 배정·피드백 | Worker → Solapi 카카오 | 강사 API | 대상 검증·템플릿 연결; 성공 응답 문제는 아래 참조 |
| 학생 본인확인 OTP | Worker → Solapi SMS 또는 카카오 | 인증번호 요청 시 | 발신번호·대체 템플릿 연결; 접수 실패 전파 문제는 아래 참조 |
| 수업 충돌·수납 오류·자동화 실패 | 자동화 → ntfy | 충돌 주기/웹훅, 각 작업 실패 시 | sender·workflow 매핑 |
| 회차 부족 | check_session_shortage → Notion 표시 | 09·18시 예약 및 dispatch | 독립 카카오 발송이 아니라 회차부족_감지 갱신; 실패 시 운영 알림 |
| 일일 운영 리포트 | daily_digest → ntfy digest | GitHub 09시 예약 | 요약 토픽 연결; 실제 실행 시각은 지연 가능 |
| 백업·아카이브·빌드 알림 | workflow → ntfy CLI | 성공/실패별 조건 | 지정 운영 토픽 연결 |
| Worker 에러·인증/작업 경고 | Worker → ntfy 직접 발송 | 해당 오류 시 | manual 변경 및 3xx 차단 테스트; 중복 방지 문제는 아래 참조 |
| 앱 알림함 | 설정의 ntfy 코드 → 이력 JSON·SSE | 페이지 진입·재연결 | 현재 코드의 직접 조회 경로 확인, 앱 JWT 미전송. 이번 서버 수정에서 화면은 변경하지 않음 |

시간은 설정상의 실행 창이다. GitHub schedule은 실제 로그의 실행 시각과 차이가 날 수 있다. 별도 Notion 외부 자동화나 휴대폰 OS 설정은 이 저장소·Actions 검수 범위 밖이다.

## 남아 있는 문제

### 1. ntfy 발송 실패가 Actions 성공으로 끝날 수 있음

- `01_automation/notion_utils.mjs:238`의 공통 발송기는 실패 시 `{ ok: false }`를 반환한다.
- 브리핑·내일 수업·충돌·일일 리포트·Worker 릴레이 호출부는 실패 결과를 검사하지 않는다. 예: `01_automation/notify_from_worker.mjs:26`.
- Worker 정시 실행과 백업 가드는 GitHub의 성공 이력을 발송 성공으로 판단한다. HTTP 실패가 작업 성공으로 남으면 후속 재시도가 생략될 수 있다.
- 실제 최근 실행에서 실패가 발생했다고 단정한 것이 아니라, 코드에서 확인한 실패 시 동작이다.

### 2. 카카오·SMS 실패가 완료로 집계/표시됨

- `01_automation/notion_utils.mjs:346`의 Solapi 공통 함수는 HTTP 거부 또는 최종 연결 실패를 로그만 남기고 반환한다.
- 학생/상담 D-1 스크립트는 반환값과 관계없이 `sent++` 하므로 실패도 발송 수에 포함될 수 있다.
- Worker의 카카오·SMS 함수도 오류를 호출부에 알리지 않는다. 숙제 알림 API는 템플릿 설정 여부만으로 `sent: true`를 반환하고, OTP 요청도 실제 접수 실패를 반영하지 못한다.
- 개선 시 성공 수 집계뿐 아니라 일부 수신자만 실패했을 때 전체 재발송으로 인한 중복도 함께 다뤄야 한다.

### 3. 즉시 알림 실패 후 재시도가 보장되지 않음

- `worker/src/index.js:554`의 ntfy 중계 함수는 GitHub dispatch의 실패 결과를 검사하지 않는다.
- 직접 경고 발송은 `worker/src/index.js:515`에서 전송 전에 중복 방지 기록을 만든다. 첫 전송이 실패해도 같은 경고가 TTL 동안 생략될 수 있다.
- 이번 redirect 옵션 수정과 별개인 기존 로직이며, 검수 중 변경하지 않았다.

## 운영 설정 확인

시크릿 **이름과 등록 여부만** 조회했으며 값은 읽거나 기록하지 않았다. 이름이 존재한다는 사실만으로 토큰 유효성·잔액·템플릿 승인·전화번호 도달 여부까지 검증되지는 않는다.

- GitHub: 현재 workflow에서 사용하는 Notion·ntfy 일반/critical/warn/digest/ops 토픽·토큰, Solapi 키·PFID, 학생/상담/원데이 D-1 템플릿 모두 등록 확인.
- Worker: GITHUB_PAT, ntfy 일반 토픽·토큰, Solapi 키·PFID, 상담/숙제 배정/피드백 템플릿, MY_PHONE 및 SMS 발신번호·OTP 대체 템플릿 모두 등록 확인.
- Worker의 선택 NTFY_TOPIC_DIGEST는 미등록이나 일반 NTFY_TOPIC fallback이 있어 필수 누락이 아니다. Actions의 실제 일일 리포트용 digest 시크릿은 등록되어 있다.
- GITHUB_TOKEN은 Actions가 기본 제공하는 토큰이므로 사용자 시크릿 목록에 없는 것이 정상이다.
- 전체 22개 workflow는 활성 상태였고, 최근 200개 실행 메타데이터에서 알림 업무 workflow 실패는 발견하지 못했다. 다만 위 코드 문제로 녹색 상태만으로 발송 성공을 판정할 수 없다.

## 최근 운영 로그의 실제 확인 범위

아래 8개 실행은 모두 **ntfy 원복 이전 코드**다. 최신 ntfy 코드의 실수신 검증으로 확대하지 않았다. 로그 원문·이름·전화번호·토픽·알림 본문은 출력하거나 저장하지 않고 안전한 상태·개수만 집계했다.

| 실행 링크 | 실행 시각(9/9 KST) | 당시 코드 | 로그로 확인한 결과 |
|---|---:|---|---|
| [강사 브리핑](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/34334045088) | 18:19 | f9ba1c2 | 당시 Web Push Worker 요청 HTTP 성공 1건 |
| [일일 리포트](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/34307760615) | 12:36 | 6894522 | ntfy HTTP 성공 1건 |
| [내일 수업](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/34256391654) | 02:19 | 6894522 | ntfy HTTP 성공 1건 |
| [학생 D-1](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/34326807898) | 17:00 | 9017317 | Solapi HTTP 성공 2건 |
| [상담 D-1](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/34326808564) | 17:00 | 9017317 | 발송 0건 |
| [Worker 릴레이](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/34314954539) | 14:27 | 4422453 | 당시 Web Push Worker 요청 HTTP 성공 1건 |
| [충돌 감지](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/34329570320) | 17:31 | 9017317 | 충돌·업데이트·발송 0건 |
| [회차 부족](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/34300896555) | 10:51 | 6894522 | 수업 1개 표시 갱신, 발송 기록 없음 |

이 로그들에서는 알려진 전송 실패·재시도 표식이 없었다. ntfy/Solapi HTTP 성공은 서비스가 요청을 수락한 근거이며 최종 휴대폰 수신 증거는 아니다. 과거 Web Push 완료 로그는 자체 Worker 요청 성공까지만 확인되며 APNs/FCM 수락 여부는 알 수 없다.

## 하지 않은 작업

- 운영 알림 시험 전송, 수신자 일괄 발송, 정시 workflow 강제 실행.
- 실제 학생 숙제 제출·운영 데이터 수정.
- 시크릿 값 열람·변경, ntfy 접근 정책 변경, Web Push 재도입.
- 현재 버전의 휴대폰별 실수신·팝업 동작 정상 판정.
