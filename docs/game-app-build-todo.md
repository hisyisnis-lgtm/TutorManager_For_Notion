# 성조게임 안드로이드/iOS 앱 빌드 시 할 일 (소셜 로그인)

> 웹(Cloudflare Pages) 소셜 로그인은 **전체 리다이렉트 방식으로 이미 완성**. 아래는 게임을 **Capacitor 네이티브 앱**으로 빌드해 스토어에 낼 때 추가로 필요한 것. (관련: [[game_standalone_app]] · `docs/game-social-login-setup.md`)

## 1) 네이티브 복귀 처리 — 딥링크 (필수)
웹은 `window.location.href = start URL` → 브라우저 리다이렉트 → 현재 주소로 `#token=` 복귀. 네이티브 웹뷰는 앱 밖(제공자 로그인 페이지)으로 나갔다 **딥링크로 돌아와야** 한다.
- **인앱 브라우저로 열기**: `@capacitor/browser`의 `Browser.open({ url: socialLoginUrl(...) })`.
- **복귀 캐치**: `@capacitor/app`의 `App.addListener('appUrlOpen', ...)` → URL의 `#token=` 추출 → 기존 `takeTokenFromHash` 로직 재사용해 `loginMember`.
- **Worker 콜백의 최종 redirect 대상**을 앱 커스텀 스킴(예: `tiantiantone://auth`)으로. `LoginScreen`에서 네이티브면 `redirect`를 그 스킴으로 전달.
- **커스텀 스킴을 Worker 허용목록에 등록**: `wrangler secret put GAME_AUTH_REDIRECTS` 에 `tiantiantone://` 추가(콤마구분). (`worker/lib/oauth.js` `DEFAULT_REDIRECT_PREFIXES` 참고 — 기본에 `capacitor://localhost`는 이미 포함)
- Android `AndroidManifest.xml`에 인텐트 필터(스킴) 추가. iOS `Info.plist`에 URL scheme 등록.

## 2) 제공자 콘솔 — 네이티브용 추가 등록
- **구글**: 웹 클라이언트와 별개로 **Android OAuth 클라이언트** 생성 필요 — 패키지명 `com.tiantian.tonegame` + 앱 서명 **SHA-1 지문**. (BFF 서버교환을 쓰면 웹 클라이언트로도 가능하나, 네이티브 구글 로그인 UX를 쓸 경우 Android 클라이언트 필요)
- **카카오**: 내 앱 → 플랫폼에 **Android 등록**(패키지명 + 키 해시). Redirect URI에 커스텀 스킴 또는 Worker 콜백 유지.
- **커스텀 스킴 Redirect URI**를 카카오/구글 콘솔에도 등록.

## 3) 애플 로그인 (iOS 앱스토어 낼 때 필수)
- iOS 앱에서 타사 소셜 로그인(카카오·구글)을 제공하면 **Sign in with Apple도 필수**(App Store 심사 규정).
- Apple Developer에서 Sign in with Apple 설정 + Worker에 `apple` provider 추가 구현 필요(현재 미구현 — `oauth.js`에 provider 추가 + Apple의 client_secret은 JWT 서명 방식이라 별도).

## 4) CORS/Origin
- Worker CORS는 이미 `capacitor://localhost`(iOS)·`https://localhost`(안드로이드 웹뷰) 허용됨(architecture.md 2026-07-05). 새 스킴 추가 시 확인.

## 우선순위
1(딥링크) → 2(콘솔 네이티브) 가 안드로이드 출시 최소 요건. 3(애플)은 iOS 낼 때. 4는 점검만.
