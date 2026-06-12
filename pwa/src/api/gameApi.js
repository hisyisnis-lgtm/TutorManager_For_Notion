// 미니게임 베스트 API — Worker /game/best/* 라우트 호출
//
// 학생 토큰 + 게임 키 기반 공개 API. JWT 인증 불필요.
// localStorage 캐시 패턴과 함께 사용 — 진입 시 fetchOne으로 동기화, 종료 시 submit (fire-and-forget).
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
 * 성조 게임 단어 풀 조회 — CSV(data/tone-words.csv)에서 빌드 변환된 로컬 데이터를 반환.
 * 단어는 모든 유저 동일·소량이라 클라이언트 번들에 포함 → 네트워크/워커/Notion 불필요.
 * async 시그니처는 호출부(await fetchToneWords) 호환을 위해 유지.
 * @param {'easy'|'normal'|'hard'} difficulty
 * @returns {Promise<Array<{hanzi: string, pinyin: string[], tones: number[], meaning: string}>>}
 */
export async function fetchToneWords(difficulty) {
  return SEED_WORDS[difficulty] ?? [];
}
