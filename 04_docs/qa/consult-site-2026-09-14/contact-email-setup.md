# Contact 이메일 연결 상태 — 2026-09-14

- 사용자 선택: 기업·기관 출강 및 콘텐츠·브랜드 협업 문의를 업무용 이메일로 수신한다.
- 수신: `tiantianchinese_@naver.com`. 발신: `contact@tiantianchinese.com`. 문의자가 입력한 이메일은 Reply-To에만 사용한다.
- 사이트 폼과 `POST /contact`는 로컬 후보에 구현했다. Notion 학생 상담·ntfy·카카오 발송은 호출하지 않는다.
- Cloudflare Email Routing 도메인 온보딩을 실행했다. 실행 직후 `Syncing`에서 후속 확인 시 `Enabled`로 전환됐다.
- 실행 전 DNS 전체 목록은 홈페이지 CNAME 1개였다. 실행 후 전체 6개 중 홈페이지 CNAME(`tiantianchinese.pages.dev`, Proxied, Auto)은 동일하고, MX 3개 및 SPF·DKIM TXT 2개가 추가된 것을 대시보드에서 확인했다.
- 최초 활성화는 자동 승인 검토가 기존 메일 DNS 충돌 가능성으로 거부했다. 전체 DNS가 CNAME 1개뿐임을 읽기 전용으로 확인한 뒤 같은 활성화 동작을 재검토받아 실행했다. 다른 도구로 우회하지 않았다.
- 수신 주소를 등록해 Cloudflare 인증 메일을 요청했다. 사용자 "인증했어" 응답 후 대시보드에서 `tiantianchinese_@naver.com`의 `Verified`를 확인했다. 실제 문의 메일 수신 성공과는 구분한다.
- 일반 Email Sending UI는 Workers Paid가 필요하다고 표시한다. 계정 요금제는 변경하지 않았다. 공식 문서가 안내하는 Email Routing의 인증된 수신 주소 전송을 사용하도록 준비했다.
- Worker에는 `CONTACT_EMAIL`의 `destination_address`를 업무용 이메일로 고정했다. 생성된 런타임 타입과 최신 공식 Workers API에서 structured builder의 `replyTo`, `messageId`를 확인했다.
- 코드 검증은 모의 메일 바인딩과 로컬 D1을 사용했다. 사용자 인증 완료 후 운영 Worker를 배포하지 않고 127.0.0.1 전용 Wrangler remote 이메일 바인딩으로 연결 확인 메일 1건을 보냈다. 2026-09-14 00:38:10 UTC에 HTTP 200·ok:true·messageId를 받았다. 같은 fixed destination/발신/structured API가 동작함을 확인했으며 검사 서버는 종료했다. 운영 상담·학생 알림은 전송하지 않았다.
- 테스트 제목은 `[연결 확인] 하늘하늘 중국어 Contact`, 내용은 `출강·협업 문의 이메일 연결 확인용 테스트입니다. 실제 고객 문의가 아닙니다.`이다. 공급자 전송 성공과 사용자의 받은편지함 도착 확인을 구분한다. Inbox 도착 여부와 배포된 전체 폼의 실수신은 아직 미확인이다.
- 이번 Contact 변경의 커밋·푸시·Worker/사이트 배포는 수행하지 않았다.

## 다음 단계

1. 완료: 업무용 이메일 `Verified` 확인.
2. 완료: Routing 도메인 `Enabled`, DNS 기존 홈페이지 CNAME 보존 및 메일 레코드 5개 추가 확인.
3. 준비된 격리 후보의 배포 승인을 확인하고 Worker → 사이트 순서로 반영한다. 공유 root Worker의 다른 WIP를 섞지 않는다.
4. 메일 연결 검수의 성공 응답은 확인했다. 사용자의 Inbox 도착 및 배포 후 전체 폼의 수신·Reply-To를 확인한다. 추가 실메일 테스트는 목적과 범위를 확인하고 수행한다.

참고: [Cloudflare Email Service](https://developers.cloudflare.com/email-service/), [Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/), [send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/).
