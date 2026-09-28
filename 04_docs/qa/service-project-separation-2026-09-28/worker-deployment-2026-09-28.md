# Worker 우체국 계정 분리 배포 결과

2026-09-28 20:37 KST · 운영 배포 완료

- URL: https://tutor-manager-proxy.hisyisnis.workers.dev
- 버전: `91d3f82e-2288-4c3a-9b1e-16e9ab3deb87` (100%), deployment `77c6e89e-db0a-4163-997d-9bcd28b39536`.
- 크기: 388.82 KiB / gzip 87.13 KiB, startup 4ms.
- 소스: remote main `199d5bb445131ac95735f2f74bbb95082f50d8db` + finder 전용 10파일(+460/-18), 독립 로컬 main `530c531573e2f3d4aa621261466a144249bdb585`. 원본 작업 트리와 원격 main은 변경하지 않았다.
- 관리 worktree에서 전체 검증 후, 배포의 main 전용 규칙을 지키면서 공유 main을 이동하지 않도록 독립 릴리스 clone을 사용했다. 검증 사본과 배포 소스 78파일이 바이트 단위로 같다.

## 검증

- 전체 Worker 테스트 42파일 782개 통과. dry-run 성공.
- 최초 부분 후보의 전체 검사에서는 01_automation 검증 문맥이 없어 실패했다. 전체 main 체크아웃에서 문맥을 갖춘 뒤 같은 Worker 소스로 전체 검사를 통과했다.
- 이전 운영 번들(389,811 bytes)을 내려받아 78d5c52 기준 소스 재빌드와 바이트 단위 일치를 확인했다. main에 이미 있는 consentTerms 추출은 응답 문구와 인증 동작이 동일하다.
- 배포 직전 운영 버전 경합 없음. 배포 후 받은 실제 번들이 검사한 후보(398,147 bytes)와 바이트 단위로 같다.
- 기존 바인딩·시크릿 이름·compatibility date·cron 보존. 새 시크릿/바인딩 없음.
- 배포 후 14개 인증·CORS·입력 거부 검사 통과: game/finder/학사/통계 인증 경계, 악성 Origin 거부, contact/consult OPTIONS 및 무효 POST, 기존 dashboard 로그인 폼과 무효 쿠키 거부. 익명 루트 403은 기존 Origin 제한에 따른 의도된 응답이다.

## DB 및 복구

- 기존 GAME_DB에 `0004_finder_users.sql`만 적용했다. migration id 5, UTC 2026-09-28 11:36:47. finder_users 테이블과 provider/social_id 유일 인덱스가 추가됐다.
- 기존 회원 기록·닉네임은 수정하지 않았으며 실제 알림·문의 전송은 하지 않았다. 무효 문의 요청의 기존 보안 rate-limit 상태는 정상 경로대로 기록될 수 있다.
- 이전 Worker: `32113c40-6cef-4bf6-93e5-b79d978ab835`, 이전 deployment: `d8f54763-67aa-4429-b7ec-71b545bfe125`. 운영 복구 필요 시 Cloudflare 대시보드에서 이전 버전을 선택한다. 자동 롤백은 하지 않았다.
- DB Time Travel 기준 bookmark: `0000039f-00000000-000050f4-e0a5ee5691a42d8f50f2307a87ab813f`. Worker 복구 때 finder_users와 새 회원 기록을 삭제하지 않는다.

## 남은 검증

실제 소셜 계정 로그인과 기존 설치 PWA의 기기 전환은 이 배포 검증에 포함되지 않는다. 프런트엔드의 OAuth·기기·운영 전환 게이트를 통과로 바꾸지 않았다. 테스트 토큰을 운영 사용자 인증으로 간주하지 않았다.

기계 판독 결과와 전체 번들 비교 기록은 작업 당시 별도 QA 기록으로 보관했다. 이 PR에는 정확한 운영 커밋 자체가 포함된다.

## 배포 소스 보존과 다음 배포 주의

현재 운영 소스 `530c531`은 독립 릴리스 clone main에만 커밋됐고 원격 main `199d5bb`에는 아직 없다. 원격 main을 그대로 재배포하면 finder API가 사라질 수 있다. 초기 점검에서 `02_devtools/release-guard.mjs`는 이전 운영 소스 누락을 차단하지 않는 것으로 확인됐다. 이를 보완하여 깨끗한 커밋 소스만 허용하고, 운영 version ID·script etag에 연결된 검토 기준 또는 정확한 source commit 메타데이터를 확인한 뒤 후보에 이전 운영 커밋이 포함되는지 검사하도록 수정했다. 조회 실패·ancestry 불일치·검사 중 운영 경합은 업로드 전에 중단한다. 이 보호와 운영 커밋은 아직 원격 main에 반영되지 않았으므로, 후속 PR 병합 전 원격 main으로 Worker를 재배포하면 안 된다.

로컬 보존용 `worker-finder-release.bundle`은 9,450 bytes의 증분 Git bundle이며 정확한 commit `530c531573e2f3d4aa621261466a144249bdb585`를 보존한다. 기준 `199d5bb445131ac95735f2f74bbb95082f50d8db` 객체가 필요하다. `git bundle verify` 통과. 이번 10파일 코드·테스트 변경만 새 객체로 포함하며 환경 파일·시크릿 값·운영 회원 기록을 포함하지 않는다. SHA256: `a083f26b5261dba658f76efd5a839a3b67039367ef7b75da6d73679282af4b89`.

복구 시 기준 main 객체가 있는 체크아웃에서 bundle을 별도 복구 ref로 fetch한 뒤 검토한다. 복구 과정에서도 현재 공유 작업 트리를 reset하거나 운영 DB의 finder 테이블을 삭제하지 않는다.

## 소스 보존 보호 검증

- Root 배포 보호 테스트 31개와 분리된 530c531 릴리스 clone 테스트 24개 통과. Pages 관련 기존 작업을 이식하지 않고 Worker helper·배포 경로·해당 테스트·운영 기준 파일만 변경했다.
- 실제 Cloudflare version metadata로 읽기 전용 검증: 원본 checkout은 정확한 530c531 Git 객체가 없어 차단, 해당 객체가 있는 릴리스 clone은 version/etag/ancestry를 통과했다. 운영 추가 배포는 하지 않았다.
- `worker-release-baselines.json`에는 검증한 현재 운영 버전 1개만 등록했다. version `91d3f82e-2288-4c3a-9b1e-16e9ab3deb87`, script etag `c30f104fb7b215977adad9ec419856c627f8bb1ff4dcf3c9a1fb285ed49a0a93`, bundle SHA256 `3f74f73d81061623545d8c1107c2f69be70bbb07b334ed4bc7aa89a184045ba1`.
- PR 병합은 운영 커밋 `530c531573e2f3d4aa621261466a144249bdb585`를 ancestry에 보존해야 한다. squash·rebase·cherry-pick으로 커밋 해시를 바꾸면 이 검증을 통과하지 않는다. 정상 merge 또는 fast-forward로 보존한다.
- 이 보호는 `release-guard.mjs deploy-worker` 경로에 적용된다. 직접 Wrangler를 호출하는 별도 경로까지 자동으로 강제하는 서버 정책은 아니다.
