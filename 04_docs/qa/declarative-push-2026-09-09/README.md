# 푸시 클릭 → 알림 페이지 → 해당 상세 팝업 (v2.47.9)

## 확인된 실패와 변경

v2.47.8 실제 iOS 백그라운드 클릭은 실패했다. 진단은 구독·저장소 조회가 정상이지만 앱 URL에 클릭 ID가 없고 SW pending/events도 비어 있었다. 앱측 worker 객체는 activating, 응답한 실행 worker는 activated였다. 이 정보만으로 특정 iOS 내부 결함을 확정하지 않는다.

- Worker가 `web_push: 8030`과 `notification.title/body/navigate`를 포함하는 선언형 JSON을 발송한다. `mutable`를 생략하여 지원 브라우저는 알림 생성부터 클릭 목적지 처리까지 Service Worker 실행에 의존하지 않는다. 기존 `showNotification({ navigate })`만 지정하던 방식과 달리 발송 데이터 자체를 변경했다.
- 기존 최상위 필드는 유지한다. 미지원 브라우저는 기존 SW가 한 번 표시하고 기존 클릭 복구를 사용한다. 모든 wire URL은 생성된 알림 ID 자체의 상세 화면이며, raw 내부 링크나 다른 ID가 클릭 목적지를 바꾸지 않는다. 관련 내부 링크는 D1에만 보존한다.
- canonical native URL은 `https://tiantian-chinese.pages.dev/?push_notification=<id>`다. 인증 토큰·본문은 URL에 넣지 않는다. 구독 DB에 설치 origin이 없으므로 과거 GitHub 도메인·localhost·preview 설치를 별도 native 목적지로 지원하는 변경은 아니다.
- JSON은 UTF-8 3993바이트, 실제 aes128gcm 요청 본문은 4096바이트 이하로 제한한다. 긴 wire 본문·태그만 축약하며 D1의 기존 정규화된 원문은 보존한다. PWA는 인증된 D1 응답을 우선하여 캐시/푸시 미리보기를 전체 본문으로 교체하고, 뒤늦은 미리보기가 원문을 덮지 않게 한다.
- 인증·발행 권한·VAPID 키·암호화 방식·DB 스키마·구독 등록은 변경하지 않았다. 최신 알림을 임의로 고르는 복귀 fallback도 추가하지 않았다.

## 검증

- Worker 단위/통합 테스트: 선언형 필수값·고정 origin·생성 ID 일치·미지원 호환 필드·긴 한글/이모지/JSON escape·실제 암호문 크기 경계·D1 원문 보존.
- PWA: 전체 500개 중 버전 기대값 1개만 처음 실패, 기대값을 .9로 수정하고 영향 26개를 재실행하여 통과. lint ERROR 0(기존 경고는 범위 밖), build 성공 `index-BSO97c0_.js` 524.94 kB/gzip 148.01 kB, design audit ERROR 0/WARN 0/REVIEW 100.
- `node 02_devtools/qa-declarative-push.mjs`: 실제 serializer 결과와 실제 production SW를 로컬 Chrome에서 사용. 모든 외부 API는 합성 fixture로 격리했고 실제 푸시는 보내지 않았다.
- legacy 단일 표시·cold/warm 실패 복구·같은 알림 재클릭·native query cold/warm 진입·라우터 이벤트 없는 복귀·클릭한 이전 알림 선택·인증 후 상세 복구·캐시 미리보기 원문 교체 확인. 수신만 하거나 일반 focus 복귀만 할 때는 팝업이 열리지 않음. 앱 오류 0.
- 모바일 390×844, 데스크톱 1440×1000에서 줄바꿈·본문 마지막 줄·닫기 버튼·가로 넘침 없음 확인. 증거: [result.json](result.json), [모바일](mobile-exact-report.png), [데스크톱](desktop-exact-report.png).
- 로컬 확인 URL: http://localhost:5180 (해당 작업트리의 production preview 유지).

## 아직 확인하지 않은 범위

OS 알림센터의 실제 APNS/FCM 전달과 iOS/Android 홈 화면 앱의 클릭은 이 자동 검수가 증명하지 않는다. 배포 후 **새로 보낸** 알림으로 두 기기의 cold/warm 상태를 확인해야 한다. 이전 알림에는 이전 발송 데이터가 남는다. 선언형 처리에서는 SW `push-shown`/`click` 기록이 없는 것만으로 실패라고 판단하지 않는다.

## 근거

- [Apple WWDC25 Declarative Web Push](https://developer.apple.com/videos/play/wwdc2025/235/): 선언형 필수값, mutable 생략 시 직접 표시/이동, 미지원 브라우저와 공존.
- [WebKit 소개](https://webkit.org/blog/16535/meet-declarative-web-push/): 선언형 메시지와 지원 환경.
- [RFC 8291 §4](https://www.rfc-editor.org/rfc/rfc8291#section-4): 암호화 Web Push의 메시지 크기 예산.
