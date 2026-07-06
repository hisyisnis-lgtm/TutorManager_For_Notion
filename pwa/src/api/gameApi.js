// 미니게임 베스트 API — Worker /game/best/* + /game/me(회원) + /game/auth(소셜) 라우트 호출
//
// 베스트 라우트는 학생 토큰 + 게임 키 기반이며 studentBearer(인증 게이트 통과 시)로 Authorization을 첨부한다.
// localStorage 캐시 패턴과 함께 사용 — 진입 시 fetchAllGameBests로 로컬 캐시 복원(serverToCache),
// 종료 시 submit(fire-and-forget — 실패해도 다음 종료 때 로컬 최고점을 다시 보내 수렴).
import { WORKER_URL } from '../config.js';
import { SEED_WORDS } from '../constants/toneGameWords.js';
import { studentBearer } from './studentAuth.js';

async function gameFetch(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${WORKER_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ── 게임 계정(독립실행) 회원 — 카카오·구글 소셜 로그인(OAuth BFF) + 게임데이터 동기화 ──
/**
 * 소셜 로그인 시작 URL. 브라우저를 이 URL로 보내면 Worker가 제공자 인증을 거쳐
 * redirect(현재 게임 주소)로 되돌아오며 location.hash에 #token=… 을 붙인다.
 * @param {'kakao'|'google'} provider
 * @param {string} redirect 로그인 후 복귀할 주소(현재 게임 URL)
 */
export function socialLoginUrl(provider, redirect) {
  return `${WORKER_URL}/game/auth/${encodeURIComponent(provider)}/start?redirect=${encodeURIComponent(redirect)}`;
}
/** 복귀 URL의 location.hash에서 게임유저 JWT(#token=…)를 꺼내고 주소에서 제거한다. 없으면 null. */
export function takeTokenFromHash() {
  const h = (typeof window !== 'undefined' && window.location.hash) || '';
  const m = h.match(/[#&]token=([^&]+)/);
  if (!m) return null;
  const token = decodeURIComponent(m[1]);
  try {
    const rest = h.replace(/[#&]token=[^&]+/, '').replace(/^#&?/, '#');
    const clean = rest === '#' ? '' : rest;
    window.history.replaceState(null, '', window.location.pathname + window.location.search + clean);
  } catch { /* noop */ }
  return token;
}
/** 게임유저 JWT로 내 계정·게임데이터 조회. @returns {Promise<{user}>} */
export async function fetchGameMe(token) {
  return gameFetch('GET', '/game/me', undefined, token);
}
/** 게임데이터(JSON 통째) 저장. */
export async function saveGameMe(token, gameData, nickname) {
  return gameFetch('PUT', '/game/me', { gameData, ...(nickname ? { nickname } : {}) }, token);
}

/**
 * 학생의 모든 게임 베스트 조회.
 * @param {string} studentToken
 * @returns {Promise<Array<{gameKey, gameName, bestScore, bestMaxCombo, bestAvgSec, playCount, lastPlayedAt, meta}>>}
 */
export async function fetchAllGameBests(studentToken) {
  return gameFetch('GET', `/game/best/${encodeURIComponent(studentToken)}`, undefined, studentBearer(studentToken));
}

/**
 * 특정 게임 베스트 조회.
 * 없으면 null 반환 (첫 플레이 전).
 * @param {string} studentToken
 * @param {string} gameKey - 'tone' 등
 */
export async function fetchGameBest(studentToken, gameKey) {
  return gameFetch('GET', `/game/best/${encodeURIComponent(studentToken)}/${encodeURIComponent(gameKey)}`, undefined, studentBearer(studentToken));
}

/**
 * 게임 결과 1회분 저장. Worker가 베스트 비교 후 갱신, playCount 증가.
 * @param {string} studentToken
 * @param {string} gameKey
 * @param {object} result - { score, maxCombo, avgMs, meta? }
 * @returns {Promise<{isNewBest, best}>}
 */
export async function submitGameResult(studentToken, gameKey, result) {
  return gameFetch(
    'POST',
    `/game/best/${encodeURIComponent(studentToken)}/${encodeURIComponent(gameKey)}`,
    result,
    studentBearer(studentToken)
  );
}

/**
 * 성조 게임 단어 풀 조회 — CSV(data/tone-words-*.csv, 난이도·테마별 분할)에서 빌드 변환된 로컬 데이터를 반환.
 * 단어는 모든 유저 동일·소량이라 클라이언트 번들에 포함 → 네트워크/워커/Notion 불필요.
 * async 시그니처는 호출부(await fetchToneWords) 호환을 위해 유지.
 * @param {string} difficulty 난이도('easy'|'normal'|'hard') 또는 테마 id('drama'|'travel'…)
 * @returns {Promise<Array<{hanzi: string, pinyin: string[], tones: number[], meaning: string}>>}
 */
export async function fetchToneWords(difficulty) {
  return SEED_WORDS[difficulty] ?? [];
}
