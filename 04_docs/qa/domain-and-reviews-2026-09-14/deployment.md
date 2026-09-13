# 구매 도메인 수강료·공식웹 후기 배포 — v2.48.3

2026-09-14 공식웹을 먼저 공개하고 PWA를 태그로 배포했다. 두 배포와 운영 검증을 모두 완료했다.

| 대상 | 운영 주소 | Pages 배포 ID |
|---|---|---|
| 개별 공유 수강료 | https://tiantianchinese.com/pricing/ | `6a2cff10-b412-4c42-a652-1f10f81e01e7` |
| 공식웹 수강생 후기 | https://tiantianchinese.com/reviews/ | 위 공식웹 배포와 동일 |
| 강사·학생 PWA | https://tiantian-chinese.pages.dev | `505a0f76-9af3-40c0-8c86-a7b09288f5fa` |

- 소스: main `8cbf6a3daccf668cc477fb85abf2f5982e47ebbf`, PWA 태그 `v2.48.3`.
- PWA CI `34768318089`, 자동 실행된 Worker CI `34768318056`, PWA 배포 `34768548390` 모두 성공.
- 공식웹 고유 주소: https://6a2cff10.tiantianchinese.pages.dev . 직전 배포는 `03f92a8a-b9b0-4aca-ad0e-4f0bd8c5a3e4`.
- PWA 고유 주소: https://505a0f76.tiantian-chinese.pages.dev . 직전 배포는 `f053f6b3-5621-48ed-902f-771286e7a979`.

## 실제 변경

강사 설정의 수강료 복사 주소를 구매 도메인의 `/pricing/`으로 변경했다. 수강료 페이지는 기존 가격·조건을 유지하면서 소개 탭을 제거했다. 로그인 없이 직접 공유하는 안내이며 HTML과 해당 자산에 `noindex, nofollow`를 적용했다. 공개 홈페이지·게임 메뉴와 사이트맵에는 수강료 링크를 추가하지 않았다.

후기는 가격표의 탭으로 만들지 않았다. 공식웹의 상단·모바일·푸터 메뉴에 `/reviews/`를 추가하고 기존에 확인한 수강생 후기와 블로그 원문 3개를 표시한다.

강사·학생 앱의 `.pages.dev` 주소와 로그인·학생 기록 저장 방식은 유지했다. 별도 가격 진입점은 앱 인증·서비스워커를 실행하지 않는다. 기존 `/pricing` PWA 링크도 유지한다. Worker, D1, DNS, 사용자 도메인 등록이나 권한을 변경하지 않았다. 구매 도메인은 이미 공식웹에 연결되어 있어 DNS 조회 권한 추가가 필요하지 않았다.

## 공식웹 보존과 산출물

현재 공유 작업 트리의 공식웹 전체 소스를 배포하지 않았다. 운영 원본 920파일에서 검수한 산출물만 조립했다.

- 최종 935파일 / 110,113,440바이트. 공개 자산 933개와 `_headers`, `_redirects` 2개 구성.
- 업로드 24개, 기존 Cloudflare 자산 909개 재사용. 기존 908파일의 내용이 바이트 단위로 동일하다.
- 기존 9개 페이지는 Header·Footer의 후기 메뉴와 승인된 기존 문구 정리 외 HTML을 보존했다. 게임 본체 `/game/tone/`의 22파일은 모두 해시가 같다.
- 교재 안내의 ‘출간 일정과 가격’ 4곳과 게임 목록의 ‘무료 플레이’ 1곳을 정리했다. 이것은 운영 원본에 남아 있던 문구이며 새 가격 노출을 허용한 것이 아니다.
- 미참조 옛 `/_astro/WorkbookCheckout.R5WACr9n.js` 하나만 새 묶음에서 제외하고, 동일 주소를 `/books/`로 302 이동시켰다. CDN에 남는 이전 파일 응답도 직접 확인했다.
- `robots.txt`와 sitemap index는 그대로 유지하고 sitemap에는 `/reviews/`만 추가했다.
- 이후 공식웹 배포에서도 `pwa/npm run build:pricing`의 산출물을 `/pricing/` 아래에 포함해야 한다. 일반 Astro 빌드만으로 이 공유 페이지를 덮어 없애지 않도록 주의한다.

