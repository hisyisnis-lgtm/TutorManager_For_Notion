# 랴오랴오 배포 진행 기록

2026-10-05 KST. 사용자 배포 재개 요청 후 진행.

## Worker 및 D1 완료

- 최초 조회에서 판다 두 테이블이 없었고, 미적용 마이그레이션은 0005/0006 두 개뿐이었다. 기존 서버 판다 기록은 없어 사전 판다 export 대상이 없었다. 옛 기기 로컬 기록의 백업 완료를 뜻하지 않는다.
- 0005_student_panda.sql 및 0006_panda_transition.sql 적용 성공. 기존 성조게임/인증/업무 테이블 및 마이그레이션 이력 보존.
- 서버 전용 main: `9ff670a8166dea3735e86d1d2b923ca63863d2ee`. 이전 운영 `d05328ea619f75fdedcbdeba4e32cac30b33feaf`의 후손.
- Worker version `a7f48e4a-5924-476f-9be1-bef31e1833a5`, 100%, deployment `91b16e43-1bf1-44cf-86ae-e2be43e03d07`.
- 업로드 419.25 KiB / gzip 93.90 KiB, startup 5 ms. URL https://tutor-manager-proxy.hisyisnis.workers.dev
- 전체 45파일/841 tests, dry-run, 운영 이력 및 6개 인증/CORS 경계 GET PASS. 가드 후검증 시각 2026-10-04T17:58:19.498Z.
- 기존 공식문의 이메일·성조게임 온보딩·인증·학사 경로/바인딩/cron 유지. 공유 dirty Worker를 통복사하지 않았다.
- 판다 백업·격리 로컬 복원 및 비밀값 없는 인증 진단을 포함한 운영 서버 이력을 PWA 후보 main에 병합했다. 원격 main `c00329ac82bf408308b8b832dfbb63a400526b02`까지 일반 fast-forward push 완료.
- PWA v2.49.0은 전체 84파일/877 tests PASS, 서버 저장 플래그를 켠 빌드 및 디자인 감사 ERROR/WARN 0. 처음 CI는 누락된 테스트 전역 선언 1줄로 lint에 실패했고, 해당 선언만 보완해 전체 로컬 ESLint 및 최종 main CI 37224526874가 통과했다.

## 정상 인증·백업 및 출시 준비 완료

- 정상 인증된 TEST 학생은 초기 earned 23 / fed 0 / available 23에서 먹이 1개를 사용해 fed 1 / available 22가 됐다. 같은 요청 재전송은 추가 차감 없이 revision 1을 유지했고, 같은 ID에 다른 payload는 409였다. 전환 안내 확인 후 재조회에서 revision 2 / transition v1 / startingFood 23 / noticeSeen true와 최초 initializedAt이 유지됐다. 두 새 브라우저 컨텍스트에서 판다 캐시 없이 서버 복원이 확인됐고 320/390/1280px 실제 후보 화면의 가로 넘침·페이지 오류가 없었다. [정상 세션 근거](../panda-release-2026-10-05/live-validation.md). 개인 식별자·인증값·학생 화면은 Git에 넣지 않았다.
- 최초 백업 실행은 자동 승인 검토가 거절했으나, 사용자가 두 판다 테이블만 기존 비공개 `tutormanager-backup/panda-backup/`에 저장하고 다운로드·격리 복원을 진행하는 범위를 명시적으로 추가 승인했다. 이후 workflow가 실행됐다.
- 실행 37223189308에서 전용 토큰 active와 지정 DB 메타데이터 조회는 HTTP 200이었으나 D1 Read의 export가 Cloudflare 10000으로 거절됐다. 사용자가 같은 계정 범위의 전용 토큰을 D1 Edit로 변경한 뒤 [실행 37223657743](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/37223657743)이 성공했다. 프로필 1개/거래 2개 export → 비공개 R2 업로드·재다운로드 → 무결성 검사 → 새 로컬 SQLite에 1개/2개 복원 → 완료 표식 업로드를 확인했다. 운영 DB로 복원하지 않았고 다른 배포 자격증명으로 대체하지 않았다. 객체 prefix는 `panda-backup/2026-10-04-37223657743-1`이다.
- 사용자가 두 지속 설정 활성화를 명시적으로 승인한 뒤 `VITE_PANDA_SERVER_PERSISTENCE=true`, `PANDA_BACKUP_ENABLED=true`를 확인했다. 일일 백업은 KST 04:00, 같은 두 테이블/동일 비공개 R2 prefix에 한정한다.
- readiness 6항목 모두 verified, [출시 근거](../panda-release-2026-10-05/rollout-verification.md).

## PWA v2.49.0 공개 완료

- 태그 `v2.49.0`은 검증된 깨끗한 main `c00329ac82bf408308b8b832dfbb63a400526b02`에서 발행했다. 이전 운영 v2.48.9의 이력과 직전 세션 코드 자산을 보존했다.
- 운영 https://tiantian-chinese.pages.dev, 고유 https://9d859e69.tiantian-chinese.pages.dev, Pages deployment `9d859e69-df8b-434a-8bf1-3acdfdd200c2`.
- 892파일/50,058,224bytes. 진입 파일 `index-C7NjoKsY.js` 595,700bytes / gzip176,319bytes, 버전 2.49.0.
- [태그 실행 37224725459](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/37224725459)은 검사·빌드·업로드 성공 후 공식 주소의 새 JS가 일시적으로 다른 응답이라 후검증만 실패했다. 고유 주소 검사는 당시 통과했다. 최초 실패를 성공으로 바꾸어 기록하지 않았다.
- 재배포 없이 정확한 CI artifact를 내려받아 2026-10-05 03:35:45 KST에 기존 검사 함수를 다시 실행했다. CI 전체 파일 해시 일치, 고유/공식 각2라우트+18자산 해시, SW/manifest/entry/최종 숲 배너의 200·해시 및 Worker6인증경계 GET이 통과했다. CDN 반영 지연으로 추정한다. [원본 CI 기록](../panda-release-2026-10-05/pwa-ci-release.json), [별도 성공 후검증](../panda-release-2026-10-05/pwa-postdeploy-verification.json).
- 공개 후 정상 TEST 세션의 새 브라우저에서 v2.49.0 및 업데이트 팝업의 알 재시작·누적 먹이 전액 안내를 확인했다. MY 배너358×112px, 좌측 DIM, 실제 학생 stage0와 애니메이션1개, 배너→게임 이동 및 먹이22·옛 로컬 성장176 보존이 확인됐다. 가로 넘침·콘솔·페이지 오류0. 실제 학생 화면 캡처는 공유 root 로컬 QA에만 보존하고 Git에서 제외했다.
- 2026-10-05 03:39 KST 정상 강사 인증으로 중요 공지를 게시했다(POST200). 학생 공지 조회200에서 동일 ID·제목·내용과 중요 표시를 확인했고 같은 제목은 1개였다. 공지 ID `3ef838fa-f2a6-814a-81cd-eef67010b59c`. [최종 공지 기록](../../releases/liaoliao-update-notice-2026-10-05.md).
- 공용 architecture.md와 Codex 링크 메모리를 Worker/D1/백업/PWA 실제 상태로 갱신했다. 태그 재작성, 가드 완화, 운영 롤백은 하지 않았다.
