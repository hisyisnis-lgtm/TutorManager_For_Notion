// 게임 계정 API — Worker /game/me(회원 게임데이터) + /game/auth(소셜 로그인) 라우트 호출.
// 게임은 Notion과 완전 분리 — 학생 토큰 기반 /game/best 호출은 제거됨(2026-07-12).
// 회원 동기화는 /game/me JSON 통째 pull/push(gameStore), 단어 풀은 번들(fetchToneWords).
import { WORKER_URL } from '../config.js';
import { SEED_WORDS } from '../constants/toneGameWords.js';
import { fetchWithTimeout } from './fetchTimeout.js';

async function gameFetch(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchWithTimeout(`${WORKER_URL}${path}`, {
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
 * 브라우저에 일회 verifier를 보관하고 redirect로 돌아온 짧은 교환 코드를 검증한다.
 * @param {'kakao'|'google'} provider
 * @param {string} redirect 로그인 후 복귀할 주소(현재 게임 URL)
 */
const LOGIN_TRANSACTION_KEY = 'tg_login_transaction_v2';
const toBase64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function socialLoginUrl(provider, redirect) {
  if (!['google', 'kakao'].includes(provider)) throw new Error('지원하지 않는 로그인입니다.');
  const verifier = toBase64url(crypto.getRandomValues(new Uint8Array(32)));
  const transaction = toBase64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = toBase64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  // sessionStorage stays with the initiating tab; never include the verifier in a URL.
  window.sessionStorage.setItem(LOGIN_TRANSACTION_KEY, JSON.stringify({ verifier, transaction, redirect, expiresAt: Date.now() + 600_000 }));
  const params = new URLSearchParams({ redirect, code_challenge: challenge, transaction });
  return `${WORKER_URL}/game/auth/${provider}/start?${params}`;
}

/** Reject unsolicited/legacy tokens and consume only a callback bound to this tab. */
export function takeLoginFromHash() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if (!['token', 'login_code', 'login_tx'].some(key => params.has(key))) return null;
  const code = params.get('login_code');
  const transaction = params.get('login_tx');
  const legacyToken = params.has('token');
  for (const key of ['token', 'login_code', 'login_tx']) params.delete(key);
  const rest = params.toString();
  window.history.replaceState(null, '', window.location.pathname + window.location.search + (rest ? `#${rest}` : ''));
  let pending;
  try { pending = JSON.parse(window.sessionStorage.getItem(LOGIN_TRANSACTION_KEY) || 'null'); } catch { return null; }
  if (legacyToken || !pending || pending.transaction !== transaction || !(pending.expiresAt > Date.now())
    || pending.redirect !== window.location.origin + window.location.pathname
    || !/^[a-f0-9]{64}$/.test(code || '') || !/^[A-Za-z0-9_-]{43}$/.test(pending.verifier || '')) return null;
  window.sessionStorage.removeItem(LOGIN_TRANSACTION_KEY);
  return { code, transaction, verifier: pending.verifier };
}

export async function exchangeGameLogin(callback) {
  return gameFetch('POST', '/game/auth/exchange', callback);
}
/** 게임유저 JWT로 내 계정·게임데이터 조회. @returns {Promise<{user}>} */
export async function fetchGameMe(token) {
  return gameFetch('GET', '/game/me', undefined, token);
}
/** 게임데이터(JSON 통째) 저장. */
export async function saveGameMe(token, gameData, nickname) {
  return gameFetch('PUT', '/game/me', { gameData, ...(nickname ? { nickname } : {}) }, token);
}

/** 계정 삭제(회원 탈퇴) — 서버 행을 지운다. 되돌릴 수 없다. */
export async function deleteGameMe(token) {
  return gameFetch('DELETE', '/game/me', undefined, token);
}

/**
 * 성조 게임 단어 풀 조회 — CSV(03_data/tone-words/tone-words-*.csv, 난이도·테마별 분할)에서 빌드 변환된 로컬 데이터를 반환.
 * 단어는 모든 유저 동일·소량이라 클라이언트 번들에 포함 → 네트워크/워커/Notion 불필요.
 * async 시그니처는 호출부(await fetchToneWords) 호환을 위해 유지.
 * @param {string} difficulty 난이도('easy'|'normal'|'hard') 또는 테마 id('drama'|'travel'…)
 * @returns {Promise<Array<{hanzi: string, pinyin: string[], tones: number[], meaning: string}>>}
 */
export async function fetchToneWords(difficulty) {
  return SEED_WORDS[difficulty] ?? [];
}
