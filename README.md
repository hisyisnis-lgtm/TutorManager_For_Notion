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
| 수업 캘린더 | `314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb` |
| 수업 유형 설정 | `314838fa-f2a6-81c3-b4e4-da87c48f9b43` |
| 할인 이벤트 | `314838fa-f2a6-81d3-9ce4-c628edab065b` |
| 수강료 결제 내역 | `314838fa-f2a6-8154-935b-edd3d2fbea83` |

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
| 레벨 | rich_text | 입문 / 초급 / 중급 / 고급 / 비즈니스 |
| 목표 | rich_text | 회화 / 발음 / 회화+발음 / 취미 등 |
| 상태 | select | 🟢 수강중 / 🟡 일시중단 / ⚫ 수강종료 |
| 날짜 | date | 등록 기준일 등 별도 메모용 날짜 |
| 메모 | rich_text | |
| 등록일 | created_time | |
| 수업 이력 | relation | → 수업 캘린더 DB (dual_property) |
| 결제 | relation | → 수강료 결제 내역 DB (dual_property) |
| 총 수업 횟수 | rollup | 수업 이력.수업 회차 **sum** |
| 사용 시간 회차 | rollup | 수업 이력.시간 회차 **sum** |
| 결제 시간 회차 합계 | rollup | 결제.유효 시간 회차 **sum** (완료·초과금만 집계) |
| 총 결제 금액 | rollup | 결제.1인 결제 금액 **sum** |
| 미수금 합계 | rollup | 결제.1인 미수금 **sum** |
| 잔여 시간 회차 | formula | 아래 참고 |

**잔여 시간 회차 formula:**
```
prop("결제 시간 회차 합계") - prop("사용 시간 회차")
```

---

### 2. 수업 캘린더 DB

| 속성명 | 타입 | 설명 |
|---|---|---|
| 제목 | title | 수업 제목 |
| 학생 | relation | → 학생 DB |
| 수업 유형 | relation | → 수업 유형 설정 DB |
| 수업 일시 | date | |
| 수업 시간(분) | select | 60 / 90 / 120 / 150 / 180 |
| 상태 | formula | 🔴미입력 / 🔵예정 / 🟢완료 (수업 일시 및 필수 항목 기반 자동) |
| 특이사항 | select | 🔴 결석 / 🟠 보강 / 🚫 취소 (수동 입력) |
| 메모 | formula | 특이사항 기반 자동 메모 |
| 수업 회차 | formula | 아래 참고 |
| 시간 회차 | formula | 아래 참고 |
| 수업 종료 시간 | formula | 아래 참고 |
| 충돌_감지 | checkbox | GitHub Actions 자동 기입 (직접 수정 금지) |
| 충돌 | formula | 충돌 감지 시 "⚠️ 충돌" 표시 (수정 불가) |
| 무료 수업 | rollup | 수업 유형.1인 단가 **sum** (0 = 무료, 양수 = 유료) |
| 학생 잔여 시간 회차 | rollup | 학생.잔여 시간 회차 **min** (2:1 시 가장 적은 값 기준) |
| 시간 회차 부족 | formula | 잔여 시간 회차 부족 시 "⚠ 시간 회차 부족" 표시 |

> **시간 회차 예시**: 60분 = 1, 90분 = 1.5, 120분 = 2
> **수업 시간(분)은 select** → formula에서 `toNumber()` 처리

**상태 formula:**
```
if(empty(prop("제목")) or empty(prop("수업 유형")) or empty(prop("수업 일시")) or empty(prop("수업 시간(분)")), "🔴미입력", if(prop("수업 일시") > now(), "🔵예정", "🟢완료"))
```
> 제목·수업 유형·수업 일시·수업 시간(분) 중 하나라도 비어 있으면 "🔴미입력" 표시
> (수업 종료 시간은 수업 일시·수업 시간(분)으로 자동 계산되므로 별도 체크 불필요)

**시간 회차 차감 기준:**
| 조건 | 차감 여부 |
|---|---|
| 완료 (일반) | O |
| 완료 + 🔴 결석 | O |
| 완료 + 🟠 보강 | X |
| 완료 + 🚫 취소 | X |

**수업 회차 formula:**
```
if(not empty(prop("수업 일시")) and prop("수업 일시") <= now() and prop("특이사항") != "🟠 보강" and prop("특이사항") != "🚫 취소", 1, 0)
```

