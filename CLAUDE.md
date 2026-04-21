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

스킬 파일 위치: `.agents/skills/make-interfaces-feel-better/`

---

## Node.js 실행 환경 (Windows)

로컬에서 `.mjs` 스크립트 실행 시 Node.js PATH 설정 필요:
```bash
export PATH="/c/Program Files/nodejs:$PATH"
NOTION_TOKEN=ntn_... node script.mjs
```
