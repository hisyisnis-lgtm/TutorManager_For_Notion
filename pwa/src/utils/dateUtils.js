const KST = 'Asia/Seoul';

/** 요일 배열 (KST 기준, JS getDay() 인덱스와 일치) */
export const DAY_KR = ['일', '월', '화', '수', '목', '금', '토'];

/** "YYYY-MM-DD" → "1/1(수)" — 예약 UI 컴팩트 날짜 표시 */
export function formatDateMD(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00+09:00');
  return `${d.getMonth() + 1}/${d.getDate()}(${DAY_KR[d.getDay()]})`;
}

/** "YYYY-MM-DD" → "1월 1일 (수)" — 예약 상태 페이지 날짜 표시 */
export function formatDateKO(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00+09:00');
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAY_KR[d.getDay()]})`;
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
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
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

/** date input 값 → Notion용 날짜 (날짜만) */
export function toNotionDateOnly(dateLocal) {
  if (!dateLocal) return null;
  return dateLocal; // "YYYY-MM-DD" 그대로
}

/** 오늘 날짜의 이번 주 월요일 ISO 문자열 (KST) */
export function getWeekStart() {
  const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: KST }); // "YYYY-MM-DD"
  const [year, month, day] = dateStr.split('-').map(Number);
  const tempDate = new Date(year, month - 1, day);
  const dayOfWeek = tempDate.getDay(); // 0=일, 1=월...
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(year, month - 1, day + diff);
  const mondayStr = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
  return `${mondayStr}T00:00:00+09:00`;
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

/** 이번 주 일요일 23:59 ISO 문자열 (월요일 시작 기준) */
export function getWeekEnd() {
  const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: KST });
  const [year, month, day] = dateStr.split('-').map(Number);
  const tempDate = new Date(year, month - 1, day);
  const dayOfWeek = tempDate.getDay(); // 0=일, 1=월...
  const diff = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const sunday = new Date(year, month - 1, day + diff);
  const sundayStr = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`;
  return `${sundayStr}T23:59:59+09:00`;
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