선별 소스 3개는 `source-snapshot/`에, 전체 비교·의존 자산과 해시는 `source-manifest.json`, `stage-manifest.json`에 보관했다. 실제 조립은 `assemble-stage.mjs`에 기록했다. 원래 작업 트리의 다른 변경은 커밋하거나 되돌리지 않았다.

## 검증 결과

- PWA 전체 65파일 559개 테스트 통과. 원격 CI와 태그 배포에서도 전체 검사 통과.
- 공개 가격 검사 테스트 6개와 배포 보호 도구 회귀, lint, build, 디자인 감사 ERROR 0 / WARN 0 통과.
- 공식웹 전체 가격 검사: 텍스트 33개 검사, `/pricing/assets/pricing-4IH8T82A.js` 하나만 공유 페이지 조건으로 허용.
- 실제 로컬 가격표 390/1280px, 공식웹 390/1024/1280px에서 메뉴 이동·본문·이미지·44px 원문 버튼·하단 접근·가로 넘침·콘솔을 확인했다.
- 실제 운영 브라우저에서도 후기 메뉴·원문 3개와 가격 링크 없음, 수강료 이미지 3개·탭 없음·검색 제외를 확인했다. 가로 넘침·콘솔 오류 0.
- 운영/고유 URL의 `/pricing` 308→`/pricing/`, 가격 HTML·JS 200 및 `noindex, nofollow`, `/reviews/` 200, 옛 checkout 자산 302→`/books/`를 확인했다. 구매 도메인의 후기 페이지에는 검색 제외 헤더가 없다.
- 공식웹 변경·추가 자산과 기존 게임을 포함한 49개 실제 응답의 SHA-256이 검수한 파일과 일치했다.
- PWA 843파일 / 43,547,862바이트. 실제 CI 산출물과 운영 자산의 해시가 일치하며, entry에서 강사 설정의 구매 도메인 복사 주소를 확인했다. `/`, `/personal`, 기존 `/pricing` 모두 HTTP 200.
- 운영 로그인·학생 OTP·업무 저장·알림 발송은 하지 않았다. 강사 설정 복사는 격리된 테스트로 확인했다.

| 실제 운영 PWA 자산 | SHA-256 |
|---|---|
| `/assets/index-DYloNbmU.js` | `92071630983ccae4dfb9d49b47e1b008d362405604b340b900765a8f152b6263` |
| `/assets/PricingPage-B5cVBFBu.js` | `73f3c323514246a6a000aca8f58737b95777e3b648ac154d64bf7c417548279e` |
| `/sw.js` | `01fde48b07f1fbdca4d7520c26041f5bef4b48dadf58320e11222ba8e34fb133` |

위 응답은 모두 `public, max-age=0, must-revalidate`. 가격 전용 청크가 SW 사전 캐시에 없는 것도 확인했다. 로컬 빌드 파일명이 아니라 실제 CI 파일명을 최종 운영 기록으로 사용한다.

## 현재 .dev 범위와 기록

Pages 프로젝트는 같은 계정에서 3개로 확인했다: 강사·학생 `tiantian-chinese.pages.dev`, 공식웹 별칭 `tiantianchinese.pages.dev`, 분석 `hanul-insights.pages.dev`. Worker는 대부분 API지만 `tutor-manager-proxy.hisyisnis.workers.dev/game/dashboard`에 관리자 통계 HTML이 있다. 상세 라우트와 이동용 주소는 `verification.md`에 구분했다.

운영 증거는 `site-live-verification.json`, `pwa-live-verification.json`, `cloudflare-routing-local.json`이며, 공용 `architecture.md`에 실제 배포 ID와 독립 가격표 빌드 보존 구조를 기록했다. 앱이 이미 설치된 기기는 업데이트를 적용한 뒤 새 설정 복사 주소를 사용할 수 있다.
