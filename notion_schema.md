# Notion DB 스키마

> 조회 시각: 2026. 2. 28. PM 8:22:43


---

## 학생 DB

| 속성명 | 타입 |
|---|---|
| 이름 | title |
| 총 수업 횟수 | rollup (수업 회차, sum) |
| 등록일 | created_time |
| 결제 시간 회차 합계 | rollup (시간 회차, sum) |
| 결제 | relation |
| 총 결제 금액 | rollup (1인 결제 금액, sum) |
| 수업 이력 | relation |
| 잔여 시간 회차 | formula |
| 목표 | select (회화 / 발음 / 회화/발음 / 취미) |
| 이메일 | email |
| 사용 시간 회차 | rollup (시간 회차, sum) |
| 상태 | select (🟢 수강중 / 🟡 일시중단 / ⚫ 수강종료) |
| 레벨 | select (입문 / 초급 / 중급 / 고급 / 비즈니스) |
| 전화번호 | phone_number |
| 미수금 합계 | rollup (1인 미수금, sum) |
| 메모 | rich_text |

---

## 수업 캘린더 DB

| 속성명 | 타입 |
|---|---|
| 제목 | title |
| 충돌 | checkbox |
| 무료 수업 | rollup (무료, checked) |
| 수업 일시 | date |
| 상태 | formula (예정 / 완료, 수업 일시 기반 자동) |
| 특이사항 | select (🔴 결석 / 🟠 보강 / 🚫 취소) |
| 수업 유형 | relation |
| 수업 종료 시간 | formula |
| 시간 회차 | formula |
| 수업 시간(분) | select (60 / 90 / 120 / 150 / 180) |
| 메모 | rich_text |
| 수업 회차 | formula |
| 학생 | relation |
| 학생 잔여 시간 회차 | rollup (잔여 시간 회차, min) |
| 시간 회차 부족 | formula |

---

## 수업 유형 설정 DB

| 속성명 | 타입 |
|---|---|
| 타이틀 | title |
| 수업 유형 | select (1:1 / 2:1) |
| 무료 | checkbox |
| 결제 | relation |
| 학생 수 | formula |
| 메모 | rich_text |
| 시간(분) | number |
| 1인 단가 | number |
| 단가 안내 | formula |

---

## 할인 이벤트 DB

| 속성명 | 타입 |
|---|---|
| 이벤트명 | title |
| 결제 | relation |
| 비활성 | checkbox |
| 활성 | checkbox |
| 할인율(%) | number |
| 메모 | rich_text |
| 종료일 | date |
| 강제 OFF | checkbox |
| 활성 여부 | formula |
| 강제 ON | checkbox |
| 시작일 | date |

---

## 수강료 결제 내역 DB

| 속성명 | 타입 |
|---|---|
| 타이틀 | title |
| 메모 | rich_text |
| 미수금 | formula |
| 실제 결제 금액 | number |
| 시간 회차 | number |
| 수업 종류 | relation |
| 단가 안내 | formula |
| 결제수단 | select (계좌이체 / 현금 / 카드) |
| 적용 할인율(%) | rollup (할인율(%), max) |
| 1인 결제 금액 | formula |
| 결제일 | date |
| 결제 금액 | formula |
| 미입력 항목 | formula |
| 1인 미수금 | formula |
| 할인 적용 | relation |
| 학생 | relation |
| 시간당 단가 | rollup (1인 단가, max) |
| 결제 상태 | formula |