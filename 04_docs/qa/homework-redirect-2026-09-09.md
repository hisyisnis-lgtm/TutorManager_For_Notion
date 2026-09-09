# 숙제 업로드 redirect 오류 수정 — 2026-09-09

## 원인과 변경

- 학생 화면의 `Invalid redirect value, must be one of "follow" or "manual"`은 Cloudflare workerd가 지원하지 않는 `fetch(..., { redirect: 'error' })`에서 발생했다.
- Node fetch mock만 사용한 기존 테스트는 런타임 차이를 잡지 못했다. 실제 workerd 테스트에서 업로드 옵션만 메모리상으로 원복해 같은 오류를 재현했다.
- Worker의 5개 요청을 `manual`로 변경했다: 숙제 업로드, 파일 다운로드, 직접 ntfy 경고 발송, 알림 이력/SSE 프록시, ntfy 계정 ACL 확인.
- 3xx 응답은 실패로 처리하고 응답 본문을 정리한다. 외부 Location을 따라가지 않으므로 업로드 파일·인증정보의 리디렉션 유출 차단은 유지된다.
- Node 자동화의 `redirect: 'error'`는 지원되는 옵션이므로 변경하지 않았다. PWA 코드·버전·설정 및 알림 본문 정책은 변경하지 않았다.

## 검증

- `worker/`에서 `npm test`: **22개 파일, 314개 테스트 통과**.
- 실제 Miniflare/workerd 런타임 **7개 테스트 통과**:
  - 기존 옵션으로 같은 런타임 오류 재현, 실제 파일 전송 전 실패 확인.
  - 학생 인증 → 음성 업로드 → 소유자가 서명된 업로드 증표 → 숙제 제출 → GitHub 알림 릴레이 요청.
  - 강사 인증 → PDF 업로드.
  - 학생·강사 업로드의 302/307 응답 거부, Location 미추적.
- 관련 Node 회귀 테스트는 정상 업로드·다운로드, 302/307 차단, 본문 정리, 알림 조회·직접 경고·ACL 경계를 검증한다.
- 레포 루트에서 `node --test 01_automation/ntfy_privacy.test.mjs 01_automation/secure_ntfy_topics.test.mjs`: **19개 통과**.
- `git diff --check` 통과. 작업 루트와 배포용 작업 트리의 수정 소스·테스트 8개 내용 일치.

## 검증 한계와 배포

- 런타임 테스트의 D1·토큰·Notion·GitHub·ntfy 응답은 격리된 합성 데이터다. 모든 외부 요청을 가로채며 실제 네트워크로 넘어가는 fallback은 없다.
- 실제 학생 숙제·파일·알림을 생성하지 않았다. 테스트 통과는 운영 학생의 제출 완료나 휴대폰 알림 수신을 의미하지 않는다.
- Worker만 배포한다. 배포 식별자와 검증 결과는 공용 `architecture.md` 배포 기록에 남긴다.
