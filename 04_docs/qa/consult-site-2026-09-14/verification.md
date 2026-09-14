# 상담 신청 공식웹 이전 검수

공식웹 /consult/에 기존 상담 신청을 이관한다. 이름·전화번호와 기존 선택입력은 유지하며 중복 신청과 실패 시 입력 손실을 막는다. 기존 소개 주소는 수업 안내로, 상담 탭 진입은 새 상담 신청으로 이동한다.

- 최신 main f8be993에서 격리했다. 운영 기준: Worker2018e22c(source42e02f3), 공식웹014aca80, PWA49cf77aa(v2.48.4).
- Worker는 공식 출처3개의 /consult POST와 해당 OPTIONS만 허용했다. 인증·다른 라우트·바인딩·시크릿은 유지했다. 관련인증18tests와 dry-run376.66KiB/gzip84.16KiB 통과.
- PWA는 LandingPage·관련테스트2개·버전2.48.5만 수정했다. 전체65파일560tests, 빌드, lint0errors(기존68warnings), 디자인ERROR0/WARN0, 공개가격검사 통과. 최초컴파일후 .env 없는격리환경을확인해최종빌드는 운영Worker URL을명시했다.
- 사이트 form9개검증과 실제390/1024/1280브라우저에서 메뉴·입력·실패보존·중복클릭1회·완료focus를확인했다. 상담 이전 검수 당시943파일 staging에서도 POST폼1개, JS수화후활성, 가로넘침0·consoleerror0을확인했다. 운영 상담신청은생성하지않았다.
- 기존10페이지는 Header상담버튼과 CSS참조만갱신했고, lessons는사용자요청에따라 ‘수강생이 말하는 하늘하늘’ 후기섹션만삭제하고나머지기존본문을보존했다. 마지막배너의CTA/카카오보조링크/여백조정은유지했다. 공유WIP의3단계설명섹션은제외했다. Footer본문은기존운영그대로다.
- 공식웹938원본중927파일불변. 가격12파일·게임24파일·기존후기사진/CSP 유지. /consult/와필요자산4개만추가하고sitemap에는/consult/만추가했다. 11페이지실행스크립트45개/스타일13개CSP해시와공개가격검사통과.
- 전체site WIP를배포하지않았다. source-snapshot의 승인 8개 소스와 assemble-stage.mjs/stage-manifest.json이선별범위근거다. PWA/Worker는명시된4소스와버전외변경없다.

배포순서는 Worker→공식웹→PWA이며 최종 운영 ID와 검증은 deployment.md에 기록한다.

최종 staging 추가 검수: 수업 안내의 배너 CTA 클릭→/consult/ 이동 정상. 모바일390px에서 폼334.67px·제출버튼52px·가로넘침0, 모바일메뉴상단 상담신청 노출. HTML connect-src에 운영 Worker, canonical에 공식 /consult/를 확인했다.

후속 후기섹션 삭제 검수: Astro11페이지 재빌드 후 새 staging943파일 중 /lessons/index.html 하나만 달라지고 나머지942파일 해시가 동일하다. 해당페이지 CSP와 localhost5199 응답 일치를 확인했다. PWA·Worker는 재검사하거나 변경하지 않았으며 커밋·푸시·배포·승인 재시도는 수행하지 않았다.

후속 블로그 후기 카드 높이 조정: reviews-page 전용 CSS의 썸네일비율4:3→16:9, 본문gap24→12px, padding32→20px만수정했다. HTML본문·제목·버튼·사진주소·원문링크는동일하다. 11HTML은CSS참조만갱신되고나머지932파일이동일하며,이전수업안내후기섹션삭제도유지했다. 기존검수CSS를보존해최신staging은944파일이다. 새CSS는 Footer.B3KOyrUM.css이며source snapshot·manifest·review-card-spacing-check.json에기록했다. 커밋·배포·승인재시도는없다.

최종 후기 카드 시각 검수: PC 1280px에서 카드 높이 539.23 → 407.48px, 모바일 390px에서 502.23 → 379.73px로 각각 약 24.4% 감소했다. 세 카드 높이가 같고 제목 잘림 0, 버튼 44px, 이미지 3개 정상 로드, 가로 넘침 0, 콘솔 오류 0을 확인했다. 뷰포트를 복원하고 최신 http://127.0.0.1:5199/reviews/ 화면을 표시했다.

