# gstack 추출 노트 (Phase 0 산출물)

> 출처: `garrytan/gstack` (격리 clone `c:\development\gstack-trial`, `./setup` 미실행).
> 목적: gstack 본체(bash·Bun·자동업데이트·텔레메트리)는 **버리고**, `/qa`·`/autoplan`·`/cso`의
> **방법론·체크리스트 로직만** 우리 스택(Cloudflare Worker + React PWA, Windows/PowerShell, 한국어)에 맞게 추출.
> 이 파일은 참고용 청사진이며 배포 번들과 무관하다.

---

## 0. 버린 것 (왜 통째 설치 안 했나)

3개 스킬 SKILL.md는 본문 앞에 동일한 의존 인프라를 깔고 시작한다 — 우리는 전부 제외:

- `~/.claude/skills/gstack/bin/*` 바이너리 호출 (gstack-config·update-check·repo-mode·telemetry-log·slug…)
- `~/.gstack/` 세션·analytics·learnings 디렉토리, **텔레메트리**(skill-usage.jsonl)
- **매 세션 자동 업데이트** 체크 + 마이그레이션 셸 실행 (자기수정형)
- CLAUDE.md에 "Skill routing" 섹션 **자동 추가** 유도, "Boil the Lake" 온보딩 프롬프트
- 전부 bash + `$B`(browse 엔진) + `find -mmin` + `date +%s` → **Windows/PowerShell 부적합**

→ 우리는 **단일 파일·의존성 0·한국어** 스킬로 재작성한다.

---

## 1. `/qa` → 우리 `pwa-visual-qa` 설계 재료 (Phase 1)

gstack은 자체 `$B` Chromium 엔진을 쓰지만 **우리는 Playwright MCP로 대체**. 방법론만 차용.

### 모드 (차용)
- **Diff 인식 모드 (기본)**: 피처 브랜치면 `git diff main...HEAD --name-only` → 바뀐 파일에서 영향받는 **라우트** 역추적 → 그 페이지만 집중 검수. (우리 PWA 라우트 매핑은 `architecture.md` 참고)
- **Full 모드**: URL 주어지면 모든 도달 가능한 페이지 순회.
- **Quick 모드**: 홈 + 상위 5개 내비게이션 스모크 테스트.
- **Regression 모드**: 이전 `baseline.json`과 비교 (수정됨/신규/점수 델타).

### 페이지별 탐색 체크리스트 (차용 + 우리 가이드 결합)
1. 시각 스캔 (스크린샷)
2. 인터랙티브 요소 클릭 동작
3. 폼: 빈값·invalid·엣지케이스 제출
4. 내비게이션 진입/이탈 경로
5. 상태: empty·loading·error·**overflow**
6. 콘솔 에러 (인터랙션 후 신규 에러 포함)
7. 반응형: 모바일 뷰포트 `375x812` ↔ 데스크톱

### ⭐ 우리 `design_system.md` 자가대조 항목 추가 (gstack에 없음, 우리 필수)
- 가로/세로 overflow·잘림
- **BottomNav 가림** (`position:fixed; bottom:0; ~60px+safe-area`) — 페이지 자체 고정요소가 가리는지
- `#7f0005`(PRIMARY) **본문 텍스트 강조 오용** 금지
- 색상 리터럴 직접 사용 / antd v6 deprecated API (`Card bordered`, `Space direction="vertical"` 등)
- `env(safe-area-inset-*)` 대응

### 헬스 점수 루브릭 (차용)
카테고리별 0~100 → 가중 평균. 발견당 감점: Critical −25 / High −15 / Medium −8 / Low −3.

| 카테고리 | 가중치 |
|---|---|
| Console | 15% | Functional | 20% | UX 15% | Accessibility 15% |
| Visual | 10% | Performance 10% | Links 10% | Content 5% |

- Console: 0에러 100 / 1–3 70 / 4–10 40 / 10+ 10
- Links: 깨진 링크당 −15

### Wrap-up
"고쳐야 할 Top 3" + 콘솔 헬스 요약 + `baseline.json` 저장(date·healthScore·issues·categoryScores).

---

## 2. `/autoplan` → 우리 `plan-review` 설계 재료 (Phase 2)

gstack은 외부 4개 스킬 파일을 디스크에서 읽어 순차 실행하지만, **우리는 단일 파일에 4 렌즈 내장**.

### 순차 실행 (필수) — CEO → Design → Eng → DX
각 단계는 **이전 단계 완료 후** 시작. 병렬 금지. 단계 전환마다 요약 emit.

