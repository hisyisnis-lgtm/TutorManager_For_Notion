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
import { loadToneStats, saveToneStats } from './toneStats.js';
import { loadTierPeak, bumpTierPeak } from './earProfile.js';
import { loadXp, saveXp, mergeXp, loadRank, saveRank, mergeRank } from './gameXp.js';
import { loadAchievements, saveAchievements, loadReviewMastered, addReviewMastered } from './achievements.js';
import { loadStreak, saveStreak, loadFreezes, saveFreezes, diffDays } from './streak.js';
import { loadStageScores, saveStageScore, loadBossPeak, saveBossPeak } from './gameLogic.js';
import { DIFFICULTIES, THEMES } from '../constants/toneGameWords.js';
import { fetchGameMe, saveGameMe } from '../api/gameApi.js';

const GUEST_ID_KEY = 'tg_guest_id';
const MEMBER_TOKEN_KEY = 'tg_member_token';
const MEMBER_USER_KEY = 'tg_member_user';
// 병합 대상 베스트 키 — DIFFICULTIES에서 파생(새 난이도 자동 포함). 무한 키는 gameLogic ENDLESS_BEST_KEY와 일치 유지.
const DIFF_KEYS = DIFFICULTIES.map((d) => d.gameKey);
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

// URL 토큰 → identity. 회원(세션) > 게스트 순. (게임은 Notion·학생과 완전 분리 — 학생 토큰 경로 폐기, 2026-07-12)
// 회원은 /game/me JSON 통째 동기화(pull/push), 게스트·프리뷰는 로컬 전용. 서버 베스트(GAME_BEST_DB) 경로 없음.
export function resolveIdentity(routeToken) {
  if (routeToken === 'preview') return { kind: 'preview', id: 'preview', token: null };
  const m = getMemberSession();
  if (m && m.token) return { kind: 'member', id: m.user?.id || 'member', token: m.token, memberUser: m.user || null };
  return { kind: 'guest', id: getOrCreateGuestId(), token: null };
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

// 로컬 게임데이터 수집(회원 서버 동기화용 JSON 블롭): 난이도3 + 무한 + 테마별 베스트 + 단어 숙련도 등.
// ★테마 베스트(tone-drama·tone-travel…)도 회원 동기화 대상 — THEMES에서 gameKey를 끌어와 누락 방지.
const ALL_BEST_KEYS = [...DIFF_KEYS, ENDLESS_KEY, ...THEMES.map((t) => t.gameKey)];
// 서버 /game/me는 D1 game_data TEXT(사실상 무제한, 남용방지 100KB 상한)로 이전(2026-07-06) → 트림 사실상 미발동.
// (구: 노션 rich_text 2000자라 1900자 트림 압박이었음. D1 이전으로 대폭 완화.) 로직·필드는 그대로 유지.
const WORDS_BUDGET = 88000;
const TOTAL_BUDGET = 90000; // 서버 100KB 아래 여유. words는 나머지 필드가 쓰고 남은 만큼(사실상 전부).

// ── 마스터 수 동기화 값(mc) — '트림 전 전체 통계' 기준 마스터 수의 마지막 기록(last-writer) ──
// 목적: 단어 풀 성장(195+)으로 트림이 상시 발동 → 마스터 단어 '통계'가 동기화에서 빠져도 '수'는 안 유실되게.
// ★고수위(max)가 아니라 last-writer(2026-07-04 등급 강등 도입): 진짜 실력 하락(마스터 해제, 히스테리시스)은
//   그대로 전파돼야 하므로 덮어쓴다. 동기화 아티팩트(트림)만 방어 — mc는 항상 트림 '전' 전체 기준이라
//   트림 유실이 수에 안 섞임. 등급의 '안 뺏는' 부분은 최고 등급 기록(earProfile tierPeak)이 담당.
function masteredSyncKey(id) { return id ? `game_mastered_sync_${id}` : 'game_mastered_sync'; }
export function loadMasteredSync(id) {
  try { const n = parseInt(localStorage.getItem(masteredSyncKey(id)) || '0', 10); return Number.isFinite(n) && n > 0 ? n : 0; }
  catch { return 0; }
}
export function storeMasteredSync(id, n) {
  const v = Math.max(0, n | 0);
  try { localStorage.setItem(masteredSyncKey(id), String(v)); } catch { /* noop */ }
  return v;
}

// 단어 통계가 무한 성장하면 직렬화가 서버 예산(100KB 아래 TOTAL_BUDGET)을 넘어 저장이 거부된다(동기화 누락).
// → 예산 초과 시 학습상 중요한 순서로 추려 한도 내로 트림: ①미마스터(복습 대상) 우선 보존 ②시도 많은 순.
//   (마스터된 단어 통계가 빠져도 마스터 '수'는 위 mc가 보존)
function trimWords(words, budget = WORDS_BUDGET) {
  const entries = Object.entries(words || {});
  if (entries.length === 0 || JSON.stringify(words).length <= budget) return words || {};
  entries.sort((a, b) => {
    const am = isMastered(a[1]) ? 1 : 0, bm = isMastered(b[1]) ? 1 : 0;
    if (am !== bm) return am - bm;                      // 미마스터(0) 먼저
    return (b[1]?.[0] || 0) - (a[1]?.[0] || 0);         // 시도(attempts) 많은 순
  });
  const out = {};
  for (const [hz, e] of entries) {
    out[hz] = e;
    if (JSON.stringify(out).length > budget) { delete out[hz]; break; }
  }
  return out;
}

// 성조별 정확도 압축: [정답,시도,ema] 유지하되 ema는 소수 3자리로 반올림해 페이로드 절약. 시도 0인 성조는 생략.
function compactToneStats(stats) {
  const out = {};
  for (const [t, e] of Object.entries(stats || {})) {
    if (!Array.isArray(e) || !(e[1] > 0)) continue;
    out[t] = typeof e[2] === 'number' ? [e[0], e[1], Math.round(e[2] * 1000) / 1000] : [e[0], e[1]];
  }
  return out;
}
// 성조별 정확도 머지 — 단어 숙련도와 동일 철학(시도 많은 쪽 채택). 게스트→회원/기기간 공통.
function mergeToneStats(base, incoming) {
  const out = { ...(base || {}) };
  for (const [t, inc] of Object.entries(incoming || {})) {
    if (!Array.isArray(inc)) continue;
    const cur = out[t];
    if (!Array.isArray(cur) || (inc[1] || 0) > (cur[1] || 0)) out[t] = inc;
  }
  return out;
}
// 스트릭 머지 — longest는 최댓값, current/lastDate는 더 최근 플레이(날짜 큰 쪽) 기준.
// 같은 날짜(동률)면 current 큰 쪽 — 게스트로 오늘 1판 후 로그인해도 서버의 긴 스트릭이 1로 안 덮이게.
// 연속일(diff===1)이면 이어달리기 — 예: 서버{어제,30} + 게스트{오늘,1}은 오늘 하루 이어 뛴 것이므로 31이 돼야 함(2026-07-21 수정).
function mergeStreak(base, inc) {
  if (!inc) return base || null;
  if (!base) return inc;
  const longest = Math.max(base.longest || 0, inc.longest || 0);
  const bd = base.lastDate || '', id = inc.lastDate || '';
  if (bd === id) return { lastDate: bd, current: Math.max(base.current || 0, inc.current || 0), longest };
  const newer = id > bd ? inc : base, older = id > bd ? base : inc;
  // 하루 차이면 older 스트릭에서 하루 이어달린 것으로 봄(older.current+1 vs newer 자체 current 중 큰 쪽).
  const gap = (older.lastDate && newer.lastDate) ? diffDays(older.lastDate, newer.lastDate) : 99;
  const current = gap === 1
    ? Math.max(newer.current || 0, (older.current || 0) + 1)
    : (newer.current || 0); // 이틀 이상 공백 = 끊김, 최근 기록의 current 그대로
  return { lastDate: newer.lastDate, current, longest: Math.max(longest, current) };
}

export function collectLocalGameData(id) {
  const best = {};
  for (const k of ALL_BEST_KEYS) { const b = loadBest(id, k); if (b) best[k] = b; }
  const words = loadWordStats(id);
  // mc = 트림 전 전체 통계 기준 마스터 수(last-writer 갱신 겸) — 트림으로 마스터 항목이 빠져도 수는 보존
  const mc = storeMasteredSync(id, Object.values(words).filter((e) => isMastered(e)).length);
  // 베스트 외 진행도 전부 포함(성조별 정확도·최고 등급·업적·복습마스터수·스트릭·프리즈).
  const rest = {
    best,
    mc,
    tone: compactToneStats(loadToneStats(id)), // 성조별 정확도(1·2·3·4·경성)
    tier: loadTierPeak(id),                    // 최고 등급(귀 티어) — 안 뺏김
    xp: loadXp(id) ?? 0,                        // 누적 경험치(등급 산정) — 병합은 max(멱등)
    rk: loadRank(id) ?? 0,                      // 등급 idx(승급 시험 합격으로만 오름) — 병합은 max(우상향)
    ach: loadAchievements(id),                 // 획득 업적 id
    rm: loadReviewMastered(id),                // 복습으로 마스터한 단어 수(업적)
    frz: loadFreezes(id),                      // 스트릭 보호권
    stg: loadStageScores(id),                  // 스테이지별 최고점 — 급 내 스테이지 해제·별·earnedRankFromTiers 근거(2026-07-21 동기화 추가)
    bp: loadBossPeak(id),                       // 승급시험으로 통과한 최고 급(배치고사 포함) — rank 클램프 상한 근거(2026-07-22)
  };
  const streak = loadStreak(id);
  if (streak) rest.streak = streak;            // {lastDate,current,longest}
  // words는 서버 예산(TOTAL_BUDGET)에서 나머지 필드가 쓰고 남은 만큼만(초과 시 학습중요도순 트림). WORDS_BUDGET도 상한.
  const overhead = JSON.stringify({ ...rest, words: {} }).length;
  const wordsBudget = Math.min(WORDS_BUDGET, Math.max(0, TOTAL_BUDGET - overhead));
  return { ...rest, words: trimWords(words, wordsBudget) };
}
// 서버/게스트 게임데이터를 로컬에 머지(베스트=점수 큰 쪽, 숙련도=mergeStats, 마스터 수=last-writer 덮어씀).
function applyGameDataToLocal(id, data) {
  if (!data || typeof data !== 'object') return;
  for (const [k, sb] of Object.entries(data.best || {})) {
    if (!sb) continue;
    const lb = loadBest(id, k) || {};
    // playCount는 항상 큰 쪽 보존 — 점수 동률일 때 들어온 레코드가 로컬 playCount를 깎지 않게(업적 판정 지연 방지).
    if ((sb.bestScore || 0) >= (lb.bestScore || 0)) saveBest(id, k, { ...lb, ...sb, playCount: Math.max(lb.playCount || 0, sb.playCount || 0) });
  }
  if (data.words) saveWordStats(id, mergeStats(loadWordStats(id), data.words));
  if (typeof data.mc === 'number') storeMasteredSync(id, data.mc); // 하락도 전파(진짜 실력 신호)
  if (data.tone) saveToneStats(id, mergeToneStats(loadToneStats(id), data.tone)); // 성조별 정확도
  if (typeof data.tier === 'number') bumpTierPeak(id, data.tier);                  // 최고 등급(오르기만)
  if (typeof data.xp === 'number') saveXp(id, mergeXp(loadXp(id) ?? 0, data.xp));  // 누적 XP = max(멱등 — pull마다 인플레 금지)
  if (typeof data.rk === 'number') saveRank(id, mergeRank(loadRank(id) ?? 0, data.rk)); // 등급 = max(우상향)
  if (Array.isArray(data.ach) && data.ach.length) {
    saveAchievements(id, [...new Set([...loadAchievements(id), ...data.ach])]);    // 업적=합집합
  }
  if (typeof data.rm === 'number' && data.rm > loadReviewMastered(id)) {
    addReviewMastered(id, data.rm - loadReviewMastered(id));                       // 복습마스터수=큰 쪽
  }
  if (data.streak) saveStreak(id, mergeStreak(loadStreak(id), data.streak));       // 스트릭
  if (typeof data.frz === 'number' && data.frz > loadFreezes(id)) saveFreezes(id, data.frz); // 프리즈=큰 쪽
  if (data.stg && typeof data.stg === 'object') {                                  // 스테이지 최고점 = id별 max 병합(saveStageScore 내장)
    for (const [sid, sc] of Object.entries(data.stg)) { if (typeof sc === 'number') saveStageScore(id, sid, sc); }
  }
  if (typeof data.bp === 'number') saveBossPeak(id, data.bp);                       // 승급시험 통과 최고 급 = max 병합(saveBossPeak 내장)
}

// 토큰 만료(60일)·계정없음 등 인증 실패면 세션을 정리(조용한 무기한 동기화실패 방지). 그 외(네트워크 등)는 유지.
function logoutIfAuthError(e) {
  if (e && (e.status === 401 || e.status === 403 || e.status === 404)) logoutMember();
}
// 서버(/game/me) → 로컬 머지. 회원 진입/로그인 시.
export async function pullMemberData(identity) {
  if (!identity || identity.kind !== 'member') return;
  try {
    const { user } = await fetchGameMe(identity.token);
    applyGameDataToLocal(identity.id, user?.gameData);
  } catch (e) { logoutIfAuthError(e); throw e; }
}
// 로컬 → 서버(/game/me) 업로드. 게임 종료 시. nickname 주면 함께 저장(로그인 시 이름 입력).
export async function pushMemberData(identity, nickname) {
  if (!identity || identity.kind !== 'member') return;
  try {
    await saveGameMe(identity.token, collectLocalGameData(identity.id), nickname || undefined);
  } catch (e) { logoutIfAuthError(e); throw e; }
}
// 게스트 로컬 기록을 회원 로컬에 1회 병합(로그인 직후). 이후 pull/push로 서버 동기화.
export function mergeGuestIntoMember(identity) {
  if (!identity || identity.kind !== 'member') return;
  let guestId = null;
  try { guestId = localStorage.getItem(GUEST_ID_KEY); } catch { /* noop */ }
  if (!guestId || guestId === identity.id) return;
  applyGameDataToLocal(identity.id, collectLocalGameData(guestId));
}

// (학생→회원 흡수 mergeStudentIntoMember/studentBestsToGameData 제거 — 게임은 학생앱과 완전 분리,
//  회원 인증은 소셜 로그인. 학생 예약코드 연결·전화번호 매칭 경로 폐기, 2026-07-06.)

// ── 게임 데이터 초기화 ─────────────────────────────────────────────────
// 설정(메뉴) → '데이터 초기화'. 이 게임이 쓰는 로컬 키만 지운다.
//  ⚠️ 같은 도메인에 강사앱·학생앱이 함께 있으므로 localStorage.clear()는 절대 금지 —
//   그러면 강사 로그인·캐시까지 날아간다(2026-08-10).
//  ⚠️ 회원(소셜 로그인) 상태면 로그아웃까지 해야 초기화가 유지된다. 로그인이 남아 있으면
//   다음 동기화에서 서버 기록이 그대로 내려와 "초기화가 안 된 것"처럼 보인다.
//  ⚠️ 코치마크(둘러보기)는 접두사 밖에 산다 — `tab_tips_v1` **한 덩어리 JSON**에 모여 있고
//   그 안에 학생앱 팁(공지·내 수업·보관함·홈)까지 같이 들어 있다. 통째로 지우면 학생앱 팁이
//   다시 뜬다 → 게임 팁('game-' 로 시작하는 항목)만 골라 뺀다(2026-08-10).
const RESET_PREFIXES = ['game_', 'tg_'];
const TIPS_KEY = 'tab_tips_v1';
const TIP_PREFIX = 'game-';
export function resetGameData() {
  let n = 0;
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && RESET_PREFIXES.some((p) => k.startsWith(p))) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    n = keys.length;
  } catch { /* noop */ }
  // 코치마크 — 게임 항목만 제거해 초기화 후 둘러보기가 처음처럼 다시 뜨게 한다.
  try {
    const raw = localStorage.getItem(TIPS_KEY);
    if (raw) {
      const seen = JSON.parse(raw);
      let removed = 0;
      Object.keys(seen).forEach((k) => { if (k.startsWith(TIP_PREFIX)) { delete seen[k]; removed += 1; } });
      if (removed) {
        if (Object.keys(seen).length) localStorage.setItem(TIPS_KEY, JSON.stringify(seen));
        else localStorage.removeItem(TIPS_KEY);   // 게임 팁만 있었으면 키 자체를 정리
        n += removed;
      }
    }
  } catch { /* noop — 파싱 실패해도 나머지 초기화는 유효 */ }
  return n;
}
