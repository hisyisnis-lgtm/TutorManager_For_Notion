# Claude 행동 지침 — TutorManager For Notion

## 언어
항상 한국어로 친절하게 대답해줘.

---

## 프로젝트 폴더 구조 (2026-08-26 재편)

최상위는 **대분류 넘버링**으로 고정. 새 파일은 루트에 두지 말고 해당 번호 폴더에 넣는다.

| 폴더 | 내용 | 주의 |
|---|---|---|
| `01_automation/` | GitHub Actions가 돌리는 운영 스크립트 20개 | 워크플로가 `node 01_automation/xxx.mjs`로 호출 — 파일명·위치를 바꾸면 `.github/workflows/`도 같이 수정 |
| `02_devtools/` | 로컬 개발도구 (design-audit · tone-words-build · tone-tts-build 등) | `pwa/package.json`이 `../02_devtools/`로 참조. 스크립트들이 `__dirname/..` = 레포 루트로 가정하므로 **폴더 깊이를 바꾸지 말 것** |
| `03_data/` | `tone-words/` 단어 CSV · `notion_schema/` 자동 스냅샷 JSON | CSV는 대표님이 직접 편집하는 단어 풀 단일 출처 |
| `04_docs/` | 기획서·제안서·스펙 (md · pdf · html) | |
| `05_assets/` | `Font/` `IMG/` `Logo/` 원본 에셋 | 앱 번들과 무관한 원본 보관용 |
| `99_external/` | 외부 스킬·템플릿 (각각 별도 git 저장소) | gitignore 대상 — 본 repo가 추적하지 않음 |
| `pwa/` `worker/` | 배포 루트 — **번호 폴더로 옮기지 말 것** | 옮기면 `deploy-pwa.yml`·wrangler 배포 경로가 전부 깨진다 |

루트에 남는 것은 `CLAUDE.md` `README.md` `package.json` `.gitignore` 등 설정 파일뿐이다.
개발 중 스크린샷을 루트에 쌓지 말 것 — `.gitignore`의 `/*.png` `/*.jpeg`가 커밋은 막지만 파일 자체는 계속 쌓인다.

---

## 메모리 파일 참조 규칙