**시간 회차 formula:**
```
if(prop("무료 수업") == 0, 0, if(not empty(prop("수업 일시")) and prop("수업 일시") <= now() and prop("특이사항") != "🟠 보강" and prop("특이사항") != "🚫 취소", toNumber(prop("수업 시간(분)")) / 60, 0))
```
> `무료 수업` rollup(단가 합계)이 0 (= 1인 단가가 0원)이면 무료 수업 → 시간 회차 0 반환

**시간 회차 부족 formula:**
```
if(prop("무료 수업") > 0 and not empty(prop("학생 잔여 시간 회차")) and (((empty(prop("수업 일시")) or prop("수업 일시") > now()) and prop("학생 잔여 시간 회차") < toNumber(prop("수업 시간(분)")) / 60) or (not empty(prop("수업 일시")) and prop("수업 일시") <= now() and prop("특이사항") != "🚫 취소" and prop("특이사항") != "🟠 보강" and prop("학생 잔여 시간 회차") < 0)), "⚠ 시간 회차 부족", "")
```
> - **예정 수업**: 학생 잔여 시간 회차 < 이번 수업에 필요한 회차 → 경고
> - **완료 수업**: 학생 잔여 시간 회차 < 0 (취소·보강 제외) → 경고 (초과 사용 후 적자 표시)

**수업 종료 시간 formula:**
```
dateAdd(prop("수업 일시"), toNumber(prop("수업 시간(분)")), "minutes")
```

**충돌 감지 동작 규칙:**
- `충돌_감지` (checkbox): GitHub Actions이 자동 기입 — 직접 수정 금지
- `충돌` (formula): `충돌_감지` 값을 읽어 "⚠️ 충돌" 표시 — 수정 불가
- `🚫 취소` 수업은 충돌 감지 대상에서 제외 (시간 슬롯 반납으로 간주)
- `🔴 결석`, `🟠 보강` 수업은 충돌 감지 대상에 포함 (시간 슬롯 유지)
- 연속 수업(A 종료 = B 시작)은 겹침으로 처리하지 않음

---

### 3. 수업 유형 설정 DB

| 속성명 | 타입 | 설명 |
|---|---|---|
| 타이틀 | title | 단가 유형명 (예: 👤1:1 발음 및 회화) |
| 수업 유형 | select | 1:1 / 2:1 |
| 시간(분) | number | 60 / 90 / 120 등 |
| 1인 단가 | number | 1인 기준 단가 (원) |
| 메모 | rich_text | |
| 결제 | relation | → 수강료 결제 내역 DB (backlink, 자동 생성) |
| 학생 수 | formula | 수업 유형 기반 인원 수 (1:1→1, 2:1→2) |
| 단가 안내 | formula | 기본 단가 표시 |

**학생 수 formula:**
```
if(prop("수업 유형") == "2:1", 2, 1)
```

**단가 안내 formula:**
```
format(prop("1인 단가")) + "원"
```

---

### 4. 할인 이벤트 DB

| 속성명 | 타입 | 설명 |
|---|---|---|
| 이벤트명 | title | |
| 결제 | relation | → 수강료 결제 내역 DB (backlink, 자동 생성) |
| 할인율(%) | number | 할인율 (예: 10) |
| 시작일 | date | |
| 종료일 | date | |
| 강제 ON | checkbox | 기간 무관 강제 활성화 |
| 강제 OFF | checkbox | 기간 내에도 강제 비활성화 |
| 활성 여부 | formula | 자동 판단 (아래 참고) |
| 메모 | rich_text | |

**활성 여부 formula 우선순위:**
1. 강제 ON 체크 → `true`
2. 강제 OFF 체크 → `false`
3. 시작일/종료일 중 하나라도 없으면 → `false`
4. 오늘이 시작일~종료일 범위 안이면 → `true`, 아니면 → `false`

**활성 여부 formula:**
```
if(prop("강제 ON"), true,
  if(prop("강제 OFF"), false,
    if(empty(prop("시작일")) or empty(prop("종료일")), false,
      dateBetween(now(), prop("시작일"), "days") >= 0
      and dateBetween(prop("종료일"), now(), "days") >= 0)))
```

---

### 5. 수강료 결제 내역 DB

