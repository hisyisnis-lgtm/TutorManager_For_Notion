# 푸시 연결을 보존하는 앱 업데이트 검수 — v2.47.8

최종 `index-DeF5MWZ2.js` 빌드에서 설정 버튼의 실제 새 SW 교체·기록 보존과 timeout 복귀·재시도가 통과했다. 실기기 푸시 클릭 성공을 대신하는 검수는 아니다.

## 변경 근거와 제한

사용자 실기기 v2.47.7 진단은 앱·SW 버전 일치, 알림 ID·native query 없음, URL과 Router 일치, pending 없음, SW 이벤트 기록 없음이었다. `activating`은 응답 전의 상태 표본이므로 이것만으로 장기 고착을 단정할 수 없다. 이번 진단은 응답 시점 상태도 다시 읽는다.

사용자는 설정의 강력 새로고침을 사용했다고 확인했다. 기존 설정 버튼이 CacheStorage 전체 삭제와 SW `unregister()`를 실행하는 것은 코드에서 확인된 결함이다. 일반 Web Push 구독은 등록 해제 시 비활성화 대상이며, `activating` 중 functional event는 활성화 완료를 기다린다. [Push API 구독 비활성화 규정](https://w3c.github.io/push-api/#subscription-deactivation), [Service Worker 이벤트 규정](https://w3c.github.io/ServiceWorker/#fire-functional-event-algorithm)

이 결함이 실기기 warm 클릭 실패의 유일한 원인이거나 이번 수정으로 해결됐다고 단정하지 않는다.

## 범위

- `qa-push-click.mjs`: 기존 cold/warm 전달 실패, native query/hash 복구, 로그인, 긴 본문, 진단 정보 비식별화 회귀 검사. 로컬 production preview `http://localhost:5180`이 필요하다.
- `qa-service-worker-update.mjs`: `pwa/dist`를 전용 로컬 서버 `http://localhost:5181`로 제공한다. 기본 모드는 production SW에 revision 주석만 덧붙여 실제 등록 갱신을 요청한다. `QA_SAME_VERSION_CASE=1`은 SW 내용 변경 없이 현재 등록의 수동 업데이트를 검사한다.
- `QA_AUTO_UPDATE_CASE=1`은 계측·observer·시딩 없는 실제 앱 한 개에서 Settings를 누르지 않고 현재 registration의 `update()`만 호출한다. 앱의 주기적 검사와 같은 Vite `onNeedRefresh` → App → helper 경로를 검사한다.
- 설정의 ‘앱 업데이트’를 직접 눌러 동일 registration 유지, `activated` 후 한 번만 리로드, `unregister` 및 푸시 캐시 삭제 없음, 합성 클릭 기록의 재시작 후 상세 팝업 복구, 진단 캐시 보존을 검사한다. 팝업 수신 후 정상 ACK 삭제는 보존 실패로 보지 않는다.
- 익명 `/personal` 학생 공개 경로의 부팅·학생 코드 입력 화면 도달도 검사한다.
- 선택 `QA_ACTIVATION_GATE=1` / `QA_UPDATE_TIMEOUT_CASE=1`은 검수용 activate 대기를 추가한다. timeout 모드는 16초 이상 지연 후 앱 복귀·재시도를 검사한다. 둘 다 최종 빌드에서 통과했다.

검사 앱은 한 개다. 비앱 observer 문서는 SW 등록 전에 같은 origin에서 먼저 열고 title을 검증한다. 실제 여러 앱 탭의 동시 갱신 호환성을 검증하는 구성은 아니다.

운영 파일을 수정하지 않고 로컬 서버의 JS 응답에서 운영 Worker API base 문자열만 `/__qa_api__`로 바꿔 합성 API를 제공한다. 외부 폰트 요청도 fixture로 차단하고 Chrome의 외부 hostname DNS 해석을 막는다. 따라서 API가 production SW의 운영 API용 NetworkOnly 규칙을 통과하는 연동 검수는 아니다. 실제 알림 발송·PushManager 구독 생성·운영 쓰기는 하지 않는다. 기존 구독 유무는 로컬 boolean으로만 비교하며 실제 구독 유지 성공을 대신하지 않는다.

## 확인 결과

- 최종 `index-DeF5MWZ2.js`의 신규 revision + activation gate 검사는 표준 Playwright routing, 기본 `updateViaCache: 'imports'`로 1회 통과했다. 실제 새 SW가 activating이고 이전 SW가 redundant인 동안 재시작하지 않았으며, activated 이후 정확히 한 번 재시작했다. 같은 registration 유지, unregister 0회, 푸시 캐시 전체 삭제 없음, 진단 원문 보존, pending 상세 팝업 복구·정상 ACK, 학생 공개 경로 부팅을 확인했다. JS 오류와 외부 API 시도 0, 로컬 fixture 13건(합성 POST 8건), 외부 폰트 fixture 2건이었다.
- 같은 최종 빌드의 timeout 검사는 1회 통과했다. 활성화를 16초 이상 지연했을 때 영구 splash 대신 설정 화면과 활성 업데이트 버튼으로 복귀했고, 오류 안내도 캡처에서 확인했다. 지연 해제 후 재시도에서 activated 이후 한 번 재시작하고 위 기록 보존·팝업 복구·학생 부팅 조건을 모두 만족했다. JS 오류와 외부 API 시도 0, 로컬 fixture 18건(합성 POST 12건), 외부 폰트 fixture 2건이었다.
- 최종 화면 증거를 갱신하고 직접 확인했다. `mobile-update-timeout-recovery.png`는 오류 안내와 다시 사용할 수 있는 앱 업데이트 버튼을 함께 보여준다. `mobile-settings-safe-update.png`의 버튼·보존 안내는 BottomNav에 가리지 않는다. `mobile-after-safe-update.png`의 합성 팝업 내용·닫기 버튼과 `mobile-student-after-update.png`의 학생 코드 입력 화면에 가로 잘림이 없다.
- 부모 작업에서 최종 `index-DeF5MWZ2.js`의 `qa-push-click.mjs` 클릭·진단 회귀도 통과했고 브라우저 오류는 0이었다. 최종 설정·timeout 오류 안내·팝업 캡처는 부모와 검수 작업자가 직접 확인했다.
- 이전 `index-DrHdnq5p.js` 빌드의 `QA_SAME_VERSION_CASE=1`도 기록 보존·activated 이후 1회 재시작·학생 공개 부팅 조건을 통과했다. 동일 버전 검사의 별도 이력이며 위 최종 신규 revision 검수와 구분한다. 모든 실행에서 실제 PushSubscription은 만들지 않았다.
- 수정 전 `index-DrHdnq5p.js`의 Settings 새 revision 검사는 실패했다. native `skipWaiting`/`waitUntil` 계측 wrapper를 제거하고 revision 주석만 추가한 재현에서도 새 SW는 `installed`, 기존 active/controller는 `activated`였으며 SKIP_WAITING 메시지는 전송됐지만 리로드는 0회였다. 15초 뒤 앱은 돌아와 기존 pending을 소비했으므로 팝업 표시만으로 업데이트 성공 처리하지 않았다. 최종 빌드는 Settings가 App의 update effect를 경유하도록 바뀌었으며, 위 실제 신규 revision 검수로 재확인했다.
- 초기 observer를 등록 후 열던 구성에서는 Workbox navigation fallback 때문에 observer도 앱으로 열리는 검수 결함이 발견됐다. 해당 초기 결과는 정상 단일 앱 검수 증거로 사용하지 않는다. 정적 observer 선오픈으로 고친 뒤에도 신규 revision 대기가 남았으므로 이를 유일한 실패 원인으로 단정하지 않는다. `lifecycle-failure-normal.png`는 미완료 경로의 화면 증거이며 통과 증거가 아니다.
- 초기 구성의 timeout 검수는 완료되지 않았으므로 그 결과는 통과로 세지 않았다. 동일 파일명의 timeout 캡처는 최종 통과 실행에서 새로 생성한 증거로 갱신했다.
- 독립 비교 `qa-sw-minimal.mjs`는 같은 Chrome 152.0.7977.65의 정적 문서 2개에서 minimal SW와 현재 production SW 모두 SKIP_WAITING 1회 후 이전 SW redundant·새 active/controller activated 전환에 성공했다. 이 비교는 `updateViaCache: 'none'`, 앱 미실행, gate·API 응답 치환 없음이라는 별도 조건이다. production SW 자체의 갱신 가능성을 확인한 것이며 실제 앱의 신규 revision 경로 통과를 대신하지 않는다.
- 같은 정적 문서 비교에서 실제 `serviceWorkerUpdate.js`의 `requestAppUpdate()`도 새 worker/controller activated 이후 정확히 한 번 리로드하는 데 성공했다. helper 단독이 갱신을 막는 증거는 발견되지 않았다.

## 원인 경계 비교

아래는 수정 전 `index-DrHdnq5p.js`에서 원인 범위를 좁히기 위해 각각 한 번씩 비교한 이력이다. 비교 당시 SW 원본과 앱 소스는 변경하지 않았으며 서버 응답의 API base 치환·외부 DNS 차단을 유지했다.

| 비교 조건 | 확인 결과 |
| --- | --- |
| 전역 Playwright routing 제거 | 신규 SW installed, 기존 active/controller activated, 리로드 0. 외부 API 시도와 실패 시 미완료 request 모두 0 |
| 위 조건에 등록 옵션 `updateViaCache: 'none'`만 추가 | 등록 옵션 none을 확인했지만 같은 대기 상태. Vitest 종료 후 실행했으며 미완료 request 0 |
| `QA_BARE_APP_CASE=1`: 실제 앱 1개, observer·캐시 시딩·native 관찰 wrapper·beforeunload 기록·전역 routing 없음 | 새 SW installed가 유지되고 최상위 문서 load 없음. 15초 뒤 설정 화면 복귀, 미완료 request 0, 외부 API 시도 0, JS 오류 0 |
| 위 bare App 조건에 `PLAYWRIGHT_DISABLE_SERVICE_WORKER_NETWORK=1`만 추가 | 같은 installed 대기와 load 없음. SW별 네트워크 관측을 꺼도 해결되지 않았으며 미완료 request·외부 API 시도·JS 오류 모두 0 |
| 위 조건에서 `QA_AUTO_UPDATE_CASE=1`: Settings 클릭 대신 registration.update()만 호출 | 새 production SW activated, 새 registration.active와 controller 일치, 문서 load 정확히 1회. 외부 API 시도 0, 로컬 fixture 9건(합성 POST 7건), JS 오류 0 |

bare App 비교는 기존 보존 검수의 observer/시딩/관찰 코드 없이도 수동 경로에서 현상이 나타남을 보여줬다. 동일 조건에서 자동 경로는 성공하여 수동/자동 진입 경로 차이로 범위가 좁혀졌다. 자동 경로 결과는 재시작 뒤 새 worker/controller의 activated 상태를 확인한 것이며, 계측을 생략한 bare 모드이므로 재시작 직전 상태 타임라인·푸시 캐시 보존·실제 알림 클릭을 함께 검증한 결과는 아니다. 최종 빌드에서는 수동 요청도 App 경로로 연결한 뒤 전체 보존 검수가 통과했다. 이것만으로 WebKit 실기기의 모든 문제 원인을 단정하지 않는다.

과거 App만 별도로 빌드한 비교는 준비했으나 자동/수동 비교로 범위가 좁혀져 실행하지 않았다. 임시 빌드와 미사용 QA 선택지는 정리했으며 이 비교를 결과 근거로 사용하지 않는다.

## 실행

부모 작업에서 v2.47.8 production 빌드를 완료한 뒤 레포 루트에서 실행한다. 환경의 Playwright 설치 경로가 기본 모듈 탐색 경로에 없으면 `QA_PLAYWRIGHT_PACKAGE`, Chrome 경로가 다르면 `QA_CHROME_PATH`를 지정한다.

```text
node 02_devtools/qa-push-click.mjs
node 02_devtools/qa-service-worker-update.mjs
```

검증된 동일 버전 범위(PowerShell): `$env:QA_SAME_VERSION_CASE='1'`을 설정하고 두 번째 스크립트를 실행한다. 이때 `QA_UPDATE_TIMEOUT_CASE`, `QA_ACTIVATION_GATE`는 unset 또는 `0`이어야 한다. 사용 후 테스트 환경변수를 제거한다.

비교용 옵션은 각각 `QA_DISABLE_ROUTING=1`(전역 routing 제거), `QA_UPDATE_VIA_CACHE_NONE=1`(QA 등록 옵션만 none으로 변경), `QA_BARE_APP_CASE=1`(실제 앱 단독·보존 계측 생략)이다. bare App 비교에는 `QA_DISABLE_ROUTING=1`만 함께 지정했고 나머지 옵션은 unset으로 실행했다. 이 옵션들의 실패를 정상 회귀 검사 통과로 처리하지 않는다.

빌드는 `pwa/dist`만 사용한다. `QA_AUTO_UPDATE_CASE=1`은 bare App 조건을 자동 적용하며 gate/same-version 모드와 함께 사용할 수 없다. 자동 경로의 확인된 실행은 수정 전 dist에 `QA_AUTO_UPDATE_CASE=1`, `QA_DISABLE_ROUTING=1`, `PLAYWRIGHT_DISABLE_SERVICE_WORKER_NETWORK=1`을 지정했고 나머지 변경 옵션은 0이었다.

최종 신규 revision 검수는 `QA_ACTIVATION_GATE=1`, timeout 검수는 여기에 `QA_UPDATE_TIMEOUT_CASE=1`을 추가한다. 두 실행 모두 bare/auto/same-version/disable-routing/cache-override/direct-skip 옵션은 0이고 `PLAYWRIGHT_DISABLE_SERVICE_WORKER_NETWORK`는 unset이었다. 미사용 baseline 선택지를 제거한 뒤에는 구문 검사만 실행했으며 통과한 검수 경로와 앱 코드는 변경하지 않았다.

첫 스크립트의 preview 서버는 유지한다. 둘째 스크립트가 만드는 격리 서버·브라우저는 검사 후 정리한다. 결과 JSON과 이 폴더의 PNG가 실행 증거다.

이 검수는 실제 iPhone/Android 알림센터 클릭 검수가 아니다. 성공하더라도 실기기 백그라운드 팝업 해결로 보고하지 않는다.
