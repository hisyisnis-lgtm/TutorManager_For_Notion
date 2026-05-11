// 미니게임 베스트 API — Worker /game/best/* 라우트 호출
//
// 학생 토큰 + 게임 키 기반 공개 API. JWT 인증 불필요.
// localStorage 캐시 패턴과 함께 사용 — 진입 시 fetchOne으로 동기화, 종료 시 submit (fire-and-forget).
import { WORKER_URL } from '../config.js';

async function gameFetch(method, path, body) {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
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
