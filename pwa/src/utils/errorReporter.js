// 클라이언트 JS 에러 → Worker /error-log 전송
// - window.onerror, window.onunhandledrejection 두 가지 후크
// - 동일 에러 폭주 방지: sessionStorage에 메시지 hash 보관, 5분 내 1회 전송
// - 학생 토큰이 URL에 있으면 함께 전송 (디버깅 컨텍스트)

import { WORKER_URL } from '../config.js';

const DEDUP_TTL_MS = 5 * 60 * 1000;
const STORAGE_KEY = 'errorReporter:sentAt';

function getStudentTokenFromHash() {
  // /book/:token, /personal/:token 등에서 토큰 추출 시도
  const m = (window.location.hash || '').match(/^#\/(?:book|personal)\/([^/?]+)/);
  return m ? m[1] : '';
}

function shouldSkip(message) {
  // ResizeObserver 경고 등 무해한 노이즈 차단
  if (!message) return true;
  if (/ResizeObserver loop/i.test(message)) return true;
  if (/Script error/i.test(message)) return true; // cross-origin 보호로 정보 0
  if (/Non-Error promise rejection/i.test(message)) return true;
  return false;
}

function isDuplicate(key) {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    const now = Date.now();
    // 만료된 항목 정리
    for (const k of Object.keys(map)) {
      if (now - map[k] > DEDUP_TTL_MS) delete map[k];
    }
    if (map[key] && now - map[key] < DEDUP_TTL_MS) return true;
    map[key] = now;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    return false;
  } catch {
    return false;
  }
}

async function send(payload) {
  if (!WORKER_URL) return;
  try {
    // sendBeacon이 가능하면 우선 사용 (페이지 언로드 중에도 전송 보장)
    const url = `${WORKER_URL}/error-log`;
    const data = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      const blob = new Blob([data], { type: 'application/json' });
      navigator.sendBeacon(url, blob);
      return;
    }
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: data,
      keepalive: true,
    });
  } catch {
    // 에러 리포터가 에러를 던지면 안 됨
  }
}

function buildPayload({ message, source, lineno, colno, error }) {
  return {
    message: String(message || error?.message || 'unknown'),
    source: String(source || ''),
    lineno: lineno ?? null,
    colno: colno ?? null,
    stack: error?.stack || '',
    url: window.location.href,
    userAgent: navigator.userAgent,
    studentToken: getStudentTokenFromHash(),
  };
}

export function installErrorReporter() {
  if (typeof window === 'undefined') return;
  if (window.__errorReporterInstalled) return;
  window.__errorReporterInstalled = true;

  window.addEventListener('error', (event) => {
    const { message, filename, lineno, colno, error } = event;
    if (shouldSkip(message)) return;
    const dedupKey = `${message}:${filename}:${lineno}`;
    if (isDuplicate(dedupKey)) return;
    send(buildPayload({ message, source: filename, lineno, colno, error }));
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = reason?.message || String(reason);
    if (shouldSkip(message)) return;
    const dedupKey = `unhandled:${message}`;
    if (isDuplicate(dedupKey)) return;
    send(buildPayload({
      message: `Unhandled Promise Rejection: ${message}`,
      error: reason instanceof Error ? reason : null,
    }));
  });
}
