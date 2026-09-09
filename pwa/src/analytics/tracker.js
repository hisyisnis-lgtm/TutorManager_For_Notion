import { CHANNELS, EVENTS } from './catalog.js';

const KEY = 'hanul_analytics_session_v1';
const TTL = 30 * 60 * 1000;
const ID = /^[a-f0-9-]{36}$/;
// 탭 메모리는 저장소가 차단된 브라우저에서도 같은 페이지 이벤트를 연결한다.
let memory;
export function createTracker(service, endpoint, enabled = true) {
  const active = () => enabled && !['localhost', '127.0.0.1'].includes(location.hostname)
    && navigator.doNotTrack !== '1' && !navigator.globalPrivacyControl;
  function session() {
    const now = Date.now();
    if (!memory) {
      try { memory = JSON.parse(sessionStorage.getItem(KEY)); } catch { /* memory only */ }
      const url = new URL(location.href);
      const sid = url.searchParams.get('ha_sid');
      const started = Number(url.searchParams.get('ha_at'));
      const source = url.searchParams.get('ha_source');
      if (ID.test(sid || '') && started <= now && now - started < TTL) memory = { sid, started, source: Object.hasOwn(CHANNELS, source) ? source : 'direct' };
      if (url.searchParams.has('ha_sid')) {
        ['ha_sid', 'ha_at', 'ha_source'].forEach(key => url.searchParams.delete(key));
        history.replaceState(history.state, '', url);
      }
    }
    if (!memory || !ID.test(memory.sid || '') || !Number.isFinite(memory.started) || now - memory.started >= TTL || memory.started > now) {
      const sourceParam = new URL(location.href).searchParams.get('utm_source')?.toLowerCase();
      let ref = '';
      try { ref = new URL(document.referrer).hostname; } catch { /* direct */ }
      const source = Object.hasOwn(CHANNELS, sourceParam) ? sourceParam
        : Object.keys(CHANNELS).find(key => ref.split('.').includes(key)) || (ref && ref !== location.hostname ? 'referral' : 'direct');
      memory = { sid: crypto.randomUUID(), started: now, source };
    }
    try { sessionStorage.setItem(KEY, JSON.stringify(memory)); } catch { /* memory only */ }
    return memory;
  }
  function track(event) {
    try {
      if (!active() || !EVENTS.includes(event)) return;
      const s = session();
      const payload = JSON.stringify({ service, event, sid: s.sid, source: s.source, at: Date.now(), id: crypto.randomUUID() });
      if (!navigator.sendBeacon?.(endpoint, new Blob([payload], { type: 'text/plain' }))) {
        void fetch(endpoint, { method: 'POST', body: payload, headers: { 'Content-Type': 'text/plain' }, keepalive: true, credentials: 'omit' }).catch(() => {});
      }
    } catch { /* 측정 실패가 화면·게임을 멈추지 않도록 한다. */ }
  }
  function decorate(href) {
    try {
      const url = new URL(href, location.href);
      if (!active() || url.origin !== 'https://tiantian-chinese.pages.dev' || url.pathname !== '/game/tone') return href;
      const s = session();
      url.searchParams.set('ha_sid', s.sid);
      url.searchParams.set('ha_at', String(s.started));
      url.searchParams.set('ha_source', s.source);
      return url.href;
    } catch { return href; }
  }
  return { track, decorate };
}