| 속성명 | 타입 | 설명 |
|---|---|---|
| 비고 | title | 메모용 제목 |
| 학생 | relation | → 학생 DB |
| 수업 종류 | relation | → 수업 유형 설정 DB |
| 할인 적용 | relation | → 할인 이벤트 DB |
| 시간당 단가 | rollup | 수업 종류.1인 단가 **max** (계산용) |
| 단가 안내 | formula | 할인율 적용된 단가 표시 |
| 적용 할인율(%) | rollup | 할인 적용.할인율(%) **max** |
| **시간 회차** | **number** | **수동 입력** (이번 달 총 시간 회차) |
| **실제 결제 금액** | **number** | **수동 입력** (실제 받은 금액) |
| 유효 시간 회차 | formula | 완료·초과금이면 시간 회차 반환, 미완료·미결제이면 0 (학생 DB 잔여 회차 계산용) |
| 결제 금액 | formula | 자동 계산 |
| 시간 회차 금액 | formula | 시간 회차별 금액 표시 |
| 미수금 | formula | 자동 계산 |
| 결제 상태 | formula | 🟢완료 / 🔴미완료 / ⬛미결제 / ⚠️초과금 (아래 참고) |
| 1인 결제 금액 | formula | 1인 기준 금액 (학생 DB rollup용) |
| 1인 미수금 | formula | 1인 기준 미수금 (학생 DB rollup용) |
| 미입력 항목 | formula | 필수 미입력 항목 경고 표시 |
| 결제수단 | select | 카드 / 계좌이체(현영O) / 계좌이체(현영X) / 현금(현영O) / 현금(현영X) |
| 결제일 | date | |
| 메모 | rich_text | |

> rollup은 단일 레코드를 참조하므로 sum 대신 **max** 사용 (여러 개 연결 시 합산 방지)

**유효 시간 회차 formula** (학생 DB `결제 시간 회차 합계` rollup 기준):
```
if(prop("실제 결제 금액") >= round(prop("시간 회차") * prop("시간당 단가") * (1 - prop("적용 할인율(%)") / 100)), prop("시간 회차"), 0)
```
> 완료·초과금(실제 결제 금액 ≥ 결제 금액)이면 시간 회차 반환, 미완료·미결제이면 0
> → 학생 DB `결제 시간 회차 합계`는 이 값의 합산 → `잔여 시간 회차`에 반영

**단가 안내 formula:**
```
if(prop("적용 할인율(%)") > 0, format(prop("시간당 단가")) + "원  →  " + format(round(prop("시간당 단가") * (1 - prop("적용 할인율(%)") / 100))) + "원  (" + format(prop("적용 할인율(%)")) + "% 할인)", format(prop("시간당 단가")) + "원")
```

**결제 금액 formula** (= 1인 결제 금액, 학생 DB rollup용):
```
round(prop("시간 회차") * prop("시간당 단가") * (1 - prop("적용 할인율(%)") / 100))
```

**미수금 formula** (= 1인 미수금, 학생 DB rollup용):
```
round(prop("시간 회차") * prop("시간당 단가") * (1 - prop("적용 할인율(%)") / 100)) - prop("실제 결제 금액")
```
> formula에서 다른 formula 참조 불가 → 결제 금액 계산식을 그대로 인라인으로 복사

**결제 상태 판단 기준:**
| 조건 | 상태 |
|---|---|
| 실제 결제 금액 > 결제 예정 금액 | ⚠️초과금 → {초과액}원 |
| 미수금 == 0 | 🟢완료 |
| 실제 결제 금액 == 0 (미수금 > 0) | ⬛미결제 |
| 실제 결제 금액 > 0이지만 미수금 > 0 | 🔴미완료 |

---

## 결제 입력 순서

새 결제 레코드 작성 시:
1. **학생** 선택
2. **수업 유형** 선택 (1:1 / 2:1)
3. **수업 종류** 선택 → 시간당 단가 자동 표시
4. **할인 적용** 선택 (해당 시) → 할인율 자동 적용
5. **시간 회차** 입력 (예: 8회 60분 → 8, 8회 90분 → 12)
6. → **결제 금액** 자동 계산됨
7. **실제 결제 금액** 입력 (받은 금액)
8. → **미수금**, **결제 상태** 자동 계산됨

---

## DB 관계도

```
학생 ─────────────── 수업 캘린더
 │                        │
 └── 수강료 결제 내역     └── 수업 유형 설정
          │
          ├── 수업 유형 설정
          └── 할인 이벤트
```

