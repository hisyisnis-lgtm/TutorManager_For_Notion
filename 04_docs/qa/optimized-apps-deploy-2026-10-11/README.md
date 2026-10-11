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
- 실행 차이 기록: production main의 worker/package.json 배포 스크립트가 기존 `wrangler deploy`여서 `npm run deploy`는 직접 배포했다. 사전 guard 검사 및 소스 이력은 확인했지만 이 호출에는 keep-vars 및 Source commit annotation이 없었다. 실제 두 버전의 바인딩 일치를 확인했고 새 version/etag/검증 번들 SHA를 worker-release-baselines.json에 등록해 운영 소스 이력을 연결했다. 후속 배포는 `node 02_devtools/release-guard.mjs deploy-worker`를 명시적으로 실행한다.
- 증거: worker-candidate-tests.log, worker-release-guard-check.log, worker-deploy.log, worker-smoke.json, worker-release.json. 원본 버전 메타데이터는 로컬 QA에만 보관하며 시크릿 값은 읽거나 저장하지 않았다.

## PWA 상태

선별 후보 검증 및 태그 배포 진행 중. 최종 태그·Actions·공개 자산 검증 결과는 완료 후 이 문서에 기록한다.

## 롤백 경로

Worker: Cloudflare Workers & Pages → tutor-manager-proxy → Deployments에서 직전 `a7f48e4a-5924-476f-9be1-bef31e1833a5`를 Promote. CLI 이력 재작성은 사용하지 않는다.

PWA: deploy-pwa.yml을 이전 태그 v2.49.2로 수동 실행하거나 Cloudflare Pages → tiantian-chinese → 직전 배포를 Rollback. 실제 롤백은 수행하지 않았다.
