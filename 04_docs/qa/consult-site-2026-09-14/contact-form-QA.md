# ContactForm 모의 검증

- 결과: `contact-form-results.json` — 11개 PASS, 실패 0, 실제 HTTP/메일 전송 0.
- 대상: `site/src/components/ContactForm.jsx`. 검증한 원본의 SHA-256을 결과 JSON에 기록했다.
- 실행: 저장소 루트에서 `node .tmp_qa/consult-site-release-20260914/contact-form-check.cjs`.
- 설치된 site React 19/ReactDOM, PWA jsdom/esbuild를 사용하며 제품 소스는 변경하지 않는다.

검증 범위: SSR POST/입력 잠금/개인정보 미포함 FormData, 실제 hydrateRoot의 잠금 해제와 수화 오류 없음, 필수값 초점과 입력 중 초점 보존, 잘못된 이메일 차단, 연속 제출 1회, 제공자 실패 후 값 보존과 명시적 재시도, 시간 초과/abort/늦은 성공 무시, 정확한 ok:true만 완료, 완료 초점, 언마운트 취소, 주입한 fetcher의 JSON POST 계약과 오류 처리.

## 브라우저 모의 폼

`node .tmp_qa/consult-site-release-20260914/serve-contact-form-fixture.cjs`

- URL: http://127.0.0.1:5207/contact/
- 기존 preview5199와 별개이다. 화면에 ‘모의 검증’을 명시한다.
- 상단에서 성공/제공자 오류/시간 초과/접수 확인 누락을 고른다. 실패 후 성공 모드로 바꾸면 입력을 유지한 재시도를 확인할 수 있다.
- 시간 초과는 검수를 위해 1.5초이며 제품 기본값 25초를 변경하지 않는다.
- 모의 정보 예: 가상 기관 / 가상 담당자 / fixture@example.invalid / 가상 제안 내용.
- `window.__CONTACT_FIXTURE__`에서 모의 호출 목록, abort 횟수, 차단된 fetch 횟수를 확인한다. 실제 개인정보를 입력하지 않는다.
- CSP `connect-src 'none'`와 fetch 차단, 서버 POST 405로 외부 전송을 차단한다. 외부 링크도 이동하지 않는다.
- 제품 ContactForm과 현재 global/contact CSS를 사용하지만 공식 사이트 전체 페이지, 실제 이메일 제공자·Worker, 운영 CORS를 검증하는 화면은 아니다. 폰트는 설치된 로컬 대체 글꼴을 사용한다.
- 서버 시작 시 번들하므로 제품 코드 변경 뒤에는 이 검수 서버만 다시 시작한다.

이 하네스에서는 실제 브라우저를 직접 조작하지 않았다. 시각·모바일 검수는 root가 별도로 진행한다.
