const KST = 'Asia/Seoul';

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
  const now = new Date();
  const kstNow = new Date(now.toLocaleString('en-US', { timeZone: KST }));
  const day = kstNow.getDay(); // 0=일, 1=월...
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(kstNow);
  monday.setDate(kstNow.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString();
}

/** 오늘 00:00 KST ISO 문자열 */
export function getTodayStart() {
  const now = new Date();
  const kstNow = new Date(now.toLocaleString('en-US', { timeZone: KST }));
  const today = new Date(kstNow.getFullYear(), kstNow.getMonth(), kstNow.getDate());
  return today.toISOString();
}

/** 이번 달 1일 ISO 문자열 */
export function getMonthStart() {
  const now = new Date();
  const kstNow = new Date(now.toLocaleString('en-US', { timeZone: KST }));
  const first = new Date(kstNow.getFullYear(), kstNow.getMonth(), 1);
  return first.toISOString();
}

/** 숫자 금액 → 한국식 포맷 (₩100,000) */
export function formatKRW(amount) {
  if (!amount && amount !== 0) return '';
  return `₩${amount.toLocaleString('ko-KR')}`;
}