후속 후기 목록 배치 변경: 번호를 제거하고 제목·출처를 묶었으며 작성자와 기존 원문 버튼을 하단 행으로 정리했다. 카드 비율은 5:4로 고정하고 가로 스크롤·스크롤 스냅·얇은 스크롤바를 적용했다. 목록은 키보드로 포커스할 수 있다. 원문 링크·썸네일 주소·이미지 실패 처리와 목록 밖 본문은 동일하며, 다른 10개 HTML은 CSS 참조만 바뀌었다. 최신 staging은 945파일, CSS는 Footer.Cby1GHqH.css다. 수업 안내 후기 섹션 삭제·가격표·게임을 유지했고 source snapshot 8개와 manifest를 갱신했다. 커밋·배포·승인 재시도는 없다.

최종 가로 스크롤 후기 목록 시각 검수: 실제 staging5199 브라우저에서 PC 1280px 카드 420×336px, 모바일 390px 카드 326×260.79px, 320px 카드 280×224px로 5:4 비율을 유지했다. 번호 없음, 이미지 3개 정상 로드, 버튼 44px, 제목·본문 잘림 0, 페이지 가로 넘침 0, 콘솔 오류 0을 확인했다. PC에서 키보드 ArrowRight로 목록 scrollLeft 0→100px, 모바일에서 오른쪽 스크롤 0→342px 이동을 확인했다.

후속 후기 화살표 변경 및 최종 검수: 기본 스크롤바를 숨기고 사진 중앙에 좌우 44×44px 버튼을 배치했다. 카드 비율 5:4와 기존 원문·썸네일·fallback 스크립트를 유지했다. 새 스크롤 동작 스크립트 1개와 그 SHA-256만 후기 페이지 CSP에 추가했으며 다른 페이지의 CSP는 그대로다. JS 준비 전에는 기본 스크롤을 유지한다. 실제 staging5199에서 PC 1280px 오른쪽 0→100px와 끝 버튼 비활성, 왼쪽 100→0px와 시작 버튼 비활성을 확인했다. 모바일 390px에서는 오른쪽 0→342→675.33px 및 끝 버튼 비활성, 직접 왼쪽 스크롤 675→342px 후 다음 버튼 재활성을 확인했다. 계산된 scrollbar 값 none, 본문과 화살표 겹침 없음, 페이지 가로 넘침 0, 콘솔 오류 0이며 뷰포트를 복원했다. 최신 staging 946파일과 CSS Footer.CTm5mudh.css, CSP·공개가격 검사 통과 근거를 기록했다. 커밋·배포·승인 재시도는 없다.

최종 화살표 위치·상태·투명도 검수: 카드 전체 세로 중앙(top:50%)에 테두리·그림자 없는 검정 버튼을 배치하며 시작에서는 이전 버튼, 끝에서는 다음 버튼을 숨긴다. 최신 사용자 요청에 따라 기본 opacity는 0.65, hover·focus-visible은 1, 전환은 0.18초로 정리했다. 모바일 본문 좌우 padding을 28px로 조정해 320·390px에서 글자 겹침을 해소했다. 실제 브라우저에서 카드 중앙 오차 0, 버튼 44px·카드 5:4 유지, 시작/중간/끝 숨김 상태, 가로 넘침 0·콘솔 오류 0을 확인했다. 실제 마우스 이동으로 opacity 0.65→hover 1→이탈 0.65 복귀를 확인하고 기존 미리보기 탭 17을 새로고침했다. 기존 이미지 fallback·스크립트 5개·가격 12파일·게임 24파일과 수업 안내 후기 섹션 삭제를 보존했다. 최신 CSS Footer.2nUupzbG.css와 949파일 manifest·source snapshot·검사 JSON을 갱신했다. 마지막 CSS 보완은 화살표 투명도·전환 규칙만 변경했고 JS·CSP는 동일하다. 커밋·배포·승인 재시도는 없다.