### 6가지 의사결정 원칙 (중간 질문 자동응답 기준)
1. **완전성** — 엣지케이스를 더 많이 덮는 쪽.
2. **Boil lakes** — 영향 반경(수정 파일 + 직접 import) 안이고 1일 미만(<5파일·신규 인프라 없음)이면 자동 확장.
3. **실용** — 같은 걸 고치면 더 깔끔한 쪽. 5초 안에 결정.
4. **DRY** — 기존 기능 중복이면 기각, 재사용.
5. **명시 > 영리함** — 10줄 자명한 수정 > 200줄 추상화. 신규 기여자가 30초에 읽히는 것.
6. **행동 편향** — 머지 > 리뷰사이클 > 정체된 숙고. 우려는 표시하되 막지 않음.

단계별 타이브레이커: CEO=완전성+boil / Eng=명시+실용 / Design=명시+완전성.

### 의사결정 분류
- **Mechanical** (정답 하나): 조용히 자동결정.
- **Taste** (이견 가능): 추천과 함께 자동결정하되 **최종 게이트에서 표시**.
- **User Challenge** (사용자가 정한 방향을 둘 다 바꾸자 함): **절대 자동결정 금지** — 사용자 원안이 기본값, 모델이 변경 근거를 제시.

> Auto-decide는 "분석"이 아니라 "사용자 판단"만 대체. 분석 깊이는 인터랙티브 버전과 동일하게 유지.

### 우리 스택 맞춤 렌즈 질문 (추가)
- Eng: zod `.nullish()` 규칙, KST 처리, 예약 레이스컨디션, Notion API formula/rollup 제약
- Design: `design_system.md` 토큰·antd v6·BottomNav 레이아웃 함정
- DX: 배포는 wrangler/태그푸시 흐름과 충돌 없는지

---

## 3. `/cso` → 우리 `security-checklist.md` 설계 재료 (Phase 3)

내장 `/security-review`에 아래 체크리스트를 얹는다. **우리 공격면 특정.**

### 우리 공격면 census (Phase 1 차용 → 구체화)
- **JWT 인증** (발급·검증·만료·갱신) — `worker/`
- **예약 시스템** 레이스컨디션·슬롯 로직·KST
- **시크릿**: NOTION_TOKEN·SOLAPI_API_KEY·JWT_SECRET (하드코딩 금지·wrangler secret만)
- **입력 검증**: zod 스키마 누락 라우트
- **외부 연동**: Notion API, 솔라피(카카오), ntfy, CONSULT/결제 흐름
- **CORS / rate limit** (특히 인증·예약·상담신청 엔드포인트)

### OWASP Top 10 (우리 매핑)
- **A01 접근제어**: 학생 A가 ID 바꿔 학생 B 자원 접근 가능한가? 인증 누락 라우트?
- **A02 암호화**: 시크릿 env 관리 확인, 전송/저장 암호화
- **A03 인젝션**: 문자열 보간 쿼리, Notion filter 주입, LLM 프롬프트 주입
- **A04 불안전 설계**: 인증 엔드포인트 rate limit / 실패 잠금 / 서버측 검증
- **A05 설정오류**: CORS 와일드카드, CSP, 프로덕션 verbose 에러
- **A06 취약 의존성**: Dependabot 이미 운영 중 → 연계
- **A07 인증실패**: 세션·JWT 만료·refresh 로테이션
- **A08 무결성**: 역직렬화·외부데이터 검증, CI/CD 파이프라인 보호
- **A09 로깅/모니터링**: 인증/인가 실패 로깅, ntfy 알림 연계
- **A10 SSRF**: 사용자 입력 URL 구성·아웃바운드 allowlist

### STRIDE (주요 컴포넌트마다)
Spoofing / Tampering / Repudiation / Information Disclosure / Denial of Service / Elevation of Privilege.

### 데이터 분류
- RESTRICTED(법적책임): 학생 PII, 결제정보, 자격증명
- CONFIDENTIAL(사업피해): API 키, 사업 로직
- INTERNAL: 시스템 로그, 설정
- PUBLIC: 마케팅·문서

### 2모드
- **Daily**: 무소음, 8/10 확신 게이트.
- **Comprehensive**: 월간 심층, 2/10 게이트 + 추세 추적.

---

## 다음 단계
- Phase 1: `pwa-visual-qa` (Playwright MCP) — 위 §1 기반
- Phase 2: `plan-review` — 위 §2 기반
- Phase 3: `security-checklist.md` — 위 §3 기반
- 채택 결정 기록은 `gstack_adoption.md` 메모리에.
