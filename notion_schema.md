# Notion DB 스키마

> 조회 시각: 2026. 3. 2.

---

## 학생 DB

| 속성명 | 타입 |
|---|---|
| 이름 | title |
| 상태 | select (🟢 수강중 / 🟡 일시중단 / ⚫ 수강종료) |
| 전화번호 | phone_number |
| 이메일 | email |
| 레벨 | rich_text |
| 목표 | rich_text |
| 날짜 | date |
| 메모 | rich_text |
| 등록일 | created_time |
| 수업 이력 | relation |
| 결제 | relation |
| 총 수업 횟수 | rollup (수업 회차, sum) |
| 사용 시간 회차 | rollup (시간 회차, sum) |
| 결제 시간 회차 합계 | rollup (유효 시간 회차, sum) |
| 총 결제 금액 | rollup (1인 결제 금액, sum) |
| 미수금 합계 | rollup (1인 미수금, sum) |
| 잔여 시간 회차 | formula |

---

## 수업 캘린더 DB

| 속성명 | 타입 |
|---|---|
| 제목 | title |
| 학생 | relation |
| 수업 유형 | relation |
| 수업 일시 | date |
| 수업 시간(분) | select (60 / 90 / 120 / 150 / 180) |
| 특이사항 | select (🔴 결석 / 🟠 보강 / 🚫 취소) |
| 메모 | formula |
| 충돌 | checkbox |
| 상태 | formula |
| 수업 종료 시간 | formula |
| 수업 회차 | formula |
| 시간 회차 | formula |
| 무료 수업 | rollup (1인 단가, sum) |
| 학생 잔여 시간 회차 | rollup (잔여 시간 회차, min) |
| 시간 회차 부족 | formula |

---

## 수업 유형 설정 DB

| 속성명 | 타입 |
|---|---|
| 타이틀 | title |
| 수업 유형 | select (1:1 / 2:1) |
| 시간(분) | number |
| 1인 단가 | number |
| 단가 안내 | formula |
| 학생 수 | formula |
| 메모 | rich_text |
| 결제 | relation |

---

## 할인 이벤트 DB

| 속성명 | 타입 |
|---|---|
| 이벤트명 | title |
| 할인율(%) | number |
| 시작일 | date |
| 종료일 | date |
| 강제 ON | checkbox |
| 강제 OFF | checkbox |
| 활성 여부 | formula |
| 메모 | rich_text |
| 결제 | relation |

---

## 수강료 결제 내역 DB

| 속성명 | 타입 |
|---|---|
| 타이틀 | title |
| 학생 | relation |
| 수업 종류 | relation |
| 할인 적용 | relation |
| 결제일 | date |
| 결제수단 | select (카드 / 계좌이체(현영O) / 계좌이체(현영X) / 현금(현영O) / 현금(현영X)) |
| 시간 회차 | number |
| 실제 결제 금액 | number |
| 시간당 단가 | rollup (1인 단가, max) |
| 적용 할인율(%) | rollup (할인율(%), max) |
| 유효 시간 회차 | formula |
| 결제 금액 | formula |
| 시간 회차 금액 | formula |
| 미수금 | formula |
| 결제 상태 | formula |
| 단가 안내 | formula |
| 1인 결제 금액 | formula |
| 1인 미수금 | formula |
| 미입력 항목 | formula |
| 메모 | rich_text |