주제별 요청 시 해당 메모리 파일을 반드시 먼저 참고할 것.
메모리 파일 위치: `C:\Users\hisyi\.claude\projects\c--development-TutorManager-For-Notion\memory\`

| 주제 | 참고 파일 |
|---|---|
| Notion DB 속성·formula·관계도 | `notion_db_schema.md` |
| Notion API 작업 (API 호출, DB 수정) | `notion_api_tips.md` |
| 예약 시스템 수정·버그 | `project_booking_patterns.md` |
| PWA 화면·컴포넌트 수정 | `design_system.md` |
| 카카오/ntfy 알림 관련 | `kakao_notifications.md` |
| GitHub Actions 스크립트 | `automation_scripts.md` |
| 무료상담 신청 시스템 | `consult_system.md` |
| 수업 요금·결제 정책·사업자 정보 | `business.md` |
| 전체 시스템 구조·DB ID·API 라우트·배포 | `architecture.md` |

---

## 보안 규칙

- `NOTION_TOKEN`, `SOLAPI_API_KEY`, `JWT_SECRET` 등 시크릿 값은 코드에 절대 하드코딩 금지
- GitHub Secrets 또는 `npx wrangler secret put`으로만 관리
- 메모리 파일에도 실제 시크릿 값 저장 금지

---

## 계획 우선 규칙

사용자가 "계획부터", "계획 먼저", "어떻게 할지 짜줘", "기획부터" 등 **계획을 요청**하면:
- 계획(분석 + 단계별 구현안)만 제시하고 **멈춘다**.
- 코드 수정·파일 생성·패키지 설치 등 **실제 작업은 사용자의 명시적 승인("진행해", "그대로 해" 등) 전까지 시작하지 않는다.**
- 결정이 필요한 부분은 질문으로 정리해 제시하되, 질문에 답을 받았다고 곧바로 구현으로 넘어가지 말 것 — 답변은 계획을 다듬는 재료일 뿐, 착수 승인이 아니다.

---

## Git / 커밋 규칙

- 코드 수정 완료 후 `git commit` / `git push`를 자동으로 하지 말 것
- 사용자가 GitHub Desktop으로 직접 커밋한다
- 단, 사용자가 명시적으로 요청하면 `git commit` · 태그(`git tag`) · `git push` 까지 직접 수행한다

---

## 코드 수정 후 메모리 저장

코드 수정이 끝난 후, 아래 중 하나라도 해당하면 대화 종료 전 관련 메모리 파일에 기록:
- 새로운 설계 결정이나 구현 패턴이 확정된 경우
- 기존 메모리 내용이 바뀐 경우 (배포 버전, 구현 방식 변경 등)
- 앞으로 같은 실수를 반복하지 않아야 할 주의사항이 생긴 경우

---

## 코드 절약 원칙 (Ponytail 발췌)

> "가장 좋은 코드는 아예 안 쓰는 코드." 솔루션엔 게으르게, **코드 읽기엔 절대 게으르지 않게.**
> 깃허브 `DietrichGebert/ponytail` 플러그인을 설치하는 대신 핵심 규칙셋만 흡수 (도입 분석 결과 고유 엔진 없음 — 가치는 아래 사다리 자체).

코드를 새로 쓰기 **전에** 이 순서로 따진다. 위에서 멈추면 거기서 끝:
1. **이게 존재할 필요가 있나?** (YAGNI — 요청에 없는 추측성 기능·추상화·옵션 만들지 말 것)
2. **이미 코드베이스에 있나?** (먼저 검색·재사용 — DRY)
3. **표준 라이브러리·언어 기본 기능으로 되나?**
4. **플랫폼/프레임워크 네이티브 기능(antd·React·Worker 런타임 등)으로 되나?**
5. **이미 설치된 의존성으로 되나?** (새 패키지 추가는 최후의 수단)
6. **한 줄(또는 몇 줄)로 끝낼 수 있나?**
7. 그래도 필요하면 → **최소한의 코드만.**

**단, 다음은 절대 "줄이기"의 대상이 아니다 (생략 금지):**
- 신뢰경계 검증·입력 검증(zod)·시크릿 처리·데이터 손실 방지 등 **보안**
- **접근성**(히트영역·대비·라벨)
- 이 문서가 정한 **의도된 절차** — PWA 검수 플로우, 코드 수정 후 메모리 저장, 디자인은 Figma 우선, 계획 우선 규칙. (적게 쓴다는 핑계로 이 절차들을 건너뛰지 말 것)

---

## PWA 코드 규칙 (shadcn)

> **antd는 2026-08-29에 완전히 제거됐다**(브랜치 `feature/shadcn-migration`). 이 앱의 UI는 shadcn이 단일 출처다.
> 배경·이식 함정 29건·자동 변환기 주의사항은 `shadcn_migration.md`.

**새 UI를 만들 때 처음부터 디자인하지 말 것.** `src/components/shadcn/`의 기존 컴포넌트를 먼저 조합하고,
없는 요소만 이 프로젝트의 색·여백·variant 규칙에 맞춰 확장한다.

| 항목 | 값 |
|---|---|
| 프리미티브 | `src/components/shadcn/` (소문자 파일명, 공식 소스 기반) |
| 앱 컴포넌트 | `src/components/ui/` (기존 유지 — 내부만 shadcn으로 교체) |
| 경로 alias | `@/` → `src/` (vite.config.js + jsconfig.json) |
| 클래스 병합 | `cn()` from `@/lib/utils` (clsx + tailwind-merge) |
| 아이콘 | **Phosphor** (`XxxIcon` + weight). lucide 쓰지 말 것 — 미설치이고 §19 규범 위반 |
| 색 토큰 | `index.css` `:root`의 HSL 변수 ← `constants/theme.js`가 단일 출처 |
| CLI | `npx shadcn@latest add <name>` — ⚠️ `shadcn-cli`는 **가짜 패키지** |
| Tailwind | v3 유지. `tailwind-merge`는 **v2.6.0 고정**(v3은 Tailwind v4 전용) |

**공식 소스에서 의도적으로 바꾼 것 — 되돌리지 말 것:**

| 상류 기본값 | 우리 값 | 이유 |
|---|---|---|
| 웨이트 500 유틸 | `font-semibold`(600) | KimjungchulGothic에 500이 없어 시스템 폰트로 폴백 |
| `ring-2 ring-offset-2` | **링 없음**, 보더 색 변화로 포커스 표시 | "보더 바깥에 링이 또 생겨 선이 두 겹" |
| `transition-colors` | 전환 목록에 **`scale` 포함** | 전역 press scale을 특이도로 덮어써 누름 피드백이 죽는다 |
| `rounded-md` | `rounded-lg` | 기본 radius 12 |
| 버튼 `h-10` | `h-11`(44px) | 터치 타겟 WCAG 2.1 AA |
| 카드 `border`+`shadow-sm` | `shadow-[var(--shadow-border)]` | 3겹 투명 레이어로 경계를 낸다(§6.4) |

**상류에 없어 추가한 것**: Button의 `destructiveOutline` variant · `block` variant · `loading` prop.

색상 기준: Primary `#7f0005` / 보조텍스트 `#595959` / 아이콘 `#767676`
색·크기·여백 값은 **하드코딩 금지** — `constants/theme.js` · `constants/styles.js`에서 import.

> 전체 규칙은 `design_system.md` **§0(문서 지도)** 부터. 규범/판단/참고 세 층으로 나뉘어 있다.
> 여기 표는 "항상 눈에 보여야 하는 것"만 추린 것이고, 단일 출처는 design_system.md다.

---

## 사용자 호출 스킬

