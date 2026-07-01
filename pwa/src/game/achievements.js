// 업적/배지 — "눈에 보이는 훈장". 게임 데이터 스냅샷을 받아 달성 여부를 순수 판정.
// 톤 원칙: 격려·성취(서비스 정체성). 압박/경쟁 카피 금지.
// 스냅샷은 호출부(ToneGamePage)가 기존 저장소에서 모아 만든다 — 이 모듈은 저장소를 직접 안 읽음(순수).
// 참조 메모리: tone_game_redesign.md (성취 레이어 P1)
import { UNLOCK_THRESHOLD } from './gameLogic.js';
import { allTonesAbove } from './toneStats.js';

// 스냅샷 형태:
//  { playCount, bestScoreAny, maxComboEver, bestByDiff:{easy,normal,hard}, endlessBest,
//    masteredCount, streakLongest, toneStats }
// 각 업적: id·label(한글)·desc(한글)·icon(Phosphor 이름, UI가 해석)·check(snapshot)→bool.
// cond = 미획득 시 안내 토스트용 '얻는 조건'(desc는 획득 후 완료형). 잠금 배지 탭 시 표시(P4 후속).
export const ACHIEVEMENTS = [
  { id: 'first-play', label: '첫걸음', desc: '처음으로 게임을 완주했어요', cond: '게임을 한 판 완주하면 얻어요', icon: 'Footprints',
    check: (s) => (s.playCount || 0) >= 1 },
  { id: 'score-1000', label: '천 점 클럽', desc: '한 게임에서 1,000점을 넘었어요', cond: '한 게임에서 1,000점을 넘으면 얻어요', icon: 'Trophy',
    check: (s) => (s.bestScoreAny || 0) >= 1000 },
  { id: 'combo-10', label: '콤보 마스터', desc: '콤보 10을 달성했어요', cond: '콤보 10을 달성하면 얻어요', icon: 'Flame',
    check: (s) => (s.maxComboEver || 0) >= 10 },
  { id: 'combo-20', label: '불꽃 손가락', desc: '콤보 20을 달성했어요', cond: '콤보 20을 달성하면 얻어요', icon: 'FireSimple',
    check: (s) => (s.maxComboEver || 0) >= 20 },
  { id: 'unlock-normal', label: '중급 입성', desc: '중급 모드를 열었어요', cond: '초급에서 1,000점을 넘으면 얻어요', icon: 'Rocket',
    check: (s) => (s.bestByDiff?.easy || 0) >= UNLOCK_THRESHOLD },
  { id: 'unlock-hard', label: '고급 입성', desc: '고급 모드를 열었어요', cond: '중급에서 1,000점을 넘으면 얻어요', icon: 'Crown',
    check: (s) => (s.bestByDiff?.normal || 0) >= UNLOCK_THRESHOLD },
  { id: 'unlock-endless', label: '무한의 문', desc: '무한 모드를 열었어요', cond: '고급에서 1,000점을 넘으면 얻어요', icon: 'Infinity',
    check: (s) => (s.bestByDiff?.hard || 0) >= UNLOCK_THRESHOLD },
  { id: 'master-10', label: '단어 수집가', desc: '10단어를 마스터했어요', cond: '단어 10개를 마스터하면 얻어요', icon: 'BookmarkSimple',
    check: (s) => (s.masteredCount || 0) >= 10 },
  { id: 'master-30', label: '단어 달인', desc: '30단어를 마스터했어요', cond: '단어 30개를 마스터하면 얻어요', icon: 'Books',
    check: (s) => (s.masteredCount || 0) >= 30 },
  { id: 'streak-3', label: '사흘 개근', desc: '3일 연속 플레이했어요', cond: '3일 연속 플레이하면 얻어요', icon: 'CalendarCheck',
    check: (s) => (s.streakLongest || 0) >= 3 },
  { id: 'streak-7', label: '일주일 개근', desc: '7일 연속 플레이했어요', cond: '7일 연속 플레이하면 얻어요', icon: 'CalendarHeart',
    check: (s) => (s.streakLongest || 0) >= 7 },
  { id: 'streak-14', label: '2주 개근', desc: '14일 연속 플레이했어요', cond: '14일 연속 플레이하면 얻어요', icon: 'CalendarDots',
    check: (s) => (s.streakLongest || 0) >= 14 },
  { id: 'streak-30', label: '한 달 개근', desc: '30일 연속 플레이했어요', cond: '30일 연속 플레이하면 얻어요', icon: 'Fire',
    check: (s) => (s.streakLongest || 0) >= 30 },
  { id: 'tone-master', label: '성조 감별사', desc: '모든 성조 정답률 90% 이상', cond: '모든 성조 정답률 90%를 넘으면 얻어요', icon: 'Waveform',
    check: (s) => allTonesAbove(s.toneStats || {}, 0.9, 5) },
];

const BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
export function achievementById(id) { return BY_ID[id] || null; }

// 스냅샷 기준 현재 달성한 모든 업적 id.
export function evaluateAchievements(snapshot) {
  return ACHIEVEMENTS.filter((a) => a.check(snapshot || {})).map((a) => a.id);
}

// 이번에 새로 달성한 업적(이전엔 없었고 지금 달성). 축하 연출(P4)용.
export function newlyUnlocked(prevIds, snapshot) {
  const prev = new Set(prevIds || []);
  return evaluateAchievements(snapshot).filter((id) => !prev.has(id));
}

// ── localStorage ──────────────────────────────────────
function achKey(token) { return token ? `game_ach_${token}` : 'game_ach'; }
export function loadAchievements(token) {
  try { const raw = localStorage.getItem(achKey(token)); const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : []; }
  catch { return []; }
}
export function saveAchievements(token, ids) {
  try { localStorage.setItem(achKey(token), JSON.stringify(ids || [])); } catch { /* 무시 */ }
}

// 달성 평가 → 저장. 새로 달성한 목록 반환(없으면 빈 배열). 저장은 누적 합집합.
export function syncAchievements(token, snapshot) {
  const prev = loadAchievements(token);
  const current = evaluateAchievements(snapshot);
  const fresh = current.filter((id) => !prev.includes(id));
  if (fresh.length) saveAchievements(token, [...new Set([...prev, ...current])]);
  return fresh;
}