후기 목록 경계 fade 최종 검수: 가로 스크롤 양끝을 배경색으로 연결하는 얕은 그라데이션을 추가하고 해당 방향으로 더 이동할 수 있을 때만 표시한다. 실제 390px 브라우저에서 시작 left fade 0/right 1, 중간 scrollLeft 342px 양쪽 1, 끝 675.33px left 1/right 0 및 오른쪽 버튼 숨김을 확인했다. PC 1280px의 시작 상태도 left 0/right 1이며 fade 폭은 PC 51.2px·모바일 28px다. pointer-events:none으로 화살표 클릭을 유지하고 페이지 가로 넘침 0·콘솔 오류 0을 확인했다. 끝 카드는 선명하며 미리보기 탭 17 갱신과 뷰포트 복원을 완료했다. CSS Footer.BlizEFQW.css·950파일 manifest·source snapshot을 갱신했다. 후기 스크롤 스크립트 1개와 CSP 해시만 교체하고 기존 스크립트 5개·이미지 fallback·가격 12파일·게임 24파일·이전 수업 안내 삭제를 보존했다. 검증 근거는 review-edge-fade-check.json이다. 추가 빌드·전체 검사·커밋·배포는 수행하지 않았다.

후속 fade 폭 조정: clamp(28px,4vw,52px)에서 clamp(36px,5vw,64px)로만 넓혔다. 기존 탭 17 새로고침 후 390px 화면에서 fade 폭 36px와 시각적 확장을 확인했다. 최신 CSS Footer.DKfNUEhO.css·951파일 manifest·스냅샷을 갱신했으며 HTML 본문·JS·CSP·가격·게임은 동일하다. 추가 브라우저 검사·테스트·커밋·배포는 없다.

메인 하늘쌤 이력 섹션 추가 검수: 운영 Hero SSR 바로 뒤에 정적 teacher-profile 섹션만 삽입하고 기존 Hero.EOj0smUN.js·#learn-preview 이동·아래 본문·스크립트·CSP를 보존했다. 기존 teacher-reference.jpg와 동일한 사진을 사용했으며 400/640/960w WebP 3개(7,546/16,092/34,676 bytes)를 모두 수집해 HTTP 200·해시 일치를 확인했다. 최종 Astro 11페이지 빌드 통과. 실제 staging5199/#teacher-profile에서 PC 1280×900은 사진 460×460px의 좌측 배치와 우측 이력 7행·줄높이 27px, 모바일 390×844는 제목→사진 334.67px→이력 순서와 전체 줄바꿈·하단 표시를 확인했다. 가로 넘침 0·콘솔 경고/오류 0이다. 320px 추가 확인은 브라우저 도구 timeout으로 미완료이며 390px 검수 결과와 구분한다. 다른 10페이지는 CSS 참조만 바뀌고 기존 영상 19개·가격 12파일·게임 24파일 및 이전 후기 조정을 보존했다. CSS Footer.6sH0LFeq.css·955파일 manifest·소스 스냅샷 10개와 teacher-profile-check.json을 갱신했다. 커밋·배포는 수행하지 않았다.

이력 섹션 정돈 최종 검수: 이름·별칭의 크기를 구분하고 이력 7개를 기관/내용의 dl 행으로 정리했다. 데스크톱에서 사진과 소개를 위에 맞추고 사진 4:5, 모바일 사진 1:1과 세로 배치를 적용했다. 실제 1027px 브라우저에서 사진과 소개 top 380.67px 일치, 사진 374.91×468.63px, 이력 행 46px·가로 넘침 없음이 확인됐다. 390×844 및 320×760 모바일에서는 기관/내용 열이 경계 안에 들어오고 프로그램명 줄바꿈·역할 보조글씨·이미지 표시가 정상이며 두 화면을 직접 확인했다. 콘솔 경고/오류 0이다. 이전 320px 도구 timeout 제약은 이번 실제 검수로 해소했다. 이력 외 홈 본문·Hero·JS·CSP, 사진 3개·영상 19개·가격 12파일·게임 24파일을 보존했다. CSS Footer.A_LbBzm6.css·956파일 manifest·소스 스냅샷과 teacher-profile-layout-check.json을 갱신했다. 커밋·배포는 수행하지 않았다.

오색중국어 이력 정정: 사용자 요청에 따라 기관 표기를 〈오색중국어〉로, 역할을 대표 강사에서 제작 및 강의로 변경했다. Astro 11페이지 빌드 및 기존 보존 검증을 포함한 staging 조립이 통과했다. source-snapshot/index.astro와 manifest를 동기화했으며 커밋·배포는 수행하지 않았다.

