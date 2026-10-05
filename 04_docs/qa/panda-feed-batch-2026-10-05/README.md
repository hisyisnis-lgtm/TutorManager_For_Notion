# 랴오랴오 연속 먹이 저장 검수 — 2026-10-05

## 재현과 원인

v2.49.1에서 알 단계에 먹이를 1개씩 빠르게5번 주면, 표시 잔액은495개·EXP3/3이지만 서버 거래5건이 순서대로 끝날 때까지 성장 연출을 기다렸다. 로컬의 각 응답을3초 지연시킨 실행에서는 첫 진화가 약15초 뒤 시작됐고19초 샘플에서 레벨2/EXP2/17을 확인했다. 캐릭터를 전혀 터치하지 않아도 성장했으므로, 이 재현에서 터치는 성장 시작 조건이 아니었다.

각 거래는 기존 Worker에서 Notion 학생 식별과 전체 수업 먹이 집계를 반복한다. 화면 연출을 맞춘 이전 수정은 이 직렬 요청 비용을 줄이지 않았다.

## 수정 범위

아직 보내지 않은 연속 먹이 entry를 기존 count 거래로 합산한다. 원격 첫 입력은 마지막 입력 후180ms, 최초 입력부터 최대600ms 안에 전송한다. 이미 전송 중인 거래는 payload/requestId/expectedRevision을 그대로 유지하고, 이후 대기 entry만 다음 거래로 합산한다. 잎 도착과 예약·결과 Promise는 각각 유지한다. 로컬 저장은 시작을 지연하지 않는다.

모든 잎 도착과 먹기 동작이 끝난 경우, 서버가 이미 확정한 분량으로 넘은 성장 단계는 다음 배치의 완료를 기다리지 않고 공개한다. 미확정 먹이로 단계를 올리지 않으며, 각 확정 성장은 한 번만 연출한다. 후속 배치 실패 시에는 이미 확정한 성장과 소비를 유지하고 나머지 수량을 복원한다. 전송 시작 전에 창 focus/online 재조회가 진행 중이면 예약을 보존하고 정상 재조회가 끝난 뒤 저장한다.

Worker·DB·먹이 획득/성장 기준·전환 버전은 수정하지 않는다. 운영 TEST의 먹이를 소비하거나 다시 초기화하는 검수는 하지 않는다.

## 수정 후 검수

- 관련4파일135개테스트 통과. 빠른5입력의한거래합산,처음1전송뒤나머지4합산,최대600ms대기,40개연속,focus읽기와예약동시발생,충돌/실패/유실재시도/unmount,부분성장중복방지 포함.
- 실제 로컬 Chromium 390×844: 클릭88/150/198/249/303ms,응답지연3초에서5개가count5 한거래/revision1/영수증1개로확정. 캐릭터터치0회. 성장charge3518ms,몸/레벨공개5049ms,최종Lv2/EXP2/17/food495.
- 실제 320×568: 먼저4개확정된뒤마지막1개요청이거절되거나응답유실. 서버fed4·영수증1개일때이미charge가시작되고Lv2공개. 거절이면fed4/food496/EXP1/17을유지. 응답유실후재시도면fed5/revision2/영수증2개/food495/EXP2/17로확정되며추가진화없음.
- count5응답유실재시도: 잠시food500/알로복원한뒤동일requestId/count5로재조회,최종fed5/revision1/영수증1개/food495/Lv2. 중복차감없음.
- 검수한 모든 로컬 실행에서 pageerror·가로넘침·HMR없음. 안정된 기능 코드만 검수했다. 입력이600ms창을넘으면1~2거래로분리될수있으며,이를한거래실패로판정하지않고확정성장이후속거래를기다리지않는지검증했다.
- npm run build 통과. 디자인감사ERROR0/WARN0. 변경두파일ESLint ERROR0(기존 테스트 import WARN1).

각응답3초라는같은조건에서,빠른연속5입력의성장시작은직렬5거래약15초에서한거래약3.5초로줄었다. 이수치는로컬통제조건이며실제학생망의보장시간은아니다.

[수정 전 기록](./before-local-evidence.json) · [수정 후 기록](./after-local-evidence.json)

## 운영 배포 및 검수 완료 — v2.49.2

- 승인 Widget2파일, QA fixture/근거, package/lock 버전만 격리 main `5209679c6949cf963452a3af48228d83b3cf8e66`에 반영하고 태그 `v2.49.2`를 발행했다. 공유 작업 트리의 무관한 변경과 운영 v2.49.1 이력을 보존했다.
- [main CI37268452730](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/37268452730) 및 [태그 배포37268671231](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/37268671231) 모두 success. 전체84파일897tests·lint·디자인 ERROR/WARN0·build PASS. 최초 실행에 성공했으며 가드 완화나 재배포는 하지 않았다.
- 운영 https://tiantian-chinese.pages.dev, 고유 https://967fdba6.tiantian-chinese.pages.dev. Pages ID `967fdba6-8daf-410f-a52e-0b3742e48bb1`. 이전f09abb82/v2.49.1의 세션 코드 자산을 보존했다.
- 890파일/48,906,851bytes. 새 entry `index-CYksEfam.js` 597,812bytes / gzip177,105bytes.
- 고유/공식 각2라우트·16자산 해시와 Worker6개 인증 경계 GET PASS(14:40:34 KST). 추가 SW·manifest·entry·배너8GET·해시 및 정확한 CI artifact 전체 해시도 PASS(14:42:11). [CI 기록](./pwa-ci-release.json), [공개 파일 검증](./public-verification.json).
- GameView, Worker `a7f48e4a-5924-476f-9be1-bef31e1833a5`, D1, 먹이·성장 기준·카탈로그·전환version1 및 기존 서버저장/백업 설정은 변경하지 않았다.
- 정상 학생 새390×844 컨텍스트의 공식 entry, 레벨2/body1/EXP2/17/먹이495 확인. GET200 fed5/revision31/earned500/available495/transition1/noticeSeen true는 배포 전후 동일. 오류·가로넘침·진행 중 성장phase·먹이 POST 없음. [공개 학생 읽기 검수](./live-ui-verification.json). 실제 학생 live-390.png는 공유 root 로컬 QA에만 보관하며 공개 Git에 넣지 않는다.
- 기존 공지 ID `3ef838fa-f2a6-814a-81cd-eef67010b59c`의 제목만 ‘2.49.2 버전 업데이트 소식’으로 PATCH200. 본문 말투·게시시각·학생 노출·중요 설정 유지. 학생 GET200에서 같은 공지1개 및 최종 제목·본문 일치 확인. [최종 공지](../../releases/liaoliao-update-notice-2026-10-05.md).
