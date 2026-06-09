// 게임 정체성(identity) + 저장 라우팅 추상화 — 학습앱 분리/독립 실행 대비 (Phase 1).
// 게임 코드가 "학생 토큰"을 직접 다루지 않고 identity를 통해 학생/게스트/프리뷰를 동일하게 처리한다.
//  - 학생앱 진입(/personal/:token/game/tone) → kind:'student', 서버 동기화 O
//  - 독립 진입(/game/tone, 토큰 없음)        → kind:'guest', 로컬 UUID, 서버 X
//  - 미리보기(token==='preview')              → kind:'preview', 저장 안 함
// 로컬 저장 키는 identity.id를 쓰므로 학생/게스트가 같은 헬퍼(tgTokens·tgWordStats)를 공유한다.
// Phase 2(GAME_USERS·휴대폰 OTP 회원·서버 계정·기기간 동기화)는 여기에 'member' provider만 추가하면 됨.
// 참조 메모리: game_account_standalone.md
import { loadBest, saveBest } from './tgTokens.js';
import { loadWordStats, saveWordStats, mergeStats, isMastered } from './tgWordStats.js';
import { fetchAllGameBests, submitGameResult, fetchGameMe, saveGameMe } from '../api/gameApi.js';

const GUEST_ID_KEY = 'tg_guest_id';
const MEMBER_TOKEN_KEY = 'tg_member_token';
const MEMBER_USER_KEY = 'tg_member_user';
// 병합 대상 베스트 키 (난이도 3 + 무한). ToneGamePage의 GAMEKEY/ENDLESS_BEST_KEY와 일치 유지.
const DIFF_KEYS = ['tone-easy', 'tone-normal', 'tone-hard'];
const ENDLESS_KEY = 'tone-endless';

// 게스트 고유 ID — 최초 1회 생성해 localStorage 보관. 기기 단위(기기 바뀌면 새 게스트).
export function getOrCreateGuestId() {
  try {
    let id = localStorage.getItem(GUEST_ID_KEY);
    if (!id) {
      const rnd = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
      id = `g_${rnd}`;
      localStorage.setItem(GUEST_ID_KEY, id);
    }
    return id;
  } catch { return 'g_local'; }
}

// URL 토큰 → identity. 학생(routeToken) > 회원(세션) > 게스트 순.
// member.server=false: 난이도별 GAME_BEST_DB(fetchBests/submitResult)는 안 쓰고, /game/me JSON 통째 동기화(pull/push)로 별도 처리.
export function resolveIdentity(routeToken) {
  if (routeToken === 'preview') return { kind: 'preview', id: 'preview', server: false, token: null };
  if (routeToken) return { kind: 'student', id: routeToken, server: true, token: routeToken };
  const m = getMemberSession();
  if (m && m.token) return { kind: 'member', id: m.user?.id || 'member', server: false, token: m.token, memberUser: m.user || null };
  return { kind: 'guest', id: getOrCreateGuestId(), server: false, token: null };
}

// 서버 베스트 조회 — 학생만. 게스트/프리뷰는 null(로컬 캐시만 사용).
export function fetchBests(identity) {
  if (!identity || !identity.server) return Promise.resolve(null);
  return fetchAllGameBests(identity.token);
}

// 게임 결과 서버 저장 — 학생만. 게스트/프리뷰는 no-op(로컬만).
export function submitResult(identity, gameKey, result) {
  if (!identity || !identity.server) return Promise.resolve({ isNewBest: false, best: null });
  return submitGameResult(identity.token, gameKey, result);
}

