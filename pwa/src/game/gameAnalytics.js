// 게임 이벤트 측정 — 유입 깔때기 판단용 익명 카운터. POST /game/event → Workers Analytics Engine.
// 원칙: PII 없음(전화·토큰·이름 미전송) · 실패 조용히 무시(게임 무영향) · DEV는 콘솔 로그만(노이즈 방지).
// src = 유입 소스(web/standalone/twa) — 스토어(TWA) 출시 후 웹 vs 스토어 유입 구분용.
// ⚠️ sendBeacon은 application/json이면 preflight가 필요해 조용히 실패 → text/plain으로 보냄(워커 request.json()은 content-type 무관 파싱).
import { WORKER_URL } from '../config.js';

function detectSource() {
  try {
    if (document.referrer && document.referrer.startsWith('android-app://')) return 'twa';
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return 'standalone';
  } catch { /* noop */ }
  return 'web';
}

/** 이벤트 1건 전송(fire-and-forget). e=이벤트명, props={ m?(라벨), k?(신원), v?(수치) } */
export function track(e, props = {}) {
  try {
    if (import.meta.env.DEV) { console.debug('[game-track]', e, props); return; }
    const payload = JSON.stringify({ e, src: detectSource(), ...props });
    const url = `${WORKER_URL}/game/event`;
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([payload], { type: 'text/plain' }));
    } else {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: payload, keepalive: true }).catch(() => {});
    }
  } catch { /* 측정 실패는 무시 — 게임에 영향 없음 */ }
}
