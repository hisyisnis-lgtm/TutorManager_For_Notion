# 강사·기존 학생앱 성능 개선 배포 — 2026-10-11

사용자의 이용 안전성 확인 후 배포 요청에 따라 최신 운영 v2.49.2와 Worker 소스를 기준으로 필요한 최적화만 선별했다. 원래 feature/game-design-pass 작업 트리와 미출시 변경은 보존했다. 별도 main 체크아웃에서 배포하며 운영 태그와 Worker 이전 커밋의 선행 이력을 확인했다.

## 배포 범위

- 기존 강사·OTP 학생앱: 화면 lazy import, SW 등록 대기 제거, 게임/온보딩 폰트 지연, 성공한 데이터부터 표시, 독립 조회 병렬화, 반복 읽기 공유, 결제 원장 두 필드 투영, 월 집계 공유, 캐시 제한·파싱 재사용, 오류·미확인 상태 구분.
- Worker: 기존 강사 Notion 프록시의 전체 문자열 복사를 제거하고 body 스트리밍, 재시도할 429 본문 정리. 인증·DB 접근 제어·no-store·상태 코드·재시도 정책 유지.
- 회원 JOIN/새 학생 제공 권한 조회 최적화는 현재 운영 코드에 해당 경로가 없으므로 이번 배포에 포함하지 않았다. 새 홈페이지 회원·결제/상점/NICEPAY·별도 /personal/ 쿠키 앱·리뷰·게임·사이트 전환 WIP 및 D1 마이그레이션은 제외했다.
- 현재 운영 학생앱은 기존 PWA의 개인 학생 링크로 이용한다. 공식 홈페이지 /personal/에 새 회원 앱을 출시하거나 개발 화면의 학생 제공 API를 활성화한 배포가 아니다.

## Worker 배포 완료

- main source `709b5636850063af01141c3ff4b1be6eed49600e`; 이전 운영 `9ff670a8166dea3735e86d1d2b923ca63863d2ee`와 최신 PWA 태그 v2.49.2의 후손.
- version `2b65074b-cd8c-403c-b321-db5a6441d436`, 100%. URL https://tutor-manager-proxy.hisyisnis.workers.dev
- 419.39 KiB / gzip 93.91 KiB, startup 5 ms. 기존 419.25 KiB / gzip 93.90 KiB와 비교해 테스트 소스가 번들에 들어가지 않았고 실행 코드 소폭만 늘었다.
- 선별 후보 전체 47파일/850 tests, release guard의 동일 소스 검사·dry-run, main CI 38117853753 PASS. 이전 1,403 tests는 미출시 회원 기능을 포함한 공유 WIP의 검사이며 이 배포 후보의 수치가 아니다.
- 배포 후 인증/CORS 6개 경계 GET PASS. 기본 no-Origin GET 403은 의도된 접근 제어 응답이다. 이전·새 버전의 35개 바인딩 전체가 동일하여 plain vars·시크릿 이름·D1/AE/이메일 바인딩을 보존했다. 운영 DB·알림·결제·학생 권한 쓰기는 실행하지 않았다.
- 실행 차이 기록: production main의 worker/package.json 배포 스크립트가 기존 `wrangler deploy`여서 `npm run deploy`는 직접 배포했다. 사전 guard 검사 및 소스 이력은 확인했지만 이 호출에는 keep-vars 및 Source commit annotation이 없었다. 실제 두 버전의 바인딩 일치를 확인했고 새 version/etag/검증 번들 SHA를 worker-release-baselines.json에 등록해 운영 소스 이력을 연결했다. 후속 배포는 `npm run deploy`도 `node ../02_devtools/release-guard.mjs deploy-worker`로 연결하여 변수 보존·소스 annotation·이력 검사를 적용한다.
- 증거: worker-candidate-tests.log, worker-release-guard-check.log, worker-deploy.log, worker-smoke.json, worker-release.json. 원본 버전 메타데이터는 로컬 QA에만 보관하며 시크릿 값은 읽거나 저장하지 않았다.

## PWA 상태

- 태그 `v2.49.3`, main source `95cb9a8159f70f2e2e8217b854bbf1310936d5fa`. [Actions 38119595192](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/38119595192) 성공, 2026-10-11 15:56 KST 배포 후 검증 완료.
- Pages deployment `e2ceb14a-e8de-4737-8d92-9f5d1fd07327`. 공개 https://tiantian-chinese.pages.dev 및 고유 https://e2ceb14a.tiantian-chinese.pages.dev. 직전 deployment `967fdba6-8daf-410f-a52e-0b3742e48bb1` 보존.
- 선별 후보 전체 92파일/1,005 tests PASS. lint ERROR 0(기존 경고 66), design audit ERROR/WARN 0. 두 main CI(38118946080/38118946089) 및 태그 동일 소스 guard PASS. 최종 생산 빌드 precache 247개/7,854.16 KiB이며 이는 첫 화면 JS 용량과 다른 범위다.
- 실제 로컬 선별 후보 + 배포된 Worker로 강사 5탭 첫 방문·재방문 조회, 기존 월 집계·예측 값 일치 확인. 강사 모바일 390×844/데스크톱 1440×900, 지정 TEST 학생의 기존 정상 강사 미리보기 권한으로 홈·수업 일정 조회를 양쪽 크기에서 확인했다. 가로 넘침·콘솔 error/warn 0. 학생 본인 OTP 인증 검수는 아니며 상세 과제의 자동 확인 쓰기·학생 권한 변경·알림/결제·게임 액션은 실행하지 않았다. 실제 데이터 스크린샷·개인 링크는 Git 기록에서 제외했다.
- 공개/고유 URL 각각 HTML 2경로와 143개 자산 해시, 이전 세션 자산 보존, Worker 인증/CORS 6개 GET 경계 PASS. 직접 공개 entry `/assets/index-DKLwIsqG.js` SHA `fdb89c1e15425e5eee86c3c6fac145881ecf163141a1c13e84fcce9ba0b33100`, SW SHA `f91bb8af80d265432f4c0093bc4e49ecea5593998babdc9c8de2c9c0cfd4a6dc`, 버전 2.49.3 마커가 배포 artifact와 일치했다.
- 동일 Node gzip 조건의 실제 운영 v2.49.2 → 배포 v2.49.3 home JS 정적 의존성: 강사 500,773 → 187,030 bytes(62.65% 감소), 기존 개인 학생 500,773 → 201,929 bytes(59.68% 감소). 해당 홈의 entry·lazy 홈·정적 imports를 중복 없이 합산했다. CSS/폰트/이미지/SW 설치/첫 온보딩/다른 탭/API·인증 통신 제외이며 실제 초 단위 속도나 전체 네트워크 감소율이 아니다. 후보 파일 목록 58개 reference가 실제 deployed artifact와 일치했다.
- 기록: `pwa-release.json`, `public-after.json`, `bundle-operational-comparison.json`. 이전 운영 JS 원문과 full artifact는 재현용 로컬 QA/임시에 보관하고 Git에는 공개 검증 JSON만 기록했다.

## 롤백 경로

Worker: Cloudflare Workers & Pages → tutor-manager-proxy → Deployments에서 직전 `a7f48e4a-5924-476f-9be1-bef31e1833a5`를 Promote. CLI 이력 재작성은 사용하지 않는다.

PWA: deploy-pwa.yml을 이전 태그 v2.49.2로 수동 실행하거나 Cloudflare Pages → tiantian-chinese → 직전 배포를 Rollback. 실제 롤백은 수행하지 않았다.
