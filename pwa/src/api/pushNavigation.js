const NAVIGATION_MESSAGE = 'teacher-push-navigation';
const MAX_PENDING_AGE = 10 * 60 * 1000;
const REQUEST_TIMEOUT = 2500;
const PULL_WINDOW = 5000;
const PULL_INTERVAL = 500;
const appliedClicks = new Set();

// 학생·공개 화면을 보고 있던 창은 강사용 푸시가 빼앗지 않는다.
function isTeacherWindow(location) {
  if (location.pathname !== '/') return false;
  const route = (location.hash || '#/').slice(1).split('?')[0];
  return /^\/(?:$|login$|(?:home|notifications|notices|settings|students|classes|payments|logs|bookings|consult|homework)(?:\/|$))/.test(route);
}

function notificationDestination(value, origin) {
  if (typeof value !== 'string') return null;
  try {
    const target = new URL(value, origin);
    if (target.origin !== origin || target.pathname !== '/' || target.search
      || !target.hash.startsWith('#/notifications?')) return null;
    const query = new URLSearchParams(target.hash.slice('#/notifications?'.length));
    if (!query.get('id')?.trim()) return null;
    return target;
  } catch { return null; }
}

/** SW가 보관한 클릭 목적지는 인증·라우터 준비 후 적용하고, 적용한 클릭만 확인 응답한다. */
export function connectPushNavigation({ canNavigate }) {
  const serviceWorker = navigator.serviceWorker;
  if (!serviceWorker) return () => {};
  let disposed = false;
  let activeWorker;
  let latestAppliedCreatedAt = 0;
  let pullTimer;
  let pullDeadline = 0;
  const requests = new Map();
  const eligible = () => !disposed && document.visibilityState !== 'hidden'
    && canNavigate() && isTeacherWindow(window.location);

  const stopPulling = () => {
    clearTimeout(pullTimer);
    pullTimer = undefined;
    pullDeadline = 0;
  };

  const acknowledge = (clickId, worker) => {
    if (!clickId) return;
    try {
      (worker || serviceWorker.controller || activeWorker)?.postMessage({
        type: 'teacher-push-navigation-ack', clickId,
      });
    } catch { /* SW 갱신 중이면 다음 요청에서 확인 응답을 다시 보낸다. */ }
  };

  const receive = (data, worker) => {
    if (data?.type !== NAVIGATION_MESSAGE || !eligible()) return;
    const pending = data.pending;
    // 구버전 SW의 직접 전달도 허용하되 알림 상세 목적지만 받는다.
    const target = notificationDestination(pending?.url ?? data.url, window.location.origin);
    if (!target) return;
    if (pending && (typeof pending.clickId !== 'string' || !pending.clickId
      || !Number.isFinite(pending.createdAt) || pending.createdAt > Date.now() + 60000
      || Date.now() - pending.createdAt > MAX_PENDING_AGE)) return;
    if (pending && pending.createdAt < latestAppliedCreatedAt) return;
    const clickId = pending?.clickId;
    if (!clickId || !appliedClicks.has(clickId)) {
      window.location.hash = target.hash;
      if (window.location.hash !== target.hash || !eligible()) return;
      if (clickId) {
        appliedClicks.add(clickId);
        if (appliedClicks.size > 100) appliedClicks.delete(appliedClicks.values().next().value);
      }
    }
    if (pending) latestAppliedCreatedAt = pending.createdAt;
    stopPulling();
    acknowledge(clickId, worker);
  };

  const request = (worker = serviceWorker.controller || activeWorker) => {
    if (!eligible() || !worker || requests.size > 0 || typeof globalThis.MessageChannel === 'undefined') return;
    const channel = new globalThis.MessageChannel();
    let timer;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      requests.delete(worker);
    };
    requests.set(worker, close);
    channel.port1.onmessage = (event) => {
      if (closed) return;
      close();
      receive(event.data, worker);
    };
    timer = setTimeout(close, REQUEST_TIMEOUT);
    try {
      worker.postMessage({ type: 'teacher-push-navigation-request' }, [channel.port2]);
    } catch { close(); }
  };

  const pull = () => {
    pullTimer = undefined;
    if (!eligible() || Date.now() > pullDeadline) { stopPulling(); return; }
    request();
    if (pullDeadline && Date.now() < pullDeadline) pullTimer = setTimeout(pull, PULL_INTERVAL);
  };
  // 앱 시작이 SW의 클릭 저장보다 빠르면 처음에는 null일 수 있으므로 잠깐 재조회한다.
  const onResume = () => {
    stopPulling();
    if (!eligible()) return;
    pullDeadline = Date.now() + PULL_WINDOW;
    pull();
  };
  const onMessage = (event) => {
    if (event.data?.type !== NAVIGATION_MESSAGE) return;
    // 새 클릭의 직접 전달보다 먼저 시작된 조회는 같은 밀리초의 응답도 덮어쓰지 못한다.
    requests.forEach((close) => close());
    receive(event.data, event.source);
  };
  const onVisible = () => { if (document.visibilityState === 'visible') onResume(); };
  serviceWorker.addEventListener('message', onMessage);
  serviceWorker.addEventListener('controllerchange', onResume);
  window.addEventListener('focus', onResume);
  window.addEventListener('pageshow', onResume);
  document.addEventListener('visibilitychange', onVisible);
  onResume();
  // iOS cold start에서는 controller와 메시지 수신자가 늦게 생길 수 있다.
  // ready를 기다리며 렌더를 막지 않고, 이미 종료된 인증 범위에는 적용하지 않는다.
  serviceWorker.ready?.then((registration) => {
    if (disposed) return;
    activeWorker = registration.active;
    onResume();
  }).catch(() => {});

  return () => {
    disposed = true;
    stopPulling();
    requests.forEach((close) => close());
    serviceWorker.removeEventListener('message', onMessage);
    serviceWorker.removeEventListener('controllerchange', onResume);
    window.removeEventListener('focus', onResume);
    window.removeEventListener('pageshow', onResume);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
