// 학생앱 "피드백 확인" 기록 — localStorage 단일 출처.
// PersonalPage(보관함 판정)와 PersonalHomeworkDetailPage(확인 기록)가 공유한다.
// 이전엔 두 파일에 같은 함수가 각각 정의돼 있었음(중복 정의 금지).

export const HW_VIEWED_KEY = (token) => `hw_viewed_${token}`;

export function getViewedMap(token) {
  try { return JSON.parse(localStorage.getItem(HW_VIEWED_KEY(token)) || '{}'); }
  catch { return {}; }
}

export function markViewed(token, hwId) {
  const map = getViewedMap(token);
  if (!map[hwId]) {
    map[hwId] = Date.now();
    try { localStorage.setItem(HW_VIEWED_KEY(token), JSON.stringify(map)); } catch { /* 쿼터 초과 등 — 표시용 기록이라 무해 */ }
  }
}