| 관계 | 타입 | 비고 |
|---|---|---|
| 학생 ↔ 수업 캘린더 | dual_property | 학생 DB에서는 "수업 이력" |
| 학생 ↔ 수강료 결제 내역 | dual_property | 학생 DB에서는 "결제" |
| 수강료 결제 내역 ↔ 수업 유형 설정 | dual_property | 수강료 결제 내역 DB에서는 "수업 종류" |
| 수강료 결제 내역 ↔ 할인 이벤트 | dual_property | 수강료 결제 내역 DB에서는 "할인 적용" |
| 수업 캘린더 ↔ 수업 유형 설정 | relation | 수업 캘린더 DB에서는 "수업 유형" |

---

## 노션 API 작업 시 주의사항

1. **dual_property 생성 시 backlink 이름**: "Related to X (Y)" 형태로 자동 생성됨 → `PATCH /databases/{id}` 로 rename 필요

2. **formula에서 다른 formula 참조 불가**: 계산식을 직접 인라인으로 작성해야 함
   → 미수금, 결제 상태 formula에 결제 금액 계산식을 그대로 복사

3. **rollup of rollup 불가**: rollup이 참조하는 속성이 또 rollup이면 에러
   → rollup of formula는 가능 (`show_original` 등)

4. **select 옵션 rename 불가**: API가 성공을 반환하지만 실제로 변경 안 됨
   → 속성을 `null`로 삭제 후 새 이름으로 재생성

5. **`length(prop("relation"))`은 문자 수 반환**: list 크기가 아님 (버그)
   → 학생 수는 `if(prop("수업 유형") == "1:1", 1, 2)` 로 대체

6. **날짜 비교**: `dateCompare` 없음 → `dateBetween(now(), prop("시작일"), "days") >= 0` 사용

7. **DB 아카이브**: `PATCH /pages/{id} { archived: true }` — 통합 앱 접근 권한 필요

8. **rollup max vs sum**: 단일 레코드에 연결된 rollup은 sum 대신 max 사용 (수강료 결제 내역 DB의 시간당 단가, 적용 할인율 등)

---

## 자동화 스크립트

| 파일 | 역할 | 실행 방식 |
|---|---|---|
| `check_conflicts.mjs` | 수업 시간 겹침 감지 → 충돌 체크박스 자동 업데이트 | GitHub Actions (10분마다) |
| `sync_monthly_summary.mjs` | 결제 내역 월별 집계 → 수납 현황 페이지 자동 갱신 | GitHub Actions (매일 00:00 KST) |

### GitHub Actions 워크플로우

| 파일 | 트리거 | 실행 스크립트 |
|---|---|---|
| `.github/workflows/check-conflicts.yml` | 10분마다 + 수동 | `check_conflicts.mjs` |
| `.github/workflows/sync-monthly-summary.yml` | 매일 자정 KST + 수동 | `sync_monthly_summary.mjs` |

> **NOTION_TOKEN** → GitHub repo Settings > Secrets > Actions에 저장 (코드에 하드코딩 금지)
> 수동 실행: GitHub repo → Actions 탭 → 해당 워크플로우 → Run workflow

### check_conflicts.mjs 동작 상세

- 수업 캘린더 DB에서 **수업 일시가 있는** 전체 수업 조회 (페이지네이션 지원)
- `🚫 취소` 수업 및 수업 시간(분) 미입력 수업은 제외
- 모든 수업 쌍에 대해 시간 겹침 감지 (`A.시작 < B.종료 && B.시작 < A.종료`)
- 현재 충돌 상태와 비교 후 **변경이 필요한 항목만** API 호출 (불필요한 호출 최소화)

### sync_monthly_summary.mjs 동작 상세

- 수강료 결제 내역 DB 전체 조회 (페이지네이션 지원)
- **결제 상태 무관**, 결제일 기준 실제 결제 금액을 월별로 합산
- 수납 현황 노션 페이지 기존 블록 삭제 후 재작성 (콜아웃 + 테이블)

---

## 로컬 실행 방법 (Windows)

```bash
# Node.js가 PATH에 없는 경우
export PATH="/c/Program Files/nodejs:$PATH"

# 환경변수 설정 후 실행
NOTION_TOKEN=ntn_... node check_conflicts.mjs
NOTION_TOKEN=ntn_... node sync_monthly_summary.mjs
```

### API 호출 패턴

```javascript
const TOKEN = process.env.NOTION_TOKEN;

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