| 슬래시 커맨드 | 설명 |
|---|---|
| `/make-interfaces-feel-better` | UI 폴리싱 원칙 적용 — 애니메이션·그림자·타이포·히트영역 등 인터페이스 품질 개선 |
| `/ux-heuristic-audit` | 유저 테스트 대체 UX 휴리스틱 봇 — JTBD 페르소나가 PWA를 워크스루하며 이탈 지점·H1~H6 휴리스틱 위반을 채점. (디자인 컴플라이언스는 `/pwa-visual-qa` 담당) |
| `/game-audio` | 게임 오디오 — Web Audio 프로시저럴 BGM 시퀀서·SFX 합성·음소거·믹싱 볼륨표. 외부 스킬(opusgamelabs/game-creator, MIT) 설치본 + 우리 대응표(우리 BGM은 mp3라 시퀀서 부분만 다름) |

스킬 파일 위치: `.agents/skills/make-interfaces-feel-better/`

---

## Node.js 실행 환경 (Windows)

로컬에서 `.mjs` 스크립트 실행 시 Node.js PATH 설정 필요:
```bash
export PATH="/c/Program Files/nodejs:$PATH"
NOTION_TOKEN=ntn_... node 01_automation/script.mjs
```
※ cwd는 항상 **레포 루트**. 스크립트들이 `process.cwd()`·`__dirname/..`를 루트로 가정한다.

---

## PWA 페이지 검수 플로우 (필수)

PWA 페이지를 **새로 만들거나 수정한 뒤**, 작업 완료를 보고하기 **전에** 반드시 아래 검수 단계를 수행한다. "코드가 컴파일된다 = 끝"이 아니다 — 실제 화면이 디자인 가이드에 맞고 화면 밖으로 넘치지 않는지까지 확인해야 완료다.

### 1. 빌드 통과
`cd pwa && npm run build` 에러 없이 통과.

### 1-bis. 디자인 규칙 검사 (자동)
```bash
node 02_devtools/design-audit.mjs
```
색 리터럴·weight 500·`transition: all`·antd deprecated·radius/아이콘 스케일 이탈·굵은 컬러 보더 등을 소스에서 잡는다. **ERROR는 0이어야 한다**(종료코드 1). `warn`은 그 파일을 건드릴 때 같이 정리하고, `review`는 사람이 판단하는 항목이라 0을 목표로 하지 않는다.
예외가 필요하면 스크립트의 `ALLOW`에 **이유와 함께** 추가하거나 `// design-audit-ignore: <rule> — 이유` 마커를 쓴다.

### 2. 디자인 가이드 자가 대조 (`design_system.md` 기준)
- `#7f0005`(PRIMARY)는 **인터랙티브 요소·아이콘·배지 배경에만**. **본문 텍스트 강조에 빨강 사용 금지** — 강조는 `PRIMARY_BG` 박스 또는 `fontWeight 600`.
- 색상 리터럴 직접 사용 금지 → `constants/theme.js` 토큰 import.
- antd v6 deprecated API 0건 (`Card bordered`, `Space direction="vertical"`, `Modal destroyOnClose`, `Button iconPosition`).
- `borderLeft: '3px solid'` 등 굵은 컬러 보더 금지. radius 12 기본.
- 아이콘은 `@phosphor-icons/react`의 `XxxIcon` + `weight="fill"`.

### 3. 레이아웃 함정 점검 (화면 밖 넘침·가림 방지)
- **전역 `BottomNav`는 플로팅 캡슐(2026-08-31~)로 `position: fixed; zIndex: 50; 점유 높이 ≈ 66px + safe-area`(하단 여백 10 + 캡슐 56)로 모든 라우트에 깔린다.** 페이지에 자체 하단 고정 요소(컨트롤 바·CTA·FAB)를 두면 가려진다 → `bottom`은 **`constants/styles.js`의 `ABOVE_BOTTOM_NAV`**(= 74px + safe-area)를 쓰고 `zIndex`는 50 미만. 숫자를 하드코딩하지 말 것 — 탭바 형태가 바뀌면 상수만 갱신된다.
- 스크롤 콘텐츠 하단에 `paddingBottom`을 충분히 줘서 BottomNav·자체 고정요소에 마지막 내용이 가리지 않게.
- 가로 overflow·고정폭으로 인한 화면 밖 넘침 / `env(safe-area-inset-*)` 대응 확인.

### 4. 실제 화면 시각 검수 (가장 중요)
**기본: `/pwa-visual-qa` 스킬로 자동 검수.** Playwright MCP로 로컬 dev 서버(localhost)를 띄워 라우트를 순회하며 스크린샷·콘솔에러를 수집하고, 위 가이드와 자가 대조해 ① 잘림·가림(BottomNav) ② 색상/타이포 위반(`#7f0005` 본문 오용 등) ③ 화면 밖 넘침을 점검한다. 문제가 있으면 수정 후 다시 검수한다.

- 자동 검수로 잡은 결과(스크린샷 경로 포함)는 **사용자에게도 첨부**해 함께 확인한다. 검수 전에는 "완료"로 보고하지 않는다.
- **Fallback**: Playwright MCP가 없거나 자동 검수가 불가한 화면(인증·외부의존 등)은 기존처럼 **사용자에게 스크린샷을 요청**해 가이드와 대조한다.
- 운영 앱 무영향: 검수는 로컬 dev 서버만 사용하고 배포는 절대 하지 않는다. 브랜치 자동 전환 금지.
