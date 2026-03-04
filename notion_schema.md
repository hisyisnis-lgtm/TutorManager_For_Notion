# Notion DB 스키마

> 마지막 업데이트: 2026-03-04

**이 문서는 PWA/스크립트 개발 시 참조하는 단일 소스입니다.**
Notion DB 구조가 바뀔 때마다 이 파일을 먼저 업데이트하세요.

---

## 범례

- ✅ 쓰기 가능 (API로 생성/수정 가능)
- 🔒 읽기 전용 (formula, rollup, created_time, 자동 계산)

---

## DB ID 목록

| DB | ID | 상수 위치 |
|---|---|---|
| 학생 | `314838fa-f2a6-8143-a6c7-e59c50f3bbdb` | `STUDENTS_DB` — pwa/src/api/students.js |
| 수업 캘린더 | `314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb` | `CLASSES_DB` — pwa/src/api/classes.js |
| 수업 유형 설정 | `314838fa-f2a6-81c3-b4e4-da87c48f9b43` | `CLASS_TYPES_DB` — pwa/src/api/classTypes.js |
| 할인 이벤트 | `314838fa-f2a6-81d3-9ce4-c628edab065b` | `DISCOUNTS_DB` — pwa/src/api/discounts.js |
| 수강료 결제 내역 | `314838fa-f2a6-8154-935b-edd3d2fbea83` | `PAYMENTS_DB` — pwa/src/api/payments.js |
| 수업 일지 | `318838fa-f2a6-81f1-9b9c-fd379b1026ed` | `LESSON_LOGS_DB` — pwa/src/api/lessonLogs.js |

---

## 1. 학생 DB

| 속성명 | Notion 타입 | 쓰기 | API 쓰기 형식 | 읽기 접근자 | 비고 |
|---|---|---|---|---|---|
| 이름 | title | ✅ | `{ title: [{ text: { content: "..." } }] }` | `?.title?.[0]?.plain_text` | 필수 |
| 상태 | select | ✅ | `{ select: { name: "..." } }` | `?.select?.name` | 🟢 수강중 / 🟡 일시중단 / ⚫ 수강종료 |
| 전화번호 | phone_number | ✅ | `{ phone_number: "010-..." }` | `?.phone_number` | |
| 이메일 | email | ✅ | `{ email: "..." }` | `?.email` | |
| 레벨 | rich_text | ✅ | `{ rich_text: [{ text: { content: "..." } }] }` | `?.rich_text?.[0]?.plain_text` | 자유 텍스트 |
| 목표 | rich_text | ✅ | `{ rich_text: [{ text: { content: "..." } }] }` | `?.rich_text?.[0]?.plain_text` | 자유 텍스트 |
| 날짜 | date | ✅ | `{ date: { start: "YYYY-MM-DD" } }` | `?.date?.start` | 메모용 날짜 |
| 메모 | rich_text | ✅ | `{ rich_text: [{ text: { content: "..." } }] }` | `?.rich_text?.[0]?.plain_text` | |
| 등록일 | created_time | 🔒 | — | `?.created_time` | 자동 기입 |
| 수업 이력 | relation | 🔒 | — | `?.relation` | 수업 캘린더 백링크, 자동 연결 |
| 결제 | relation | 🔒 | — | `?.relation` | 수강료 결제 내역 백링크, 자동 연결 |
| 수업 일지 | relation | 🔒 | — | `?.relation` | 수업 일지 백링크, 자동 연결 |
| 총 수업 횟수 | rollup | 🔒 | — | `?.rollup?.number` | 수업 이력.수업 회차 sum |
| 사용 시간 회차 | rollup | 🔒 | — | `?.rollup?.number` | 수업 이력.시간 회차 sum |
| 결제 시간 회차 합계 | rollup | 🔒 | — | `?.rollup?.number` | 결제.유효 시간 회차 sum |
| 총 결제 금액 | rollup | 🔒 | — | `?.rollup?.number` | 결제.1인 결제 금액 sum |
| 미수금 합계 | rollup | 🔒 | — | `?.rollup?.number` | 결제.1인 미수금 sum |
| 잔여 시간 회차 | formula | 🔒 | — | `?.formula?.number` | 결제 시간 회차 합계 − 사용 시간 회차 |

---

## 2. 수업 캘린더 DB

