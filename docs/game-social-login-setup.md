# 성조게임 소셜 로그인 — 제공자 콘솔 설정 체크리스트

> Worker 백엔드(OAuth BFF)는 구현 완료(브랜치 `feature/game-social-login`). 아래는 **실제 로그인이 동작하려면 사용자가 직접** 해야 하는 콘솔 설정 + Worker 시크릿 등록. 설정 전엔 `/game/auth/*/start`가 501(미설정)을 반환한다.

Worker Production URL: `https://tutor-manager-proxy.hisyisnis.workers.dev`

## 콜백(Redirect) URL — 콘솔에 그대로 등록
- 구글: `https://tutor-manager-proxy.hisyisnis.workers.dev/game/auth/google/callback`
- 카카오: `https://tutor-manager-proxy.hisyisnis.workers.dev/game/auth/kakao/callback`

## 1) 구글 (Google Cloud Console)
1. Google Cloud Console → **APIs & Services → Credentials**.
2. **Create Credentials → OAuth client ID → Web application**.
3. **Authorized redirect URIs**에 위 구글 콜백 URL 추가.
4. 발급된 **Client ID**·**Client Secret** 보관.
5. (동의화면) OAuth consent screen에서 앱 이름·scope(`openid`, `profile`) 설정. 테스트 단계면 테스트 사용자 등록.
6. (안드로이드 네이티브는 나중) 스토어 출시 때 Android OAuth 클라이언트(패키지명 `com.tiantian.tonegame` + SHA‑1) 추가.

## 2) 카카오 (Kakao Developers)
1. [developers.kakao.com](https://developers.kakao.com) → 내 애플리케이션 → 앱 생성(또는 기존 하늘하늘 채널 앱).
2. **카카오 로그인 → 활성화 ON**.
3. **Redirect URI**에 위 카카오 콜백 URL 추가.
4. **앱 키 → REST API 키** 보관(= `client_id`).
5. (권장) 카카오 로그인 → **보안 → Client Secret 발급·사용 ON** → 값 보관.
6. **동의항목**에서 `profile_nickname`(닉네임) 필수 또는 선택 동의로 설정.

## 3) Worker 시크릿 등록 (`cd worker && npx wrangler secret put <NAME>`)
| 시크릿 | 값 | 필수 |
|---|---|---|
| `GAME_GOOGLE_CLIENT_ID` | 구글 Client ID | ✅ |
| `GAME_GOOGLE_CLIENT_SECRET` | 구글 Client Secret | ✅ |
| `GAME_KAKAO_REST_KEY` | 카카오 REST API 키 | ✅ |
| `GAME_KAKAO_CLIENT_SECRET` | 카카오 Client Secret | 카카오에서 사용 ON 했을 때만 |
| `GAME_AUTH_REDIRECTS` | 추가 허용 복귀주소 prefix(콤마구분) | 선택 |

## 4) 허용 복귀 주소(redirect)
클라이언트가 `/game/auth/:provider/start?redirect=<복귀주소>`로 호출하고, 로그인 후 그 주소로 `#token=…`을 붙여 돌아온다. **오픈 리다이렉트 방지**로 아래 prefix로 시작하는 주소만 허용:
- 기본 허용: `https://tiantian-chinese.pages.dev`, `http://localhost`, `https://localhost`, `capacitor://localhost`
- 네이티브 앱 커스텀 스킴(예: `tiantiantone://`)을 쓸 거면 `GAME_AUTH_REDIRECTS`에 추가 등록.

## 5) 설정 후 확인
- `GET .../game/auth/google/start?redirect=https://tiantian-chinese.pages.dev/game/tone` → 302 구글 로그인 페이지로.
- 실제 E2E는 PWA 로그인 UI(다음 단계) 연결 후.

---
관련 코드: `worker/lib/oauth.js`(순수 헬퍼)·`worker/src/index.js`(`/game/auth/:provider/start`·`/callback`). JWT_SECRET은 기존 것 재사용. 애플 로그인은 iOS 앱스토어 출시 때 추가.
