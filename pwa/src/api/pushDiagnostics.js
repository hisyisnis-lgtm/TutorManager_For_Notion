const STORAGE_KEY = 'teacher_push_diagnostics_v1';
const MAX_EVENTS = 40;
const TTL = 24 * 60 * 60 * 1000;
const EVENTS = new Set([
  'bridge-connect', 'bridge-dispose', 'bridge-ready', 'pull-request', 'pull-empty',
  'pull-pending', 'pull-timeout', 'navigation-applied', 'navigation-ignored', 'navigation-ack',
  'native-query-normalized', 'browser-focus', 'browser-pageshow', 'browser-visibility',
  'browser-hashchange', 'browser-popstate', 'route-status', 'route-mismatch', 'route-synced',
]);
const REASONS = new Set([
  'hidden', 'auth-or-startup', 'public-route', 'invalid-target', 'invalid-pending',
  'stale', 'duplicate', 'superseded', 'disposed', 'post-message-error', 'unsupported',
]);
const ROUTES = new Set(['root', 'home', 'notifications', 'notices', 'settings', 'students',
  'classes', 'payments', 'logs', 'bookings', 'consult', 'homework', 'login', 'public', 'other']);
const BOOLEAN_FIELDS = ['hasNotificationId', 'hasNativeQuery', 'viaPush', 'visible',
  'eligible', 'hasController', 'urlRouterMatch', 'routerHasId', 'superseded'];
let appState = { auth: null, swReady: null, needRefresh: null };
let routeReader = null;

export function diagnosticRouteName(pathname) {
  if (typeof pathname !== 'string') return 'other';
  const first = pathname.split('/')[1] || 'root';
  if (['personal', 'student', 'game', 'intro', 'pricing', 'consent', 'privacy',
    'group-class', 'bootcamp', 'book'].includes(first)) return 'public';
  return ROUTES.has(first) ? first : 'other';
}

function locationSnapshot() {
  const root = window.location.pathname === '/';
  const hash = root ? window.location.hash.slice(1) : '';
  const route = diagnosticRouteName(root ? hash.split('?')[0] || '/' : window.location.pathname);
  const query = new URLSearchParams(hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '');
  return {
    kind: !root ? route === 'public' ? 'public' : 'other'
      : route === 'root' ? 'root' : route === 'public' ? 'public' : route === 'other' ? 'other' : 'teacher',
    route,
    hasNotificationId: route === 'notifications' && Boolean(query.get('id')),
    hasNativeQuery: new URLSearchParams(window.location.search).has('push_notification'),
    viaPush: query.get('via') === 'push',
  };
}

function age(value) {
  return Number.isFinite(value) ? Math.min(TTL, Math.max(0, Math.round(value))) : null;
}

function sanitizeEvent(input) {
  if (!input || !EVENTS.has(input.event) || !Number.isFinite(input.at)
    || Date.now() - input.at > TTL || input.at > Date.now() + 60000) return null;
  const result = { event: input.event, at: input.at };
  if (REASONS.has(input.reason)) result.reason = input.reason;
  if (ROUTES.has(input.route)) result.route = input.route;
  if (ROUTES.has(input.routerRoute)) result.routerRoute = input.routerRoute;
  for (const key of BOOLEAN_FIELDS) {
    if (typeof input[key] === 'boolean') result[key] = input[key];
  }
  if (Number.isFinite(input.ageMs)) result.ageMs = age(input.ageMs);
  return result;
}

function readEvents() {
  try {
    const data = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(data) ? data.map(sanitizeEvent).filter(Boolean).slice(-MAX_EVENTS) : [];
  } catch { return []; }
}

function writeEvents(events) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(events)); } catch { /* 저장소 차단 */ }
}

// 메시지 payload·URL·ID·오류 문자열은 받더라도 허용된 필드 외에는 저장하지 않는다.
export function recordPushDiagnosticEvent(event, detail = {}) {
  if (!EVENTS.has(event)) return;
  try {
    const location = locationSnapshot();
    const clean = sanitizeEvent({ ...routeSnapshot(), ...detail, event, at: Date.now(), route: location.route,
      hasNotificationId: location.hasNotificationId, hasNativeQuery: location.hasNativeQuery,
      viaPush: location.viaPush, visible: document.visibilityState !== 'hidden' });
    if (clean) writeEvents([...readEvents(), clean].slice(-MAX_EVENTS));
  } catch { /* 진단 때문에 앱 동작을 중단하지 않는다. */ }
}

