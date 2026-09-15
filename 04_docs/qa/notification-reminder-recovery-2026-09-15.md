# 전날 리마인더 응답 유실 복구 — 2026-09-15

## 상태

구현·검증을 마쳤으며 2026-09-15 사용자가 이번 변경의 커밋·푸시를 승인했다. 운영 반영 대상은 학생·상담 D-1 자동화이며, 이 코드가 main에 반영되면 이후 예약 실행에서 사용한다. PWA·Worker 실행 코드·DB·시크릿·의존성은 변경하지 않는다. 실제 시험 알림은 보내지 않았다.

## 확인한 장애

9/14 17시 [학생 리마인더 실행](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/34820624583)은 접수 확인 4건, 결과 불명 1건이었다. 이후 21시까지의 재실행도 기존 접수 4건·결과 불명 1건으로 종료했다. 사용자가 Solapi 내역에서 대상 학생 1명의 실제 미발송을 확인했다.

기존 단건 발송은 15초 뒤 응답을 못 받으면 `unknown`을 기록하고, 이후 실행도 해당 건을 계속 보류했다. Solapi에 요청이 도착하지 않은 경우 Solapi 실패 목록에도 나타나지 않으므로, **실패 목록이 비어 있다는 사실은 전체 발송의 증거가 아니다.**

## 변경

`solapi_reminder.mjs`의 학생·수업별 그룹 발송:

1. 비식별 발송 키를 넣은 빈 그룹을 생성한다. 아직 메시지 발송은 없다.
2. 반환된 그룹 ID를 기존 서명된 수신자 이력에 기록한다.
3. 같은 그룹에 한 학생의 메시지를 추가하고 등록 결과를 조회한다. 그룹의 `allowDuplicates:false`를 확인한다.
4. 그 그룹을 발송하고 다시 조회해 접수 여부를 확인한다.
5. 응답 유실 시 같은 실행에서 최대 3회 처리한다(재시도 전 1초·3초 대기). 계속 불명확하면 기존 Actions 재실행이 저장된 그룹을 조회·재개한다.

그룹 생성 응답만 유실되면 빈 그룹에는 메시지가 없으므로 새 빈 그룹 생성이 가능하다. 추가/발송 응답이 유실되면 이미 저장한 그룹을 재사용한다. Solapi는 PENDING 그룹에만 발송을 허용하고 발송 시 상태를 전환하므로, 단건 API를 다시 호출하는 방식과 구분된다.

### 이력·실패 처리

- `notification_ledger.mjs`에 서명된 `solapi-group:none` / 그룹 ID 메타데이터를 추가했다. 그룹 ID의 교체·삭제·수신자 간 공유를 거부한다.
- `notification_batch.mjs`의 기존 단건 발송 계약을 보존하고, 두 D-1 스크립트는 `sendTracked` 경로를 사용한다.
- 실제 그룹 ID가 저장된 `pending/unknown`은 같은 그룹으로 복구한다. 그룹 생성 실패가 서명된 `unknown/failed` 종료 상태로 남았으면 빈 그룹 생성부터 재개한다.
- 그룹 초기화만 남거나(`none + undefined`) 시도 도중까지만 남은(`none + pending`) 기록은 그룹 ID를 담은 로그 꼬리가 유실됐을 가능성이 있어 보류한다.
- 구버전 단건 `pending/unknown`은 그룹 ID가 없어 자동 재발송하지 않는다. 이번 수정이 지난 미발송을 소급해 다시 보내지는 않는다.
- 이력 기록 실패는 전파한다. 그룹 ID가 기록되기 전에 메시지를 등록하거나 발송하지 않는다.
- HTTP 200 안의 메시지별 등록 실패도 판독한다. 그룹 `COMPLETE`만으로 성공 처리하지 않으며 `sentSuccess`나 진행 상태를 확인한다.
- 접수 확인은 휴대폰 수신 완료 보증과 다르다. 잘못된 연락처·템플릿·잔액 부족·지속적인 외부 장애는 성공으로 처리하지 않는다.

## 검증

Worker 패키지의 영향 테스트 9개 파일을 실행했다. 모든 외부 요청은 합성 응답으로 대체했다.

```powershell
npm test -- tests/solapiReminder.test.js tests/notificationBatch.test.js tests/notificationLedger.test.js tests/notificationReminderScripts.integration.test.js tests/notificationAutomation.integration.test.js lib/notificationDelivery.test.js tests/notificationFollowups.integration.test.js tests/notificationScheduler.integration.test.js tests/notificationPublish.integration.test.js
```

- 요청이 서버에 도착하기 전 연결 끊김 → 같은 그룹 재시도로 1회 접수
- 서버 접수 후 응답 유실/깨진 JSON → 조회로 복구, 추가 발송 없음
- 빈 그룹 생성·메시지 등록 응답 유실 → 발송 전에 그룹 ID 확보·기존 등록 재사용
- 여러 즉시 재시도 실패 후 새 Node 프로세스에서 같은 그룹 재개
- 학생·상담 실제 스크립트, 자정 경계·자동 발송 창·기존 성공 건 생략 유지
- 그룹 소유권/서명 불일치, 그룹 저장 실패, 불완전 로그, API 조회 장애 시 잘못된 성공·새 그룹 발송 차단
- 전화번호·학생 이름·본문·시크릿이 오류/로그에 노출되지 않음

최종 코드에서 **9개 파일·323개 테스트 통과**(31.13초). 소유권을 나눈 구현·통합 테스트와 별도의 공식 API 계약 검토를 수행했다. 검토에서 발견한 HTTP 200 개별 등록 실패 판독, 그룹 초기화 뒤 불완전 로그 재개 문제를 수정하고 전체 영향 묶음을 다시 통과했다. 변경 파일 구문 검사와 기존 스크립트 `git diff --check`도 통과했다.

## 운영 반영 시 범위와 제약

- 자동화 코드와 새 모듈을 함께 main에 반영해야 실제 예약 실행이 바뀐다. 별도의 PWA·Worker 배포는 필요하지 않다. 실제 커밋·CI 결과는 공유 메모리의 운영 반영 기록을 따른다.
- 기존 17~21시 자동 발송 창, Workflow 동시 실행 방지, 기존 수신자 키·접수 이력을 유지한다.
- 새 메타데이터는 기존 v1 서명을 확장한다. 당일 롤백 시 구버전 reader가 새 메타데이터를 보류할 수 있으므로 발송 진행 상태를 먼저 확인한다.
- GitHub 로그는 영구 저장소가 아니다. 이력 전체/마지막 부분 유실·API 장애 등에서 정확히 한 번 전송을 보장하지 않으며 상태를 임의로 초기화하지 않는다.
- 실제 Solapi 계정의 읽기 권한과 최종 수신은 이번 합성 테스트로 검증하지 않았다. 실제 발송 완료를 주장하지 않는다.

## 공식 API 근거

- [빈 그룹 생성](https://solapi.com/developers/api/msg-groups-createMessageGroup)
- [메시지 추가와 개별 등록 결과](https://solapi.com/developers/api/msg-groups-addGroupMessages)
- [PENDING 그룹 발송](https://solapi.com/developers/api/msg-groups-sendGroupMessage)
- [그룹 상태 조회](https://solapi.com/developers/api/msg-groups-getGroupInfo)
- [AlreadySent / GroupInProcessing 오류](https://solapi.com/developers/api/msg-groups-groupError)