| 속성명 | Notion 타입 | 쓰기 | API 쓰기 형식 | 읽기 접근자 | 비고 |
|---|---|---|---|---|---|
| 제목 | title | ✅* | `{ title: [{ text: { content: "..." } }] }` | `?.title?.[0]?.plain_text` | *sync_class_titles.mjs 자동 기입 (빈 제목에만) |
| 학생 | relation | ✅ | `{ relation: [{ id: "..." }, ...] }` | `?.relation?.map(r => r.id)` | 학생 DB, 다중 선택 (2:1 지원) |
| 수업 유형 | relation | ✅ | `{ relation: [{ id: "..." }] }` | `?.relation?.[0]?.id` | 수업 유형 설정 DB |
| 수업 일시 | date | ✅ | `{ date: { start: "ISO8601" } }` | `?.date?.start` | |
| 수업 시간(분) | select | ✅ | `{ select: { name: "60" } }` | `?.select?.name` | 60 / 90 / 120 / 150 / 180 |
| 특이사항 | select | ✅ | `{ select: { name: "..." } }` 또는 `{ select: null }` | `?.select?.name` | 🔴 결석 / 🟠 보강 / 🚫 취소 |
| 충돌_감지 | checkbox | 🔒 | — | `?.checkbox` | GitHub Actions 자동 기입, 직접 수정 금지 |
| 상태 | formula | 🔒 | — | `?.formula?.string` | 🔴미입력 / 🔵예정 / 🟢완료 |
| 메모 | formula | 🔒 | — | `?.formula?.string` | 특이사항 기반 자동 |
| 충돌 | formula | 🔒 | — | `?.formula?.string` | ⚠️ 충돌 / 빈값 |
| 수업 종료 시간 | formula | 🔒 | — | `?.formula?.date?.start` | |
| 수업 회차 | formula | 🔒 | — | `?.formula?.number` | |
| 시간 회차 | formula | 🔒 | — | `?.formula?.number` | 60분=1, 90분=1.5, 120분=2 |
| 시간 회차 부족 | formula | 🔒 | — | `?.formula?.string` | ⚠ 시간 회차 부족 / 빈값 |
| 무료 수업 | rollup | 🔒 | — | `?.rollup?.number` | 수업 유형.1인 단가 sum (0=무료) |
| 학생 잔여 시간 회차 | rollup | 🔒 | — | `?.rollup?.number` | 학생.잔여 시간 회차 min |

---

## 3. 수업 유형 설정 DB

> PWA에서 읽기 전용으로만 사용 (드롭다운 목록 표시용)

| 속성명 | Notion 타입 | 읽기 접근자 | 비고 |
|---|---|---|---|
| 타이틀 | title | `?.title?.[0]?.plain_text` | |
| 수업 유형 | select | `?.select?.name` | 1:1 / 2:1 |
| 시간(분) | number | `?.number` | |
| 1인 단가 | number | `?.number` | |
| 메모 | rich_text | `?.rich_text?.[0]?.plain_text` | |
| 결제 | relation | 🔒 | 백링크, 자동 연결 |
| 학생 수 | formula | 🔒 | 1:1→1, 2:1→2 |
| 단가 안내 | formula | 🔒 | |

---

## 4. 할인 이벤트 DB

> PWA에서 읽기 전용으로만 사용 (드롭다운 목록 표시용)

| 속성명 | Notion 타입 | 읽기 접근자 | 비고 |
|---|---|---|---|
| 이벤트명 | title | `?.title?.[0]?.plain_text` | |
| 할인율(%) | number | `?.number` | |
| 시작일 | date | `?.date?.start` | |
| 종료일 | date | `?.date?.start` | |
| 강제 ON | checkbox | `?.checkbox` | |
| 강제 OFF | checkbox | `?.checkbox` | |
| 활성 여부 | formula | 🔒 `?.formula?.boolean` | |
| 메모 | rich_text | `?.rich_text?.[0]?.plain_text` | |
| 결제 | relation | 🔒 | 백링크, 자동 연결 |

---

## 5. 수강료 결제 내역 DB

