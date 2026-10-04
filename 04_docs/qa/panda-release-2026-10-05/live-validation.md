# 랴오랴오 실제 학생 세션 검증

2026-10-05 KST. 사용자가 지정한 TEST 학생의 정상 OTP 로그인 세션만 사용했다. 운영 Worker와 v2.49.0 후보 빌드를 검증했다. 인증값·개인 식별자는 기록하지 않는다.

## 서버 저장 및 일회성 전환

- 첫 인증 GET HTTP 200: 누적 획득 23개, 먹인 수 0개, 사용 가능 23개, 아이템 소비 0개, revision 0. transition version 1 / startingFood 23. 알부터 시작하며 이전에 먹였던 수를 로컬에서 가져오지 않는다.
- 먹이 1개 요청 HTTP 200: 먹인 수 1개, 사용 가능 22개, revision 1.
- 같은 requestId와 같은 본문을 재전송: HTTP 200, 수치 변화 없음. 중복 차감 없음.
- 같은 requestId에 다른 개수를 전달: HTTP 409 / request_id_reused. 상태 변화 없음.
- 재접속 GET: 먹인 수 1개, 사용 가능 22개, revision 1. 첫 전환의 initializedAt과 startingFood 유지.
- 서로 분리된 새 브라우저 컨텍스트 두 개에서 기존의 정상 세션으로 조회: 각각 HTTP 200, 먹인 수 1개 / 사용 가능 22개 / revision 1. 로컬 판다 캐시 없이 서버 기록이 복원됐다.
- 실제 후보 화면에서 전환 안내를 정상 확인한 뒤 다시 GET: HTTP 200, 먹인 수 1개 / 사용 가능 22개 / revision 2 / noticeSeen true. 전환 초기화 시각과 startingFood는 그대로 유지됐다.

## 후보 빌드 화면

- 실제 dist preview: http://localhost:5312/personal/<TEST>/panda. 운영 API에 정상 학생 인증으로 연결했다.
- 화면 크기 320×568, 390×844, 1280×900에서 확인했다.
- 각 새 컨텍스트에 구버전 로컬 성장값 176을 남긴 상태에서도 알(Lv.1)과 서버 먹이 22개가 표시됐다. 기존 로컬 값은 보존하되 새 성장 상태에 반영하지 않았다.
- 첫 화면의 전환 안내 확인 뒤 다른 컨텍스트에서는 안내가 반복되지 않았다.
- 세 크기 모두 가로 넘침 없음, pageerror 없음. 실제 UI 확인은 먹이주기 화면과 전환 안내에 한정한다.
- 스크린샷은 같은 폴더의 live-game-320.png / live-game-390.png / live-game-1280.png에 로컬 보관한다. 정상 학생 화면 캡처는 공개 Git에 포함하지 않는다.

## 검증 범위

d1Migration, authenticatedReadWrite, retryWithoutDoubleDebit, secondDeviceSync, transitionOnce의 실제 검증 근거다. R2 백업·다운로드·복원 검증과 공개된 PWA 최종 확인은 별도 결과가 필요하며 이 기록만으로 통과 처리하지 않는다.
