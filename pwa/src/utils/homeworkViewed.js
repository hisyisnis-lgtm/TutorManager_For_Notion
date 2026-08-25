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

/**
 * 이 피드백 숙제를 학생이 "이미 확인했는가" — 홈에서 내려 보관함으로 보낼지 판단한다.
 *
 * ⚠️ 로컬(localStorage)과 서버('피드백 확인일') **둘 다** 본다.
 * 로컬만 보면 기기를 바꾸거나 브라우저 데이터를 지운 학생에게 예전에 다 확인한 피드백이
 * 홈에 통째로 다시 쏟아진다. iOS는 같은 기기에서도 Safari와 설치 PWA의 저장소가 갈리므로
 * ("홈 화면에 추가"로 열면 다른 저장소) 기기 교체가 아니어도 재현된다.
 * 2026-08-25 실측: TEST 계정 피드백완료 10건이 서버엔 전부 확인됨인데 홈엔 10장이 떠 있었다.
 *
 * 단, 학생이 본 뒤에 강사가 새 피드백을 줬으면(feedbackDate > 확인시각) 다시 보여준다.
 */
export function isFeedbackArchived(token, hwId, feedbackDate, serverSeenDate) {
  const localViewedAt = getViewedMap(token)[hwId] || 0;
  const parsedServer = serverSeenDate ? new Date(serverSeenDate).getTime() : 0;
  const serverSeenAt = Number.isFinite(parsedServer) ? parsedServer : 0;
  const seenAt = Math.max(localViewedAt, serverSeenAt);
  if (!seenAt) return false;
  if (feedbackDate) {
    const fbTime = new Date(feedbackDate).getTime();
    if (Number.isFinite(fbTime) && fbTime > seenAt) return false;
  }
  return true;
}