프로필 사진 크기 축소 검수: 사진 열을 clamp(240px,28vw,320px), 모바일 최대 220px로 줄이고 Image sizes를 맞췄다. 실제 1027px 화면의 사진은 287.65×359.55px로 기존 374.91×468.63px보다 약 23% 작아졌으며, 모바일 390×844에서는 334.67×334.67px에서 220×220px로 줄었다. 이미지 로드와 가로 넘침 0, 데스크톱 상단 정렬 및 모바일 제목→사진→이력 흐름을 확인했다. 〈오색중국어〉 제작 및 강의 문구와 다른 이력은 유지했다. HTML은 이미지 sizes와 CSS 참조만 달라졌으며 Hero·본문·JS·CSP·사진 3개·영상·가격·게임을 보존했다. CSS Footer.CyZGgJMA.css·957파일 manifest·스냅샷과 teacher-profile-size-check.json을 갱신했다. 커밋·배포는 수행하지 않았다.

Contact 페이지 추가 최종 검수: /contact/에 기업·기관 출강과 콘텐츠·브랜드 협업 안내, BUSINESS.email(tiantianchinese_@naver.com)을 받는 mailto 2개 및 주소 복사 버튼을 추가했다. 메일 초안은 회사·기관명, 담당자, 유형, 내용, 일정, 연락처를 포함한다. PC·모바일 내비와 Footer에는 Contact 링크만 추가하고 기존 Footer 문구·홈 Hero·본문·이력·후기·상담 동작을 유지했다. 최종 Astro 12페이지 빌드 통과. 실제 1024/1100px에서 로고–메뉴와 메뉴–CTA 간격 각각 74.79/112.79px로 겹침이 없고 1027px 화면도 확인했다. 모바일 390px 메뉴 진입과 CTA 56px·복사 버튼 44px, 320px 이메일 글꼴 16px·표시 폭 204px·높이 44px의 한 줄 표시 및 가로 넘침 0을 확인했다. 복사 완료 aria-live와 별도 미제출 폼의 Ctrl+V 결과에 업무 이메일이 들어오는 것을 확인했다. clipboard.readText 도구는 빈 값을 반환했으므로 정확한 클립보드 문자열을 API로 조회한 검수로 기록하지 않는다. 콘솔 경고/오류 0이며 실제 메일 발송·상담 POST는 없었다. Contact는 mailto·클립보드만 사용하고 서버/API 호출은 없다. 상담 폼 소스는 그대로이며 config 참조에 따른 청크 이름과 Astro uid/prefix만 갱신됐다. 상담 CSP에는 사용하지 않는 Contact CSS 해시를 제외해 기존 정책을 유지했다. 사진·영상·가격·게임 58개 자산과 기존 945파일을 보존하고 sitemap에는 /contact/만 추가했다. 963파일 manifest·소스 스냅샷 13개·contact-check.json을 갱신했다. 커밋·배포는 수행하지 않았다.

## Contact 문의 폼 전환 — 최신 검수 기록

앞의 「Contact 페이지 추가 최종 검수」는 mailto·주소 복사 방식의 과거 기록이다. 현재 /contact/는 ContactForm으로 대체했으며, 정상 화면에서 문의 유형·기업/기관명·담당자·이메일·내용을 입력해 Worker /contact로 보낸다. HTTP 성공과 정확한 ok:true 응답을 함께 받은 경우에만 완료를 표시한다. 메일 앱 열기와 복사는 주 동선에서 제거했다. JavaScript 미실행·접수 확인 실패 때의 이메일 대체 연락만 유지한다.

- Astro 12개 경로 빌드 PASS. assemble-stage.mjs의 보존 검증 PASS. 최신 staging 964파일이며 manifest에 기록된 source-snapshot 13개 모두 root 최신 소스와 SHA-256이 일치한다. 구 ContactMethods.jsx 스냅샷은 제거했다.
- contact-form-results.json의 11개 검증 PASS, 실패 0, 실제 HTTP·메일 전송 0. 결과의 sourceSha256은 manifest의 ContactForm.jsx 값과 동일하다. SSR POST·수화 전 잠금·필수값/이메일 검증·중복 제출·실패 입력 유지·시간 초과와 abort·늦은 성공 무시·정확한 접수 확인·완료 초점·언마운트·전송 계약을 포함한다.
- root가 수행한 candidate Worker의 contact/auth/httpSecurity 관련 62개 테스트 PASS. Wrangler dry-run PASS, 380.99 KiB / gzip 85.31 KiB. 이 기록은 모의 전송과 번들 검증 결과이며 운영 메일 실제 수신을 뜻하지 않는다.
- root의 실제 브라우저 검수: http://127.0.0.1:5199/contact/ 에서 PC 1280px 및 모바일 375px 폼을 확인했다. 모바일 제출 버튼 높이 56px, 페이지 가로 넘침 0. 빈 제출의 오류 5개와 첫 문의 유형 필드 초점을 확인했다.
- root의 격리 모의 브라우저 검수: http://127.0.0.1:5207/contact/ 에서 제공자 오류 후 입력 유지·alert 초점, 성공 후 완료 제목 초점, 375px 가로 넘침 0을 확인했다. 이 화면은 외부 fetch·서버 POST를 차단한 fixture이며 실제 제공자·운영 Worker 검증과 구분한다.
- 메인 Hero와 기존 사진·영상, 비공개 가격 12파일, 게임 24파일을 보존했다. 앞서 반영한 하늘쌤 이력·후기·수업 안내 조정도 유지한다. 커밋·배포는 수행하지 않았다.

