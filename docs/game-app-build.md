# 성조게임 안드로이드 앱 빌드 가이드

성조게임을 안드로이드 APK/AAB로 빌드·실행하는 절차. 웹 코드는 그대로 두고 Capacitor로 네이티브 래핑한다.
설계·결정 배경은 메모리 `game_standalone_app.md` 참고.

- **appId(패키지명):** `com.tiantian.tonegame` — ⚠️ Play 스토어 게시 후엔 **영구 변경 불가**. 첫 게시 전에 확정할 것.
- **웹 빌드 산출물:** `pwa/dist-game/` (게임 전용, 강사·학생 코드 없음)
- **네이티브 프로젝트:** `pwa/android/`

---

## 0. 사전 준비 (한 번만)

- **Android Studio 설치** (권장) — 자체 JDK 17을 포함하므로 별도 Java 설치 불필요.
  - ⚠️ 이 저장소가 있는 PC의 시스템 Java는 1.8이라 **CLI(`gradlew`) 직접 빌드는 실패**한다. Android Studio로 열어서 빌드할 것.
- (CLI로 빌드하려면) JDK 17+ 설치 후 `JAVA_HOME`을 JDK 17로 지정.
- Node.js (이미 사용 중).

---

## 1. 웹 빌드 → 네이티브 동기화

`pwa/`에서:

```bash
npm run build:game     # dist-game/ 생성 (게임 전용 번들)
npx cap sync android   # dist-game → android/app/src/main/assets/public 복사 + 플러그인 반영
```

> 게임 코드를 수정할 때마다 이 두 명령을 다시 실행해야 앱에 반영된다.

---

## 2. Android Studio에서 실행 (디버그)

1. Android Studio → **Open** → `pwa/android` 폴더 선택.
2. Gradle sync 완료까지 대기 (첫 실행은 의존성 다운로드로 시간 소요).
3. 상단 기기 선택에서 에뮬레이터 또는 USB 연결 실기기 선택.
4. **Run ▶** — 디버그 APK가 빌드·설치·실행된다.

### CLI로 디버그 APK (JDK 17 필요)
```bash
cd pwa/android
./gradlew assembleDebug
# 산출물: android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 3. 앱 아이콘 · 스플래시 (Figma 아트 준비 후)

현재는 Capacitor 기본 아이콘. 게임 전용 아이콘은 **Figma에서 먼저 디자인**(feedback_figma_first)한 뒤 아래로 생성한다.

```bash
cd pwa
npm install -D @capacitor/assets   # 아이콘 준비된 시점에만 설치
mkdir -p assets
# assets/icon-only.png      (1024x1024, 투명배경 로고)
# assets/icon-foreground.png(1024x1024, 마스커블 전경 — 안전영역 여백 포함)
# assets/icon-background.png(1024x1024, 마스커블 배경색/이미지)
# assets/splash.png         (2732x2732, 스플래시 — 다크 #0E1730 배경 권장)
npx capacitor-assets generate --android
npx cap sync android
```

배경색은 `capacitor.config.json`의 `backgroundColor: "#0E1730"`(다크)로 실행 시 흰 깜빡임을 막아둔 상태.

---

## 4. 출시용 서명 빌드 (Play Console 등록 결심 시에만)

> 이 단계부터 비용/운영 발생: 구글 Play Console **$25(일회성)** 등록, 이후 심사·서명키 관리.

1. **업로드 키스토어 생성** (한 번만, 안전 보관 — 분실 시 앱 업데이트 불가):
   ```bash
   keytool -genkey -v -keystore tonegame-upload.keystore -alias tonegame -keyalg RSA -keysize 2048 -validity 10000
   ```
2. `android/keystore.properties`(gitignore할 것)에 키 정보 기입 + `app/build.gradle`에 `signingConfigs` 연결. (시크릿은 저장소에 커밋 금지)
3. **AAB 빌드**(Play는 AAB 요구):
   ```bash
   cd pwa/android
   ./gradlew bundleRelease
   # 산출물: android/app/build/outputs/bundle/release/app-release.aab
   ```
4. Play Console에 AAB 업로드 + 스토어 등록정보(스크린샷·설명·개인정보 처리방침·연령등급).

### 심사 통과 체크리스트
- **게스트 플레이가 로그인 없이 전체 동작**해야 함 — 심사자는 한국 휴대폰 알림톡 OTP를 못 받으므로, 로그인은 선택이어야 통과. (현재 게스트-우선 구조라 OK. 심사 노트에 명시.)
- 개인정보 처리방침 URL 필수 (전화번호로 회원가입 → 데이터 수집 고지).

---

## 5. ⚠️ 백엔드(Worker) 배포 필수

앱은 게임 API(`/game/*`)를 CORS로 호출한다. Worker의 CORS 허용목록에 `https://localhost`(안드로이드 웹뷰)·`capacitor://localhost`(iOS) 추가는 **코드에 반영됐지만 배포해야 적용**된다:

```bash
cd worker && npx wrangler deploy
```

배포 전에는 앱에서 로그인·기록 동기화 등 API 호출이 CORS로 실패한다. (게스트 로컬 플레이는 API 없이도 동작.)

---

## iOS (나중에 — 맥 필요)
맥(Xcode) 확보 시 `npx cap add ios` 후 동일 흐름. Apple은 심사가 더 엄격(4.2 "미니멀 기능") — 오프라인 동작·네이티브 사운드/햅틱으로 "앱다움" 확보 필요. Apple Developer $99/년.
