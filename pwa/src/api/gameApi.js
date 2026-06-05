// 미니게임 베스트 API — Worker /game/best/* 라우트 호출
//
// 학생 토큰 + 게임 키 기반 공개 API. JWT 인증 불필요.
// localStorage 캐시 패턴과 함께 사용 — 진입 시 fetchOne으로 동기화, 종료 시 submit (fire-and-forget).
import { WORKER_URL } from '../config.js';
import { SEED_WORDS } from '../constants/toneGameWords.js';

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

// ── 게임 계정(독립실행) 회원 — 휴대폰 OTP 가입/로그인 + 게임데이터 동기화 ──
/** 휴대폰으로 인증번호(알림톡) 발송 요청. @returns {Promise<{ok, devCode?}>} */
export async function requestGameOtp(phone) {
  return gameFetch('POST', '/game/auth/otp', { phone });
}
/** 인증번호 검증 → 회원 find-or-create → 게임유저 JWT. @returns {Promise<{token, user}>} */
export async function verifyGameOtp(phone, code) {
  return gameFetch('POST', '/game/auth/verify', { phone, code });
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
  return gameFetch('GET', `/game/best/${encodeURIComponent(studentToken)}`);
}

/**
 * 특정 게임 베스트 조회.
 * 없으면 null 반환 (첫 플레이 전).
 * @param {string} studentToken
 * @param {string} gameKey - 'tone' 등
 */
export async function fetchGameBest(studentToken, gameKey) {
  return gameFetch('GET', `/game/best/${encodeURIComponent(studentToken)}/${encodeURIComponent(gameKey)}`);
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
    result
  );
}

// 단어 풀 localStorage 캐시 — Worker 엣지 캐시(1시간)와 별개로
// 오프라인/네트워크 실패 시 fallback 용도. 24시간 TTL.
const TONE_WORDS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
function toneWordsCacheKey(difficulty) { return `tone_words_${difficulty}`; }

function readToneWordsCache(difficulty) {
  try {
    const raw = localStorage.getItem(toneWordsCacheKey(difficulty));
    if (!raw) return null;
    const { ts, words } = JSON.parse(raw);
    if (!Array.isArray(words) || words.length === 0) return null;
    if (Date.now() - ts > TONE_WORDS_CACHE_TTL_MS) return null;
    return words;
  } catch { return null; }
}

function writeToneWordsCache(difficulty, words) {
  try {
    localStorage.setItem(toneWordsCacheKey(difficulty), JSON.stringify({ ts: Date.now(), words }));
  } catch { /* quota 초과 등 무시 */ }
}

/**
 * 성조 게임 단어 풀 조회.
 * Notion DB의 활성 단어를 난이도별로 가져온다. 네트워크 실패 시 localStorage fallback.
 * @param {'easy'|'normal'|'hard'} difficulty
 * @returns {Promise<Array<{hanzi: string, pinyin: string[], tones: number[], meaning: string}>>}
 */
export async function fetchToneWords(difficulty) {
  try {
    const words = await gameFetch('GET', `/game/tone-words/${encodeURIComponent(difficulty)}`);
    if (Array.isArray(words) && words.length > 0) {
      writeToneWordsCache(difficulty, words);
      return words;
    }
    // 서버는 응답했으나 빈 배열인 경우 — 캐시 → 시드 폴백
    const cached = readToneWordsCache(difficulty);
    if (cached) return cached;
    return SEED_WORDS[difficulty] ?? [];
  } catch (e) {
    // 네트워크/라우트 실패 — 캐시 → 시드 폴백 (워커 미배포/오프라인에서도 플레이 보장)
    const cached = readToneWordsCache(difficulty);
    if (cached) return cached;
    const seed = SEED_WORDS[difficulty];
    if (seed && seed.length > 0) return seed;
    throw e;
  }
}
