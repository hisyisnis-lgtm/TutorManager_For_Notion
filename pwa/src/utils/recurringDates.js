// 반복 수업 날짜 생성 — "매주 월·수 14:30, 3월 한 달" 같은 입력을 실제 수업 일시 목록으로 바꾼다.
//
// ⚠️ 기기 타임존에 기대지 않는다.
// 예전 구현은 `cur.getDay()`·`d.setHours()`로 **실행 기기의 로컬 시간대** 기준으로 요일과 시각을
// 정했다. 강사가 한국에서만 쓰면 결과가 같지만, 기기 시간대가 다르면 요일이 하루 밀리고
// 수업 시각도 어긋난다. 반복 등록은 한 번에 수십 건을 만드는 기능이라 어긋나면 피해가 크다.
// (CI도 UTC로 돌기 때문에 옛 구현은 테스트로 잠글 수도 없었다.)
//
// 그래서 날짜는 'YYYY-MM-DD' 문자열로 옮겨 다니고, 요일은 UTC 정오를 기준점으로 계산하며,
// 최종 시각만 `+09:00`을 명시해 KST로 고정한다.

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' → 요일 (0=일 … 6=토). UTC 정오 기준이라 어느 시간대에서 실행해도 같은 답. */
function dayOfWeek(ymd) {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay();
}

/** 'YYYY-MM-DD' 에 n일 더한 날짜 문자열. 월말·윤년은 Date가 알아서 넘겨준다. */
function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 하루도 빠짐없이 도는 걸 막는 상한 — 잘못된 입력이 무한 루프가 되지 않게. 2년치면 충분. */
const MAX_DAYS = 800;

/**
 * @param {string} startDate  'YYYY-MM-DD'
 * @param {string} endDate    'YYYY-MM-DD' (포함)
 * @param {number[]} selectedDays  요일 배열 (0=일 … 6=토)
 * @param {string} time       'HH:MM' (KST)
 * @returns {Date[]} 수업 일시 목록 (KST 기준 시각)
 */
export function generateRecurringDates(startDate, endDate, selectedDays, time) {
  if (!selectedDays?.length || !startDate || !endDate || !time) return [];

  const [h, m] = String(time).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return [];

  const dates = [];
  let cursor = startDate;
  for (let guard = 0; cursor <= endDate && guard < MAX_DAYS; guard += 1) {
    if (selectedDays.includes(dayOfWeek(cursor))) {
      dates.push(new Date(`${cursor}T${pad(h)}:${pad(m)}:00+09:00`));
    }
    cursor = addDays(cursor, 1);
  }
  return dates;
}
