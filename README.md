# 중국어 튜터링 관리 - 노션 DB 구조

노션(Notion)을 활용한 중국어 튜터링 관리 시스템입니다.

---

## 노션 연동 정보

| 항목 | 값 |
|---|---|
| 통합 토큰 | `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` |
| 부모 페이지 ID | `314838faf2a680cd9228ed96590fffe7` |

### DB ID 목록

| DB | ID |
|---|---|
| 학생 | `314838fa-f2a6-8143-a6c7-e59c50f3bbdb` |
| 수업 이력 | `314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb` |
| 수업 단가 | `314838fa-f2a6-81c3-b4e4-da87c48f9b43` |
| 할인 이벤트 | `314838fa-f2a6-81d3-9ce4-c628edab065b` |
| 결제 | `314838fa-f2a6-8154-935b-edd3d2fbea83` |

---

## 비즈니스 정책

- **1:1 수업**: 60분 50,000원/인
- **2:1 수업**: 60분 40,000원/인
- 30분 단위 연장 가능 (기본 60분)
- **월별 결제 방식** (수강권 없음): 이번 달 몇 회 × 몇 시간 기준
- 수업 유형(1:1↔2:1) 변경 시에만 환불 후 재결제
- 일자/시간은 유동적으로 변경 가능

---

## DB 구조

### 1. 학생 DB

| 속성명 | 타입 | 설명 |
|---|---|---|
| 이름 | title | 학생 이름 |
| 전화번호 | phone_number | |
| 이메일 | email | |
| 레벨 | select | 입문 / 초급 / 중급 / 고급 / 비즈니스 |
| 목표 | select | 여행/일상회화 / 비즈니스 / HSK 준비 / 드라마/영화 / 기타 |
| 상태 | select | 🟢 수강중 / 🟡 일시중단 / ⚫ 수강종료 |
| 메모 | rich_text | |
| 등록일 | created_time | |
| 수업 이력 | relation | → 수업 이력 DB |
| 결제 | relation | → 결제 DB |
| 총 수업 횟수 | rollup | 수업 이력.수업 회차 sum |
| 사용 시간 회차 | rollup | 수업 이력.시간 회차 sum |
| 결제 시간 회차 합계 | rollup | 결제.시간 회차 sum |
| 총 결제 금액 | rollup | 결제.실제 결제 금액 sum |
| 미수금 합계 | rollup | 결제.미수금 sum |
| 잔여 시간 회차 | formula | `결제 시간 회차 합계 - 사용 시간 회차` |

---

### 2. 수업 이력 DB

| 속성명 | 타입 | 설명 |
|---|---|---|
| 제목 | title | 수업 제목 |
| 학생 | relation | → 학생 DB |
| 수업 일시 | date | |
| 수업 시간(분) | number | 60 / 90 / 120 등 |
| 상태 | select | 🔵 예정 / 🟢 완료 / 🔴 결석 / 🟠 보강 / 🚫 취소 |
| 메모 | rich_text | |
| 수업 회차 | formula | `if(상태 == "🟢 완료", 1, 0)` |
| 시간 회차 | formula | `if(상태 == "🟢 완료", 수업 시간(분) / 60, 0)` |

> **시간 회차 예시**: 60분 = 1, 90분 = 1.5, 120분 = 2

---

### 3. 수업 단가 DB

| 속성명 | 타입 | 설명 |
|---|---|---|
| 비고 | title | 단가 유형명 (예: 1:1 60분) |
| 수업 유형 | select | 1:1 / 2:1 |
| 시간(분) | number | 60 / 90 / 120 등 |
| 1인 단가 | number | 1인 기준 단가 (원) |
| 메모 | rich_text | |
| 할인 이벤트 | relation | → 할인 이벤트 DB |
| 결제 | relation | → 결제 DB (backlink, 자동 생성) |
| 현재 할인율(%) | rollup | 할인 이벤트.할인율(%) max |
| 단가 안내 | formula | 할인 전/후 가격 표시 |

**단가 안내 formula 로직:**
```
할인율 > 0이면: "50000원  →  45000원  (10% 할인)"
할인율 = 0이면: "50000원"
```

---

### 4. 할인 이벤트 DB

| 속성명 | 타입 | 설명 |
|---|---|---|
| 이벤트명 | title | |
| 수업 단가 | relation | → 수업 단가 DB |
| 결제 | relation | → 결제 DB (backlink, 자동 생성) |
| 할인율(%) | number | 할인율 (예: 10) |
| 시작일 | date | |
| 종료일 | date | |
| 강제 ON | checkbox | 기간 무관 강제 활성화 |
| 강제 OFF | checkbox | 기간 내에도 강제 비활성화 |
| 활성 여부 | formula | 자동 판단 (아래 참고) |
| 메모 | rich_text | |