// 게스트 → 학생 1회 병합(같은 기기). 게스트로 쌓은 로컬 베스트·숙련도를 학생 쪽에 합치고 서버에 반영.
// 학생앱에서 게임 진입할 때 호출. flag로 중복 병합 방지. 다른 기기 간 동기화는 Phase 2(서버 계정) 영역.
export async function mergeGuestIntoStudent(identity) {
  if (!identity || identity.kind !== 'student') return false;
  let guestId = null;
  try { guestId = localStorage.getItem(GUEST_ID_KEY); } catch { /* noop */ }
  if (!guestId || guestId === identity.id) return false;
  const flagKey = `tg_guest_merged_${identity.id}`;
  try { if (localStorage.getItem(flagKey)) return false; } catch { /* noop */ }

  // 난이도 베스트: 게스트 점수가 더 높으면 학생 로컬 갱신 + 서버에 실제 점수 submit
  for (const key of DIFF_KEYS) {
    const g = loadBest(guestId, key);
    if (!g || !(g.bestScore > 0)) continue;
    const s = loadBest(identity.id, key) || {};
    if ((g.bestScore || 0) > (s.bestScore || 0)) {
      const merged = {
        bestScore: g.bestScore,
        bestMaxCombo: Math.max(s.bestMaxCombo || 0, g.bestMaxCombo || 0),
        bestAvgMs: g.bestAvgMs || s.bestAvgMs || 0,
        playCount: (s.playCount || 0) + (g.playCount || 0),
        updatedAt: Date.now(),
      };
      saveBest(identity.id, key, merged);
      await submitResult(identity, key, {
        score: merged.bestScore, maxCombo: merged.bestMaxCombo, avgMs: merged.bestAvgMs || 0,
      }).catch(() => {});
    }
  }

  // 무한 베스트: 게스트가 더 높으면 학생 로컬 갱신 + 서버 meta.eb(고급행에 0점 submit)로 영구화
  const ge = loadBest(guestId, ENDLESS_KEY);
  if (ge && ge.bestScore > 0) {
    const se = loadBest(identity.id, ENDLESS_KEY) || {};
    if ((ge.bestScore || 0) > (se.bestScore || 0)) {
      saveBest(identity.id, ENDLESS_KEY, {
        bestScore: ge.bestScore,
        bestMaxCombo: Math.max(se.bestMaxCombo || 0, ge.bestMaxCombo || 0),
        bestAvgMs: ge.bestAvgMs || se.bestAvgMs || 0,
        playCount: (se.playCount || 0) + (ge.playCount || 0),
        updatedAt: Date.now(),
      });
      await submitResult(identity, 'tone-hard', { score: 0, maxCombo: 0, avgMs: 0, meta: { eb: ge.bestScore } }).catch(() => {});
    }
  }

  // 단어 숙련도: 학생 쪽에 게스트 통계 병합(attempts 많은 쪽 우선). 서버 meta.w는 다음 플레이 종료 시 동기화됨.
  try {
    const merged = mergeStats(loadWordStats(identity.id), loadWordStats(guestId));
    saveWordStats(identity.id, merged);
  } catch { /* noop */ }

  try { localStorage.setItem(flagKey, '1'); } catch { /* noop */ }
  return true;
}

// ===== 회원(member) — 휴대폰 OTP 가입/로그인 + 기기간 서버 동기화 (Phase 2) =====
// 회원은 GAME_USERS의 게임데이터(JSON 통째) 모델. 로컬은 게스트와 동일 헬퍼(identity.id 키)를 쓰고,
// 서버는 /game/me로 전체 JSON을 pull/push. (학생의 난이도별 GAME_BEST_DB와 다른 경로)

export function getMemberSession() {
  try {
    const token = localStorage.getItem(MEMBER_TOKEN_KEY);
    if (!token) return null;
    let user = null;
    try { user = JSON.parse(localStorage.getItem(MEMBER_USER_KEY) || 'null'); } catch { /* noop */ }
    return { token, user };
  } catch { return null; }
}
export function loginMember(token, user) {
  try { localStorage.setItem(MEMBER_TOKEN_KEY, token); localStorage.setItem(MEMBER_USER_KEY, JSON.stringify(user || {})); } catch { /* noop */ }
}
export function logoutMember() {
  try { localStorage.removeItem(MEMBER_TOKEN_KEY); localStorage.removeItem(MEMBER_USER_KEY); } catch { /* noop */ }
}
export function isMember() { const m = getMemberSession(); return !!(m && m.token); }

// 로컬 게임데이터 수집(회원 서버 동기화용 JSON 블롭): 베스트 4키 + 단어 숙련도.
const ALL_BEST_KEYS = [...DIFF_KEYS, ENDLESS_KEY];
// 서버 /game/me는 Notion rich_text(2000자)라 1900자 한도. 베스트 등 다른 키 여유를 빼고 단어 통계 예산.
const WORDS_BUDGET = 1500;

