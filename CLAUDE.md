# Claude 행동 지침 — TutorManager For Notion

## 언어
항상 한국어로 친절하게 대답해줘.

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

## PWA 코드 규칙 (antd v6)

antd ^6.3.3 기준 — deprecated API 절대 사용 금지:

| ❌ 금지 | ✅ 올바른 사용 |
|---|---|
| `<Card bordered={false}>` | `<Card variant="borderless">` |
| `<Space direction="vertical" size={N}>` | `<Flex vertical gap={N}>` |

색상 기준: Primary `#7f0005` / 보조텍스트 `#595959` / 아이콘 `#767676`

---

## 사용자 호출 스킬

| 슬래시 커맨드 | 설명 |
|---|---|
| `/make-interfaces-feel-better` | UI 폴리싱 원칙 적용 — 애니메이션·그림자·타이포·히트영역 등 인터페이스 품질 개선 |
| `/ux-heuristic-audit` | 유저 테스트 대체 UX 휴리스틱 봇 — JTBD 페르소나가 PWA를 워크스루하며 이탈 지점·H1~H6 휴리스틱 위반을 채점. (디자인 컴플라이언스는 `/pwa-visual-qa` 담당) |

스킬 파일 위치: `.agents/skills/make-interfaces-feel-better/`

---

## Node.js 실행 환경 (Windows)

로컬에서 `.mjs` 스크립트 실행 시 Node.js PATH 설정 필요:
```bash
export PATH="/c/Program Files/nodejs:$PATH"
NOTION_TOKEN=ntn_... node script.mjs
```

---

## PWA 페이지 검수 플로우 (필수)

PWA 페이지를 **새로 만들거나 수정한 뒤**, 작업 완료를 보고하기 **전에** 반드시 아래 검수 단계를 수행한다. "코드가 컴파일된다 = 끝"이 아니다 — 실제 화면이 디자인 가이드에 맞고 화면 밖으로 넘치지 않는지까지 확인해야 완료다.

### 1. 빌드 통과
`cd pwa && npm run build` 에러 없이 통과.

### 2. 디자인 가이드 자가 대조 (`design_system.md` 기준)
- `#7f0005`(PRIMARY)는 **인터랙티브 요소·아이콘·배지 배경에만**. **본문 텍스트 강조에 빨강 사용 금지** — 강조는 `PRIMARY_BG` 박스 또는 `fontWeight 600`.
- 색상 리터럴 직접 사용 금지 → `constants/theme.js` 토큰 import.
- antd v6 deprecated API 0건 (`Card bordered`, `Space direction="vertical"`, `Modal destroyOnClose`, `Button iconPosition`).
- `borderLeft: '3px solid'` 등 굵은 컬러 보더 금지. radius 12 기본.
- 아이콘은 `@phosphor-icons/react`의 `XxxIcon` + `weight="fill"`.

### 3. 레이아웃 함정 점검 (화면 밖 넘침·가림 방지)
- **전역 `BottomNav`는 `position: fixed; bottom: 0; zIndex: 50; 높이 ≈ 60px + safe-area`로 모든 라우트에 깔린다.** 페이지에 자체 하단 고정 요소(컨트롤 바·CTA)를 두면 BottomNav에 가려진다 → `bottom: calc(60px + env(safe-area-inset-bottom))` 이상으로 띄우고 `zIndex`는 50 미만.
- 스크롤 콘텐츠 하단에 `paddingBottom`을 충분히 줘서 BottomNav·자체 고정요소에 마지막 내용이 가리지 않게.
- 가로 overflow·고정폭으로 인한 화면 밖 넘침 / `env(safe-area-inset-*)` 대응 확인.

### 4. 실제 화면 시각 검수 (가장 중요)
**기본: `/pwa-visual-qa` 스킬로 자동 검수.** Playwright MCP로 로컬 dev 서버(localhost)를 띄워 라우트를 순회하며 스크린샷·콘솔에러를 수집하고, 위 가이드와 자가 대조해 ① 잘림·가림(BottomNav) ② 색상/타이포 위반(`#7f0005` 본문 오용 등) ③ 화면 밖 넘침을 점검한다. 문제가 있으면 수정 후 다시 검수한다.

- 자동 검수로 잡은 결과(스크린샷 경로 포함)는 **사용자에게도 첨부**해 함께 확인한다. 검수 전에는 "완료"로 보고하지 않는다.
- **Fallback**: Playwright MCP가 없거나 자동 검수가 불가한 화면(인증·외부의존 등)은 기존처럼 **사용자에게 스크린샷을 요청**해 가이드와 대조한다.
- 운영 앱 무영향: 검수는 로컬 dev 서버만 사용하고 배포는 절대 하지 않는다. 브랜치 자동 전환 금지.