**활성 여부 formula 로직 (우선순위):**
1. 강제 ON 체크 → `true`
2. 강제 OFF 체크 → `false`
3. 시작일/종료일 중 하나라도 없으면 → `false`
4. 오늘이 시작일~종료일 범위 안이면 → `true`, 아니면 → `false`

```
if(강제 ON, true,
  if(강제 OFF, false,
    if(empty(시작일) or empty(종료일), false,
      dateBetween(now(), 시작일, "days") >= 0
      and dateBetween(종료일, now(), "days") >= 0)))
```

---

### 5. 결제 DB

| 속성명 | 타입 | 설명 |
|---|---|---|
| 비고 | title | 메모용 제목 |
| 학생 | relation | → 학생 DB |
| 수업 유형 | select | 1:1 / 2:1 |
| 수업 종류 | relation | → 수업 단가 DB |
| 할인 적용 | relation | → 할인 이벤트 DB |
| 시간당 단가 | rollup | 수업 종류.1인 단가 max (계산용) |
| 단가 안내 | rollup | 수업 종류.단가 안내 show_original (표시용) |
| 적용 할인율(%) | rollup | 할인 적용.할인율(%) max |
| **시간 회차** | **number** | **수동 입력** (이번 달 총 시간 회차) |
| **실제 결제 금액** | **number** | **수동 입력** (실제 받은 금액) |
| 결제 금액 | formula | 자동 계산 (아래 참고) |
| 미수금 | formula | 자동 계산 |
| 결제 상태 | formula | 완료 / 미완료 / 미결제 |
| 결제수단 | select | 계좌이체 / 현금 / 카드 |
| 결제일 | date | |
| 메모 | rich_text | |

**결제 금액 formula:**
```
round(시간 회차 × 시간당 단가 × (1 - 적용 할인율(%) / 100) × 학생 수)
```
- 학생 수: `수업 유형 == "1:1"` → 1, `"2:1"` → 2

**결제 상태 판단:**
| 조건 | 상태 |
|---|---|
| 미수금 == 0 | 완료 |
| 실제 결제 금액 == 0 | 미결제 |
| 0 < 실제 결제 금액 < 결제 금액 | 미완료 |

---

## 결제 입력 순서

새 결제 레코드 작성 시:
1. **학생** 선택
2. **수업 유형** 선택 (1:1 / 2:1)
3. **수업 종류** 선택 → 시간당 단가 자동 표시
4. **할인 적용** 선택 (해당 시) → 할인율 자동 적용
5. **시간 회차** 입력 (예: 8회차 → 8, 8회차 90분씩이면 → 12)
6. → **결제 금액** 자동 계산됨
7. **실제 결제 금액** 입력 (받은 금액)
8. → **미수금**, **결제 상태** 자동 계산됨

---

## DB 관계도

```
학생 ──────────────────── 수업 이력
  │                          │
  └── 결제 ─── 수업 단가 ─── 할인 이벤트
```

- 학생 ↔ 수업 이력 (dual_property)
- 학생 ↔ 결제 (dual_property)
- 결제 ↔ 수업 단가 (dual_property, 결제 DB에서는 "수업 종류")
- 결제 ↔ 할인 이벤트 (dual_property, 결제 DB에서는 "할인 적용")
- 수업 단가 ↔ 할인 이벤트 (dual_property)

---

## 노션 API 작업 시 주의사항

1. **dual_property 생성 시 backlink 이름**: "Related to X (Y)" 형태로 자동 생성됨 → `PATCH /databases/{id}` 로 rename 필요

2. **formula에서 다른 formula 참조 불가**: 계산식을 직접 인라인으로 작성해야 함
   → 미수금, 결제 상태 등에서 결제 금액 계산식을 그대로 복사해서 사용

3. **rollup of rollup 불가**: rollup이 참조하는 속성이 또 rollup이면 에러
   → rollup of formula는 가능 (`show_original` 등)

4. **select 옵션 rename 불가**: API가 성공을 반환하지만 실제로 변경 안 됨
   → 속성을 `null`로 삭제 후 새 이름으로 재생성

5. **`length(prop("relation"))`은 문자 수 반환**: list 크기가 아님 (버그)
   → 학생 수는 `if(수업 유형 == "1:1", 1, 2)` 로 대체

6. **날짜 비교**: `dateBetween(now(), prop("시작일"), "days") >= 0`

7. **DB 아카이브**: `PATCH /pages/{id} { archived: true }` — 통합 앱 접근 권한 필요

---

## 스크립트 실행 환경 (Windows)

```bash
# Node.js가 PATH에 없는 경우 항상 추가
export PATH="/c/Program Files/nodejs:$PATH"

# API 호출 예시
node script.mjs
```

### API 호출 패턴

```javascript
const TOKEN = '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';

async function api(method, path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data)}`);
  return data;
}
```