| 속성명 | Notion 타입 | 쓰기 | API 쓰기 형식 | 읽기 접근자 | 비고 |
|---|---|---|---|---|---|
| 비고 | title | ✅ | `{ title: [{ text: { content: "..." } }] }` | `?.title?.[0]?.plain_text` | 메모용 제목 |
| 학생 | relation | ✅ | `{ relation: [{ id: "..." }] }` | `?.relation?.map(r => r.id)` | 학생 DB |
| 수업 종류 | relation | ✅ | `{ relation: [{ id: "..." }] }` | `?.relation?.[0]?.id` | 수업 유형 설정 DB |
| 할인 적용 | relation | ✅ | `{ relation: [{ id: "..." }] }` | `?.relation?.[0]?.id` | 할인 이벤트 DB (선택) |
| 시간 회차 | number | ✅ | `{ number: 8 }` | `?.number` | 수동 입력 필수 |
| 실제 결제 금액 | number | ✅ | `{ number: 400000 }` | `?.number` | 수동 입력 필수 |
| 결제수단 | select | ✅ | `{ select: { name: "..." } }` | `?.select?.name` | 카드 / 계좌이체(현영O) / 계좌이체(현영X) / 현금(현영O) / 현금(현영X) |
| 결제일 | date | ✅ | `{ date: { start: "YYYY-MM-DD" } }` | `?.date?.start` | |
| 메모 | rich_text | ✅ | `{ rich_text: [{ text: { content: "..." } }] }` | `?.rich_text?.[0]?.plain_text` | |
| 시간당 단가 | rollup | 🔒 | — | `?.rollup?.number` | 수업 종류.1인 단가 max |
| 적용 할인율(%) | rollup | 🔒 | — | `?.rollup?.number` | 할인 적용.할인율(%) max |
| 유효 시간 회차 | formula | 🔒 | — | `?.formula?.number` | |
| 결제 금액 | formula | 🔒 | — | `?.formula?.number` | |
| 시간 회차 금액 | formula | 🔒 | — | `?.formula?.string` | |
| 미수금 | formula | 🔒 | — | `?.formula?.number` | |
| 결제 상태 | formula | 🔒 | — | `?.formula?.string` | 🟢완료 / 🔴미완료 / ⬛미결제 / ⚠️초과금 |
| 단가 안내 | formula | 🔒 | — | `?.formula?.string` | |
| 1인 결제 금액 | formula | 🔒 | — | `?.formula?.number` | 학생 DB rollup용 |
| 1인 미수금 | formula | 🔒 | — | `?.formula?.number` | 학생 DB rollup용 |
| 미입력 항목 | formula | 🔒 | — | `?.formula?.string` | |

---

## 6. 수업 일지 DB

| 속성명 | Notion 타입 | 쓰기 | API 쓰기 형식 | 읽기 접근자 | 비고 |
|---|---|---|---|---|---|
| 제목 | title | ✅* | `{ title: [{ text: { content: "..." } }] }` | `?.title?.[0]?.plain_text` | *create_lesson_logs.mjs 자동 생성 ("이름 M/D") |
| 수업 | relation | ✅ | `{ relation: [{ id: "..." }] }` | `?.relation?.[0]?.id` | 수업 캘린더 DB |
| 학생 | relation | ✅ | `{ relation: [{ id: "..." }, ...] }` | `?.relation?.map(r => r.id)` | 학생 DB |
| 오늘 내용 | rich_text | ✅ | `{ rich_text: [{ text: { content: "..." } }] }` | `?.rich_text?.[0]?.plain_text` | |
| 숙제 | rich_text | ✅ | `{ rich_text: [{ text: { content: "..." } }] }` | `?.rich_text?.[0]?.plain_text` | |
| 다음 수업 준비 | rich_text | ✅ | `{ rich_text: [{ text: { content: "..." } }] }` | `?.rich_text?.[0]?.plain_text` | |
| 학생 참여도 | select | ✅ | `{ select: { name: "..." } }` | `?.select?.name` | 😊 좋음 / 😐 보통 / 😞 저조 |
| 메모 | rich_text | ✅ | `{ rich_text: [{ text: { content: "..." } }] }` | `?.rich_text?.[0]?.plain_text` | |

---

## 구조 변경 시 업데이트 체크리스트

Notion DB 속성이 추가/변경/삭제될 때:

1. **이 파일 (`notion_schema.md`)** 해당 DB 섹션 수정
2. **`pwa/src/api/`** 해당 파일의 `parse*`, `create*`, `update*` 함수 수정
3. **`README.md`** formula 등 비즈니스 로직이 변경된 경우 해당 섹션 수정
