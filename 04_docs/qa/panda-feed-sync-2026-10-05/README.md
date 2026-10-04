# 랴오랴오 먹이 연출 동기화 검수 — 2026-10-05

먹이 버튼 입력 시 수량을 전부 표시상 차감하고 서버 응답 때 성장 수치를 먼저 바꾸던 순서를 수정했다. 먹이 도착마다 잔액·EXP를 반영하고, 저장 성공과 마지막 먹기 동작 종료를 확인한 뒤 성장 연출로 이어진다. 연출 공개 시 캐릭터·레벨·파츠 해금이 함께 바뀐다. 늦은 서버 응답은 먹는 동작을 다시 시작하지 않는다.

## 검증

- 관련 4개 테스트 파일: 123개 통과. 연속 먹이, 5개 초과 입력, 빠른/느린 응답, 실패·충돌·재시도, 모션 감소, 레벨 6→7 파츠 해금과 상점 선택 유지 포함.
- 실제 로컬 Chromium: 390×844에서 정상 x5(999ms), 서버 응답 8초 지연, 응답 유실 후 같은 요청 재시도 검증. 320×568에서 거절된 요청의 먹이·EXP 복원 검증.
- 8초 응답: 먹기 완료 후 저장 안내, 성공 후 성장 연출. 대기 중 레벨2/이전 캐릭터 유지, reveal에서 레벨3/아기 캐릭터/EXP4 함께 공개. 뒤늦은 eating 없음.
- 응답 유실 재시도: 서버 fedTotal 19→24, revision 1, 처리 영수증 1개 유지. 재시도 후 먹이0, 레벨3, 중복 차감·뒤늦은 eating 없음.
- 거절: 화면 먹이5·EXP16으로 복원, 서버 fedTotal19 유지, 성장 연출 없음.
- 22개 연속 입력(5×4+1×2, 응답999ms): 서버 fedTotal1→23/revision6/영수증6. 두 단계 성장 연출을 순서대로 마친 뒤 레벨3·먹이0 확정. 9.3초의 중간 레벨2 샘플은 아직 연출 진행 중이었으며, 종료까지 기다린 15.6초 최종 샘플로 판정했다.
- 검수한 모든 화면 가로 넘침과 pageerror 없음. 안정된 소스 상태의 HMR 없는 실행만 증거로 채택.
- npm run build 통과. 디자인 감사 ERROR0/WARN0. 변경 네 파일 ESLint ERROR0(기존 테스트의 미사용 import WARN1).

검수 API는 로컬 fixture이며 운영 학생 데이터를 변경하지 않았다. fixture 지연 옵션만 최대15초까지 확장했다. 이 fixture는 배포 앱에서 import되지 않는다. 서버·D1·성장 기준·전환 버전은 변경하지 않는다.

## 증거와 접속

- [시점별 기록](./browser-evidence.json)
- [거절 복원 화면](./rejected-320.png)
- [응답 유실 재시도 완료 화면](./retry-390.png)
- [로컬 지연 검수](http://127.0.0.1:5212/screen?fed=19&available=5&delay=8000&reset=1)

## 운영 배포 및 후검증 완료 — v2.49.1

- 깨끗한 격리 main `e36861633ba1326564541c2c5960c1ee7bb024a3`에서 태그 `v2.49.1` 발행. 승인 UI4파일, 검수 fixture/근거, package/lock 버전만 포함했다. 공유 작업 트리의 무관한 작업은 보존했다.
- [main CI 37229157784](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/37229157784) 및 [태그 배포 37229279458](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/37229279458) 모두 성공. 전체84파일/885tests, lint, 디자인 ERROR/WARN0, build 통과. 이번 배포는 후검증 실패나 재배포 없이 완료됐다.
- 운영 https://tiantian-chinese.pages.dev, 고유 https://f09abb82.tiantian-chinese.pages.dev. Pages ID `f09abb82-73ca-4b57-96de-b04d25ce4d7b`. 직전9d859e69/v2.49.0의 세션 코드 자산을 보존했다.
- 890파일/48,904,739bytes. 새 entry `index-DqZaFkaW.js` 597,233bytes / gzip176,946bytes.
- CI에서 고유/공식 각2라우트·16자산 해시 및 Worker6개 인증 경계 GET 통과(04:44:11 KST). 정확한 CI artifact 전체 해시와 고유/공식 SW·manifest·새 entry·배너8개 GET·해시도 통과(04:46:01). [원본 CI 기록](./pwa-ci-release.json), [공개 파일 검증](./public-verification.json).
- Worker `a7f48e4a-5924-476f-9be1-bef31e1833a5`, D1, 성장 기준·카탈로그, 전환 version1, 서버 저장·기존 백업 설정은 변경하지 않았다.
- 정상 학생 세션의 새 공식 브라우저390×844에서 업데이트 팝업 CTA→게임 실제 진입 확인. 레벨3/body2/EXP4/28/먹이0/idle, 가로넘침·알림오류·pageerror0. GET200의 fed24/revision25/earned24/available0/transition1/noticeSeen true는 배포 전과 동일하며 운영 먹이 POST는 실행하지 않았다. [공개 학생 화면 검수](./live-ui-verification.json). 실제 학생 화면 캡처는 공유 root 로컬 QA에만 보관한다.
- 기존 공지 ID `3ef838fa-f2a6-814a-81cd-eef67010b59c`의 제목만 ‘2.49.1 버전 업데이트 소식’으로 PATCH200. 본문 말투·게시시각·학생 노출·중요 설정 유지. 학생 GET200에서 같은 ID1개 및 내용 일치 확인. [최종 공지](../../releases/liaoliao-update-notice-2026-10-05.md).