### 증거와 재현 위치

이 폴더에는 contact-form-QA.md, contact-form-results.json, contact-form-check.cjs, contact-form-fixture.jsx, serve-contact-form-fixture.cjs, assemble-stage.mjs, stage-manifest.json을 보관한다. check/fixture 스크립트는 원래 .tmp_qa 아래 위치를 기준으로 source와 의존성을 찾으므로 이 보관 폴더에서 직접 실행하지 않는다. 원본 workspace C:/development/TutorManager_For_Notion에서 다음 명령을 사용한다.

```powershell
node .tmp_qa/consult-site-release-20260914/contact-form-check.cjs
node .tmp_qa/consult-site-release-20260914/serve-contact-form-fixture.cjs
```

원본 스크립트 위치는 C:/development/TutorManager_For_Notion/.tmp_qa/consult-site-release-20260914/이다. 서버가 이미 5207에서 실행 중이면 새 인스턴스를 중복 실행하지 않는다. assemble-stage.mjs 역시 이 원본 workspace의 baseline/build/staging을 참조한다. Worker dry-run 원본 로그는 같은 폴더의 contact-worker-dry-run.log이다. 이 스냅샷 동기화 단계에서는 제품 소스·Worker 소스 변경이나 테스트·빌드 재실행을 하지 않았다.

### 아직 완료되지 않은 검증

운영 이메일 설정 진행 상황은 별도 상태 기록을 참조한다. 작성 시점에는 실제 수신함 도착과 운영 /contact 정상 제출의 전체 경로를 확인하지 않았다. 모의 성공은 실제 메일 수신 완료로 보고하지 않는다. 공개 배포와 그 이후 검증도 아직 수행하지 않았다.

메일 연결 후속 확인: 사용자 인증 후 Cloudflare 수신 주소 Verified·도메인 Enabled를 확인했다. 운영 Worker를 변경하지 않는 로컬 remote binding 검수에서 지정 업무메일로 연결 확인용 메일 1건을 보내 HTTP200·ok:true·messageId를 받았다. 검수 서버는 종료했고 재전송하지 않았다. 받은편지함 도착은 사용자 확인 대기, 운영 폼 배포는 미실행이다. 상세 근거는 contact-email-setup.md와 contact-email-live-result.json이다.

최신 프로필 통합 검수: 사용자 요청에 따라 Hero 바로 아래 독립 teacher-profile 섹션을 제거하고 기존 ‘왜 하늘하늘 중국어인가’ 섹션에 통합했다. 기존 이력 7개와 teacher-profile 앵커 1개를 유지하며 PC 3열·모바일 1열로 배치한다. root의 Astro 12경로 빌드·967파일 staging 조립 및 보존 검증이 통과했다. 실제 브라우저 1280px/375px에서 사진 크기 96px/72px, 이력 7개, 앵커 1개, 가로 넘침 0, 모바일 링크 높이 44px, 콘솔 경고·오류 0을 확인했다. index.astro/global.css 스냅샷과 assemble-stage.mjs·stage-manifest.json은 최신 원본과 해시가 일치한다. 앞의 독립 프로필 배치 기록은 이전 상태이며, 현재 통합 상태도 아직 배포 전이다. 이번 단계에서 커밋·배포는 수행하지 않았다.

최신 프로필 이름·사진 배치 조정: 사용자 요청에 따라 우상단의 PC 96px·모바일 72px 사진 배치를 제목 바로 아래 좌측 배치로 변경했다. PC·모바일 모두 사진은 64px이며, 이름과 역할은 두 줄로 정리했다. 이 기록은 현재 구현 배치만 설명하며 브라우저 검수 결과는 포함하지 않는다.