export function setPushDiagnosticAppState(value) {
  appState = Object.fromEntries(['auth', 'swReady', 'needRefresh'].map((key) =>
    [key, typeof value?.[key] === 'boolean' ? value[key] : null]));
}

// reader는 이미 enum/boolean으로 요약된 값만 반환한다. 실제 라우트 문자열은 보관하지 않는다.
export function registerPushDiagnosticRouteReader(reader) {
  routeReader = reader;
  return () => { if (routeReader === reader) routeReader = null; };
}

function routeSnapshot() {
  let value;
  try { value = routeReader?.(); } catch {}
  return {
    routerRoute: ROUTES.has(value?.routerRoute) ? value.routerRoute : 'other',
    routerHasId: typeof value?.routerHasId === 'boolean' ? value.routerHasId : null,
    urlRouterMatch: typeof value?.urlRouterMatch === 'boolean' ? value.urlRouterMatch : null,
  };
}

function workerState(worker) {
  return ['parsed', 'installing', 'installed', 'activating', 'activated', 'redundant'].includes(worker?.state)
    ? worker.state : null;
}

function version(value) {
  return typeof value === 'string' && /^(?:\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?|test)$/.test(value)
    && value.length <= 40 ? value : 'unknown';
}

function sanitizeWorkerDiagnostics(data) {
  const events = Array.isArray(data.events) ? data.events.filter((item) =>
    ['push-shown', 'notificationclick', 'navigation-error'].includes(item?.event)
      && Number.isFinite(item.at) && Date.now() - item.at <= TTL && item.at <= Date.now() + 60000)
    .slice(-MAX_EVENTS).map((item) => ({
      event: item.event, at: item.at,
      targetKind: ['query', 'hash', 'other'].includes(item.targetKind) ? item.targetKind : 'other',
      hasId: typeof item.hasId === 'boolean' ? item.hasId : null,
    })) : [];
  return {
    available: true, version: version(data.version),
    nativeNavigateSupported: typeof data.nativeNavigateSupported === 'boolean' ? data.nativeNavigateSupported : null,
    events, pending: {
      present: typeof data.pending?.present === 'boolean' ? data.pending.present : null,
      ageMs: age(data.pending?.ageMs),
    },
  };
}

function readWorkerDiagnostics() {
  const container = navigator.serviceWorker;
  const result = {
    hasController: Boolean(container?.controller), controllerState: workerState(container?.controller),
    activeState: null, waitingState: null,
    diagnostics: { available: false, reason: 'unsupported' },
  };
  if (!container || typeof globalThis.MessageChannel === 'undefined') return Promise.resolve(result);
  return new Promise((resolve) => {
    let settled = false;
    let channel;
    const finish = (diagnostics) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      channel?.port1.close();
      channel?.port2.close();
      resolve({ ...result, diagnostics });
    };
    const timer = setTimeout(() => finish({ available: false, reason: 'timeout' }), 1500);
    Promise.resolve().then(() => container.getRegistration?.()).then((registration) => {
      if (settled) return;
      result.activeState = workerState(registration?.active);
      result.waitingState = workerState(registration?.waiting);
      const worker = container.controller || registration?.active;
      if (!worker) { finish({ available: false, reason: 'no-worker' }); return; }
      channel = new globalThis.MessageChannel();
      channel.port1.onmessage = (event) => {
        if (event.data?.type !== 'teacher-push-diagnostics') {
          finish({ available: false, reason: 'invalid-response' });
          return;
        }
        finish(sanitizeWorkerDiagnostics(event.data));
      };
      worker.postMessage({ type: 'teacher-push-diagnostics-request' }, [channel.port2]);
    }).catch(() => finish({ available: false, reason: 'error' }));
  });
}

/** 로컬 상태만 읽는다. 네트워크 요청·푸시 발송·구독/인증 변경은 하지 않는다. */
export async function collectPushDiagnostics() {
  const events = readEvents();
  writeEvents(events);
  let standalone = navigator.standalone === true;
  try { standalone ||= window.matchMedia('(display-mode: standalone)').matches; } catch {}
  const permission = globalThis.Notification?.permission;
  return {
    appVersion: version(typeof __APP_VERSION__ === 'undefined' ? 'unknown' : __APP_VERSION__),
    location: locationSnapshot(), routeSync: routeSnapshot(),
    visibility: ['visible', 'hidden', 'prerender'].includes(document.visibilityState) ? document.visibilityState : 'unknown',
    standalone, notificationPermission: ['granted', 'denied', 'default'].includes(permission) ? permission : 'unsupported',
    ...appState, events, serviceWorker: await readWorkerDiagnostics(),
  };
}