// 단어 통계가 무한 성장하면 직렬화가 1900자를 넘어 서버 저장이 거부된다(동기화 누락).
// → 예산 초과 시 학습상 중요한 순서로 추려 한도 내로 트림: ①미마스터(복습 대상) 우선 보존 ②시도 많은 순.
//   (마스터된 단어 일부가 빠지면 '마스터 수'가 살짝 줄 수 있으나, 약점 단어 보존이 학습엔 더 중요)
function trimWords(words) {
  const entries = Object.entries(words || {});
  if (entries.length === 0 || JSON.stringify(words).length <= WORDS_BUDGET) return words || {};
  entries.sort((a, b) => {
    const am = isMastered(a[1]) ? 1 : 0, bm = isMastered(b[1]) ? 1 : 0;
    if (am !== bm) return am - bm;                      // 미마스터(0) 먼저
    return (b[1]?.[0] || 0) - (a[1]?.[0] || 0);         // 시도(attempts) 많은 순
  });
  const out = {};
  for (const [hz, e] of entries) {
    out[hz] = e;
    if (JSON.stringify(out).length > WORDS_BUDGET) { delete out[hz]; break; }
  }
  return out;
}

export function collectLocalGameData(id) {
  const best = {};
  for (const k of ALL_BEST_KEYS) { const b = loadBest(id, k); if (b) best[k] = b; }
  return { best, words: trimWords(loadWordStats(id)) };
}
// 서버/게스트 게임데이터를 로컬에 머지(베스트=점수 큰 쪽, 숙련도=mergeStats).
function applyGameDataToLocal(id, data) {
  if (!data || typeof data !== 'object') return;
  for (const [k, sb] of Object.entries(data.best || {})) {
    if (!sb) continue;
    const lb = loadBest(id, k) || {};
    if ((sb.bestScore || 0) >= (lb.bestScore || 0)) saveBest(id, k, { ...lb, ...sb });
  }
  if (data.words) saveWordStats(id, mergeStats(loadWordStats(id), data.words));
}

// 서버(/game/me) → 로컬 머지. 회원 진입/로그인 시.
export async function pullMemberData(identity) {
  if (!identity || identity.kind !== 'member') return;
  const { user } = await fetchGameMe(identity.token);
  applyGameDataToLocal(identity.id, user?.gameData);
}
// 로컬 → 서버(/game/me) 업로드. 게임 종료 시. nickname 주면 함께 저장(로그인 시 이름 입력).
export async function pushMemberData(identity, nickname) {
  if (!identity || identity.kind !== 'member') return;
  await saveGameMe(identity.token, collectLocalGameData(identity.id), nickname || undefined);
}
// 게스트 로컬 기록을 회원 로컬에 1회 병합(로그인 직후). 이후 pull/push로 서버 동기화.
export function mergeGuestIntoMember(identity) {
  if (!identity || identity.kind !== 'member') return;
  let guestId = null;
  try { guestId = localStorage.getItem(GUEST_ID_KEY); } catch { /* noop */ }
  if (!guestId || guestId === identity.id) return;
  applyGameDataToLocal(identity.id, collectLocalGameData(guestId));
}

// 학생 GAME_BEST_DB 기록(난이도별 행 + meta.w/eb) → 회원 게임데이터 형식({best, words})으로 변환.
// 무한 최고는 별도 행이 아니라 고급 행 meta.eb에 얹혀 있으므로 거기서 추출.
function studentBestsToGameData(bests) {
  const best = {}; let eb = 0; let words = {};
  for (const b of bests || []) {
    if (!b) continue;
    if (DIFF_KEYS.includes(b.gameKey) && (b.bestScore || 0) > 0) {
      best[b.gameKey] = { bestScore: b.bestScore || 0, bestMaxCombo: b.bestMaxCombo || 0, bestAvgSec: b.bestAvgSec || 0, updatedAt: Date.now() };
    }
    if (b.meta?.eb) eb = Math.max(eb, Number(b.meta.eb) || 0);
    if (b.meta?.w) words = mergeStats(words, b.meta.w);
  }
  if (eb > 0) best[ENDLESS_KEY] = { bestScore: eb, updatedAt: Date.now() };
  return { best, words };
}

// 회원에 연결된 학생(예약코드)의 GAME_BEST 기록을 회원 로컬에 max 머지. 회원 진입 시 호출.
// 학생→회원 과도기 이관: 점수 높은 쪽 보존(applyGameDataToLocal이 >= 머지). 흡수분은 호출부에서 pushMemberData로 서버 gameData에 영구화.
// memberUser.studentToken은 verify 시 전화번호 매칭으로 연결됨(없으면 매칭 실패 — no-op).
export async function mergeStudentIntoMember(identity) {
  if (!identity || identity.kind !== 'member') return false;
  const stoken = identity.memberUser?.studentToken;
  if (!stoken) return false;
  try {
    const bests = await fetchAllGameBests(stoken);
    if (!bests || !bests.length) return false;
    applyGameDataToLocal(identity.id, studentBestsToGameData(bests));
    return true;
  } catch { return false; }
}
