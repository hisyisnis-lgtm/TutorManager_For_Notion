# 강사·학생 앱 배포 완료

최종 PWA **v2.48.1**을 2026-09-13 23:59 KST에 배포하고 9/14 운영 확인을 완료했다.

- 서비스: https://tiantian-chinese.pages.dev
- PWA 소스: main `300ca74ee986af3c14bc13bd5d60fdb410f290bd`, 태그 `v2.48.1`. 기능 변경은 `42e02f3`, CDN 잔존 차단은 `300ca74`.
- Pages: `adec06f5-33d8-44af-a096-ec5cc1a9ea9e`, [배포 고유 주소](https://adec06f5.tiantian-chinese.pages.dev). 842파일 / 43,516,031bytes.
- Worker: `2018e22c-8392-49cf-bdb3-255d65ff4b68`, deployment `cb7ce6d3-11c9-41ba-a399-c98c00c63bfb`, main42e02f3. 376.10KiB / gzip84.01KiB, startup5ms.
- [최종 PWA 배포](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/34764190076), [추가 PWA CI](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/34764077981), [Worker CI](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/34763459168) 모두 성공.

## 포함한 변경

학생 MY는 결제한 시간·남은 수업 시간만 표시하고 보관함과 판다 진입을 유지한다. 강사 수업기록·공지의 입력 이탈/저장 실패 보호, 데이터 갱신 실패·재시도, 학생 코드 복구와 숙제 오류 구분, 알림 후속 처리, 인증된 동의서 원문을 반영했다. 공개 PWA 가격·기존 가격 이미지도 제거했다.

운영 Worker 기준에 필수 기능만 추가해 기존 게임 CAS·인증·분석 동작을 보존했다. 공유 작업 폴더의 별도 WIP, 공개 공식웹·독립 성조게임 Pages 배포는 포함하지 않았다. 상세 선별 범위는 release-preflight.json과 pwa-source-selection.json 및 Worker 의존성 검토에 남겼다.

## 검증

PWA65파일558개, Worker37파일625개, 배포 도구20개 테스트 통과. Worker의 최초 환경 기동/기한 실패는 영향3파일73개를 단일작업자로 재검증했고 원격 CI전체도 성공했다. 빌드·린트 및 디자인감사ERROR0/WARN0. 격리 dev/실제dist 브라우저6묶음, 최종 운영 강사/학생390·1280 총4화면이 통과했다. 런타임/정적자산 오류와 가로 넘침은0건이다.

최종 842파일의공개텍스트15개 가격검사 통과. 실제 entry `index-BqXB2EuT.js`와 `sw.js`가 CI아티팩트 SHA256과 일치하고 Service Worker가 직전버전과 달라졌다. `Cache-Control: public, max-age=0, must-revalidate` 응답을 확인했다.

## 구 공개 자산의 CDN 잔존 차단

v2.48.0 배포파일에서는 구가격번들을 제거했지만, 캐시우회없는 구주소는 CDN HIT로 이전파일을 반환했다. Cloudflare [Pages 자산 보존](https://developers.cloudflare.com/pages/configuration/serving-pages/)에 따라 삭제된 자산이 캐시에 남을 수 있어, [자산보다 우선하는 redirect](https://developers.cloudflare.com/pages/configuration/redirects/)로 정확한 구JS2개·이미지2개 주소를 앱 진입으로302 전환했다.

로컬 Cloudflare 라우터와 최종 운영/고유배포의4주소(총8개)를 캐시우회없이 확인해 모두302, Location /를 받았다. 현재가격본문이해당구주소에서다시반환되지않는다. 전역캐시정리·기존배포전체삭제·다른프로젝트설정변경은하지않았다.

## Worker·D1·자동화

기존 GAME_DB에 `0003_notification_followups.sql`의새테이블과인덱스만추가했다. 기존업무·게임·인증테이블은수정하거나삭제하지않았다. 적용전 D1 bookmark는 `00000153-00000000-000050e5-8e209c0c9ae678522740de70a81d19fd`이다. GitHub일반변수 `NOTIFICATION_FOLLOWUP_URL`을 `https://tutor-manager-proxy.hisyisnis.workers.dev/notification-followups/ingest`로설정·재조회했다. 기존시크릿은보존했다. Worker운영태그와8개GET인증경계(비인증401/금지Origin403)를확인했다.

실제운영로그인·OTP·알림발송·업무저장·동의서제출·결제/환불을검수용으로실행하지않았다. UI흐름은격리응답으로, 운영은진입/정적자산/인증경계로확인했다. 롤백이필요하면이전PWA v2.48.0/Pages afd1df53와Worker60d9b489를검토하되운영롤백·D1삭제는자동실행하지않는다.

## 기록

- verification.md: 배포전브라우저검수.
- pwa-deploy-verification.json: CI소스/산출물·운영SHA·8개구주소302.
- worker-deployed.json: Worker버전·번들SHA·D1·인증경계.
- live-v2-48-1-entry-browser-results.json: 최종운영4화면.
- 전체CI release manifest와스크린샷은동일QA폴더및GitHub배포아티팩트에보존했다. 공유 architecture.md를최신상태로갱신했다.
