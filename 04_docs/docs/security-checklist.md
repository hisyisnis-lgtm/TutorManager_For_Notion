# 보안 감사 체크리스트 — TutorManager For Notion

> 출처 설계: gstack `/cso`(OWASP+STRIDE)를 우리 공격면에 매핑. (참고: [gstack-extract.md](gstack-extract.md))
> 사용법: 내장 `/security-review`(브랜치 변경분 감사) 실행 시 이 체크리스트를 함께 참조.
> 코드 검색은 Grep 도구 사용, stack은 `worker/`(Cloudflare Worker, JS) + `pwa/`(React/Vite).

## 2 모드
- **Daily**(기본): 무소음, 확신 8/10 이상만 보고. 변경분 위주.
- **Comprehensive**(월간): 전체 심층, 2/10 게이트 + 추세 추적.

---

## 0. 공격면 census (우리 시스템)
- **JWT 인증**: 발급·검증·만료·갱신 로직 (`worker/`)
- **예약 시스템**: 레이스컨디션, 슬롯 로직, KST 경계
- **시크릿**: `NOTION_TOKEN`·`SOLAPI_API_KEY`·`JWT_SECRET` — 하드코딩 금지, `wrangler secret`/GitHub Secrets만
- **입력 검증**: zod 스키마 누락 라우트(`worker/lib/schemas.js`), 선택필드 `.nullish()`
- **외부 연동**: Notion API, 솔라피(카카오 알림톡), ntfy, 무료상담(CONSULT_DB), 결제 흐름
- **공개 엔드포인트**: 예약·상담신청·인트로 등 미인증 접근 가능 라우트

---

## OWASP Top 10 (우리 매핑)

### A01 접근제어
- [ ] 학생 A가 ID 파라미터를 바꿔 학생 B의 자원(수업·숙제·결제)에 접근 가능한가? (IDOR)
- [ ] 인증 누락된 라우트? 권한(강사 vs 학생) 분리 검증?
- [ ] 수평/수직 권한 상승 경로?

### A02 암호화 실패
- [ ] 시크릿이 env/wrangler secret로만 관리되고 코드·로그에 노출 안 되는가?
- [ ] JWT 서명 키 강도, 민감데이터 전송(HTTPS)/저장 보호.

### A03 인젝션
- [ ] Notion API filter/쿼리에 사용자 입력 안전하게 들어가는가? (문자열 보간 주의)
- [ ] 알림 템플릿·로그에 입력 그대로 삽입 시 escape?

### A04 불안전 설계
- [ ] 인증·예약·상담신청 엔드포인트에 **rate limit**? 무차별 예약/스팸 방지?
- [ ] 비즈니스 로직(슬롯 중복예약·할인 적용) **서버측** 검증?

### A05 설정오류
- [ ] CORS 와일드카드(`*`) 프로덕션 사용 여부, 허용 origin 명시?
- [ ] 프로덕션에서 verbose 에러/스택트레이스 노출 안 됨?

### A06 취약·구버전 의존성
- [ ] Dependabot(이미 운영 중) 경고 처리 상태 — `architecture.md` 참조.

### A07 인증·식별 실패
- [ ] JWT 만료·refresh 로테이션, 세션 무효화(로그아웃) 동작?
- [ ] 토큰 저장 위치(localStorage vs httpOnly cookie)의 XSS/탈취 위험?

### A08 무결성 실패
- [ ] 외부(웹훅·솔라피·Notion) 수신 데이터 검증? 서명/출처 확인?
- [ ] CI/CD(`deploy-pwa.yml`·wrangler) 파이프라인 시크릿 보호?

### A09 로깅·모니터링 실패
- [ ] 인증/인가 실패가 ntfy 알림(`alerting_system`)으로 캡처되는가?
- [ ] 민감정보(토큰·PII)가 로그에 남지 않는가?

### A10 SSRF
- [ ] 사용자 입력으로 아웃바운드 URL을 구성하는 곳? allowlist 적용?

---

## STRIDE (주요 컴포넌트마다)
각 컴포넌트(Worker 라우트군·예약·알림·결제)에 대해:
- **Spoofing**: 사용자/서비스 사칭 가능?
- **Tampering**: 전송/저장 데이터 변조 가능?
- **Repudiation**: 행위 부인 가능? 감사 추적 있나?
- **Information Disclosure**: 민감데이터 유출 경로?
- **Denial of Service**: 과부하·자원 고갈 가능?
- **Elevation of Privilege**: 무권한 상승 가능?

---

## 데이터 분류
- **RESTRICTED**(법적 책임): 학생 PII, 결제정보, 자격증명/토큰
- **CONFIDENTIAL**(사업 피해): API 키, 사업 로직, 단가·할인 정책
- **INTERNAL**(노출 시 곤란): 시스템 로그, 설정값
- **PUBLIC**: 마케팅·문서·공개 소개 페이지

---

## False Positive 필터 / 발견 보고
- 보고 전 **실재 검증**: 해당 필드·라우트·설정이 실제로 존재하는지 Grep으로 재확인(존재하지 않는 것 지적 금지).
- 각 finding: `제목 — 파일:라인` / 심각도 / 재현·근거 / 권고 수정.
- Daily 모드는 확신 8/10 미만 보류, Comprehensive는 2/10까지 기록 + 추세.
