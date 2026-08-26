/** IANA 타임존 문자열 — toLocale* 옵션에 쓰는 단일 출처 (파일마다 재정의 금지) */
export const KST = 'Asia/Seoul';

/** 요일 배열 (KST 기준, JS getDay() 인덱스와 일치) */
export const DAY_KR = ['일', '월', '화', '수', '목', '금', '토'];

/** 오늘 날짜 "YYYY-MM-DD" (KST) — 기기 타임존과 무관 */
export function todayKST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: KST });
}

/** ISO 문자열 → "2025.1.1" — 숙제 등록일/제출일 컴팩트 표시 */
export function formatDateDot(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

/** ISO 문자열 → "2025. 1. 1. 14:00" — 숙제 상세 날짜+시간 (numeric 월) */
export function formatDateTimeCompact(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** "YYYY-MM" → "2025년 1월" — 달력 헤더 표시 */
export function formatYearMonth(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return `${y}년 ${m}월`;
}

/** "YYYY-MM" ± delta → "YYYY-MM" — 달력 월 이동 */
export function addMonths(monthStr, delta) {
  const date = new Date(monthStr + '-01T00:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + delta);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** "HH:MM" → 분 (정수) */
export function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** 분 → "X시간" 또는 "X시간 Y분" */
export function formatDuration(min) {
  // 잔여·결제가 모두 시간 단위(60분=1)라 소요시간도 같은 단위로 읽혀야 한다.
  // "1시간 30분"처럼 시·분으로 쪼개면 잔여 "1.5시간"과 머릿속에서 바로 이어지지 않는다.
  // (시각 범위 19:00~20:30 같은 표기는 이 함수 대상이 아니며 시:분 그대로 둔다)
  const h = Math.round((min / 60) * 100) / 100;
  return `${Number.isInteger(h) ? h : parseFloat(h.toFixed(2))}시간`;
}

/** Date 객체 → "YYYY-MM-DDTHH:MM:00+09:00" (Notion KST 저장용) */
export function toISOLocalKST(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00+09:00`;
}

/** ISO 문자열 → 한국어 날짜+시간 표시 */
export function formatDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ko-KR', {
    timeZone: KST,
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** ISO 문자열 → 한국어 날짜만 표시 */
export function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('ko-KR', {
    timeZone: KST,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}

/** ISO 문자열 → "HH:MM" 시간만 표시 */
export function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('ko-KR', {
    timeZone: KST,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** ISO 문자열 → "M/D HH:MM" 짧은 형식 */
export function formatShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`;
}

/** ISO 문자열 → datetime-local input 값 (KST 기준) */
export function toDatetimeLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '00';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour') === '24' ? '00' : get('hour');
  const minute = get('minute');
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

/** datetime-local input 값 → Notion용 ISO (KST 명시) */
export function toNotionDate(datetimeLocal) {
  if (!datetimeLocal) return null;
  // "YYYY-MM-DDTHH:MM" → "YYYY-MM-DDTHH:MM:00+09:00"
  return `${datetimeLocal}:00+09:00`;
}

/** 오늘 00:00 KST ISO 문자열 */
export function getTodayStart() {
  const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: KST }); // "YYYY-MM-DD"
  return `${dateStr}T00:00:00+09:00`;
}

/** 이번 달 1일 ISO 문자열 */
export function getMonthStart() {
  const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: KST }); // "YYYY-MM-DD"
  const [year, month] = dateStr.split('-');
  return `${year}-${month}-01T00:00:00+09:00`;
}

/** 이번 달 말일 23:59 ISO 문자열 */
export function getMonthEnd() {
  const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: KST });
  const [year, month] = dateStr.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59+09:00`;
}

/** 숫자 금액 → 한국식 포맷 (₩100,000) */
export function formatKRW(amount) {
  if (!amount && amount !== 0) return '';
  return `₩${amount.toLocaleString('ko-KR')}`;
}
