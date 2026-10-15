# Panda 출시 증거 보강 — 2026-10-16

이 기록은 서버 원장·경제 규칙의 기존 운영 검증과 이번 학생앱 권한 검사 검증을 구분한 **증분 검증**이다. 기존 확인 기록의 해시만 갱신한 것이 아니며, 검사 도구·합격 조건·권한 코드는 변경하지 않았다.

- 런타임 소스: `439001ec13d228dd81fef9f7f058ff33323ea228`.
- 실제 비서빙 Worker: `ac492824-c287-4223-b64e-f0e09ebed40f`, https://ac492824-tutor-manager-proxy.hisyisnis.workers.dev.
- 현재 계약 해시: `003ef41c8ac368283262f5435c71f4b930c123fc3dfa8ee09d8de1a7413ff5af`.
- 직접 읽기 검증: 2026-10-15T15:11:32.694Z. 운영 트래픽은 기존 `0d4ab8a2-e336-4650-938a-f5d085127014` 100%를 유지했다.
- 구조화한 근거: [panda-readiness-incremental.json](panda-readiness-incremental.json).

## 변경 영향과 검사 범위

기존 검증 소스 `9ff670a8166dea3735e86d1d2b923ca63863d2ee`와 6개 계약 파일을 LF로 정규화해 대조했다. `0005_student_panda.sql`, `0006_panda_transition.sql`, `pandaRules.js`, `pandaDb.js`, `wardrobe.json` 5개가 동일하다. `pandaRoutes.js`에는 학생 ID가 조회 중 변경되거나 이용 권한·회원 세션이 취소된 경우 하위 데이터 조회와 원장 저장을 거부하는 `authorizeIdentity` 검사 및 해당 오류 보존만 추가되었다. 먹이 산정·가격·차감·저장·전환 코드는 바뀌지 않았다. 줄바꿈 차이로 판정하지 않았다.

단순 외부 호출 전후 검사로 대체하면 내부 Notion 조회 중 다른 학생으로 바뀐 응답이나 저장 직전 권한 취소를 놓칠 수 있어, 이 보안 변경을 유지한다. GET도 최초 프로필·전환 상태를 저장할 수 있으므로 조회 경로 역시 권한 검사를 유지한다.

## 6개 출시 조건의 근거

| 조건 | 기존 운영 근거 | 이번 추가 확인 |
| --- | --- | --- |
| D1 migration | 기존 0005·0006 운영 적용과 계약 검증 | 두 SQL의 동일성, 실제 최신 stage health 200/schema ready, 원격 0030까지 pending 0, FK 위반 0. |
| authenticated read/write | [기존 운영 TEST 학생 검증](../panda-release-2026-10-05/rollout-verification.md)의 정상 세션 조회·먹이 차감 | 동일 원장 구현을 사용하는 최신 CI의 실제 Worker 라우트 합성 인증 CRUD. 새 회원과 레거시 학생의 권한 거부/학생 ID 교체/수업 조회 중 세션 취소 테스트 포함. **새 비서빙 원격 stage의 인증된 Panda CRUD를 실행한 것은 아니다.** |
| retry without double debit | 같은 운영 TEST 요청의 중복 차감 방지·다른 payload 재사용 409 | 동일 `pandaDb.js` 및 최신 `panda.integration.test.js` 동시 요청·가격/수량 검증·재시도 회귀 통과. |
| second device sync | 기존 운영 TEST의 두 브라우저 컨텍스트 캐시 없는 복원 | 원장·카탈로그 동일성 및 최신 합성 테스트의 다른 요청/예약 코드에서 같은 학생 원장 복원. 이번 원격 stage에서 두 기기 검사를 새로 수행한 것으로 주장하지 않는다. |
| transition once | 기존 운영 TEST 전환 시각·초기 먹이·안내 확인 재접속 유지 | 동일 마이그레이션·원장 구현, 신규·기존 기기 순서 및 잘못된 로컬 업로드 거부·기존 전환 보존 회귀 통과. |
| backup restore | 기존 R2 백업 재다운로드·새 SQLite 복구 실검증 | 이번 실제 운영 DB 비공개 백업 255266 bytes를 별도 새 로컬 SQLite에 복구하고 기존 52개 테이블의 행·스키마와 승인 9개 권한 보존, integrity ok/FK 0 확인. 운영 DB 복원은 수행하지 않았다. |

## 새 권한 경계의 직접 검증

[실제 Worker CI 38754759382](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/38754759382)는 소스 `439001ec13d228dd81fef9f7f058ff33323ea228`의 91개 suite / 2,027개 테스트를 실행해 모두 통과했다. `student-app-access.integration.test.js`는 회원/레거시 학생 각각 최종 학생 ID 변경 시 수업·결제·숙제 후속 조회와 Panda 저장이 0건임을 확인한다. 수업 조회 중 회원 세션 취소 시 Panda 쓰기는 401, 저장 0건이다. 권한 취소 이후 조회·쓰기 거부도 검증한다.

실제 비서빙 stage에 올바른 서비스 출처로 보낸 레거시 Panda GET/POST와 회원 Panda GET/POST의 **세션 없는 요청 4개가 모두 401**이었다. 운영 D1은 읽기 전용 조회로 9개 권한 allowed/revision 1 및 sync ready 9개, 기존 Panda 프로필 7개·거래 191개, 회원·연결·탈퇴 0개를 확인했다. 이 검사는 고객 식별자나 토큰을 공개하지 않고 데이터 쓰기 0건으로 끝났다.

별도의 동일 출시 소스 합성 브라우저 검수에서는 정상 강사 로그인 → 가입 대기 회원 허용 → 학생 리스트/회원 학생앱 탭 생성 → 학생앱 진입 → 강사 OFF → 앱 접근 차단/탭 제거 → ON 복구를 확인했다. 신규 탈퇴 경로도 합성 회원에서 CAS 충돌·최신 미리보기·탈퇴 완료 GET 복구·기존 세션 거부·연결 학생앱만 OFF·수업 행 및 타 학생 보존을 확인했다. 이 검수는 실운영 학생 또는 회원 삭제가 아니다.

## 한계

새 stage에서 실제 학생/회원 계정을 이용한 Panda 차감·구매, 신규 두 기기 테스트, 실문자·메일·결제는 수행하지 않았다. 기존 경제·원장 계약의 실제 운영 검증을 재사용하고 변경된 권한 경계를 별도로 검증했다. 이 증거 발급은 운영 배포 자체를 뜻하지 않는다. 배포 시 main 정렬·동일 런타임 파일 해시·기존 50개 binding 보존·최신 CI·태그 보호 절차를 계속 적용한다.
