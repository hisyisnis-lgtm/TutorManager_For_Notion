import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectPushDiagnostics, recordPushDiagnosticEvent, registerPushDiagnosticRouteReader,
  setPushDiagnosticAppState } from './pushDiagnostics.js';

const KEY = 'teacher_push_diagnostics_v1';
const SECRET = 'PRIVATE_STUDENT_TOKEN_AND_BODY';
let unregisterRoute;

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, '', '/#/home');
  setPushDiagnosticAppState({ auth: true, swReady: true, needRefresh: false });
  delete navigator.serviceWorker;
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  unregisterRoute?.();
  unregisterRoute = undefined;
  sessionStorage.clear();
  delete navigator.serviceWorker;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function installWorker(data, respond = true) {
  let channel;
  vi.stubGlobal('MessageChannel', class {
    constructor() {
      channel = this;
      this.port1 = { close: vi.fn() };
      this.port2 = { close: vi.fn() };
    }
  });
  const worker = { state: 'activated', postMessage: vi.fn(() => {
    if (respond) channel.port1.onmessage({ data });
  }) };
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
    controller: worker,
    getRegistration: vi.fn(async () => ({ active: worker, waiting: { state: 'installed' } })),
  } });
  return worker;
}

describe('개인정보 없는 로컬 푸시 진단', () => {
  it('ID·제목·본문·URL·토큰과 임의 오류 문자열을 이벤트나 snapshot에 남기지 않는다', async () => {
    window.history.replaceState(null, '', `/?push_notification=${SECRET}#/notifications?id=${SECRET}&via=push`);
    recordPushDiagnosticEvent('navigation-applied', {
      id: SECRET, title: SECRET, body: SECRET, url: SECRET, token: SECRET,
      reason: SECRET, payload: { body: SECRET }, ageMs: 42,
    });
    recordPushDiagnosticEvent(SECRET, { body: SECRET });
    unregisterRoute = registerPushDiagnosticRouteReader(() => ({
      routerRoute: `/personal/${SECRET}`, routerHasId: true, urlRouterMatch: false, token: SECRET,
    }));
    const result = await collectPushDiagnostics();
    expect(result.location).toEqual({ kind: 'teacher', route: 'notifications',
      hasNotificationId: true, hasNativeQuery: true, viaPush: true });
    expect(result.routeSync).toEqual({ routerRoute: 'other', routerHasId: true, urlRouterMatch: false });
    expect(result.events).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(sessionStorage.getItem(KEY)).not.toContain(SECRET);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('학생 경로는 public enum만 남긴다', async () => {
    window.history.replaceState(null, '', `/personal/${SECRET}?auth=${SECRET}`);
    recordPushDiagnosticEvent('browser-focus');
    const result = await collectPushDiagnostics();
    expect(result.location.kind).toBe('public');
    expect(result.location.route).toBe('public');
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('최근 40개만 저장하고 reload처럼 저장소에서 다시 읽는다', async () => {
    for (let i = 0; i < 55; i += 1) recordPushDiagnosticEvent('pull-pending', { ageMs: i });
    const stored = JSON.parse(sessionStorage.getItem(KEY));
    expect(stored).toHaveLength(40);
    expect(stored[0].ageMs).toBe(15);
    expect((await collectPushDiagnostics()).events).toEqual(stored);
  });

  it('24시간이 지난 이벤트와 변조된 저장소 payload를 수집 시 제거한다', async () => {
    sessionStorage.setItem(KEY, JSON.stringify([
      { event: 'browser-focus', at: Date.now() - 86400001, title: SECRET },
      { event: 'browser-focus', at: Date.now(), payload: SECRET },
      { event: SECRET, at: Date.now() },
    ]));
    const result = await collectPushDiagnostics();
    expect(result.events).toEqual([{ event: 'browser-focus', at: result.events[0].at }]);
    expect(sessionStorage.getItem(KEY)).not.toContain(SECRET);
  });

  it('SW 응답도 allowlist로 정제하고 오직 local diagnostics 메시지만 보낸다', async () => {
    const worker = installWorker({
      type: 'teacher-push-diagnostics', version: '2.47.7', nativeNavigateSupported: true,
      token: SECRET,
      events: [{ event: 'push-shown', at: Date.now(), targetKind: 'query', hasId: true,
        title: SECRET, body: SECRET, url: SECRET }, { event: SECRET, at: Date.now() }],
      pending: { present: true, ageMs: 100, id: SECRET, url: SECRET },
    });
    const result = await collectPushDiagnostics();
    expect(result.serviceWorker).toMatchObject({ hasController: true, controllerState: 'activated',
      activeState: 'activated', waitingState: 'installed', diagnostics: { available: true,
        version: '2.47.7', nativeNavigateSupported: true, pending: { present: true, ageMs: 100 } } });
    expect(result.serviceWorker.diagnostics.events).toHaveLength(1);
    expect(worker.postMessage.mock.calls[0][0]).toEqual({ type: 'teacher-push-diagnostics-request' });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('SW 응답이 없으면 1.5초 안에 unavailable을 반환한다', async () => {
    vi.useFakeTimers();
    installWorker(null, false);
    const collected = collectPushDiagnostics();
    await vi.advanceTimersByTimeAsync(1500);
    expect((await collected).serviceWorker.diagnostics).toEqual({ available: false, reason: 'timeout' });
  });

  it('registration 조회가 끝나지 않아도 전체 제한시간을 지킨다', async () => {
    vi.useFakeTimers();
    installWorker(null, false);
    navigator.serviceWorker.getRegistration.mockReturnValue(new Promise(() => {}));
    const collected = collectPushDiagnostics();
    await vi.advanceTimersByTimeAsync(1500);
    expect((await collected).serviceWorker.diagnostics.reason).toBe('timeout');
  });

  it('잘못된 SW 응답의 내용이나 오류 문자열은 출력하지 않는다', async () => {
    installWorker({ type: SECRET, body: SECRET });
    const result = await collectPushDiagnostics();
    expect(result.serviceWorker.diagnostics).toEqual({ available: false, reason: 'invalid-response' });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('SW 응답 도중 활성화가 완료되면 과거 activating 상태 대신 현재 상태를 반환한다', async () => {
    const worker = installWorker({ type: 'teacher-push-diagnostics', version: '2.47.8' });
    worker.state = 'activating';
    const original = worker.postMessage.getMockImplementation();
    worker.postMessage.mockImplementation((...args) => { worker.state = 'activated'; original(...args); });
    const result = await collectPushDiagnostics();
    expect(result.serviceWorker).toMatchObject({ controllerState: 'activated', activeState: 'activated', controllerMatchesActive: true });
  });

  it('구독 유무만 읽고 endpoint나 구독 키는 수집하지 않는다', async () => {
    const worker = installWorker({ type: 'teacher-push-diagnostics', version: '2.47.8',
      executionState: 'activated', storageReadable: true });
    const getSubscription = vi.fn(async () => ({ endpoint: SECRET, keys: { auth: SECRET } }));
    navigator.serviceWorker.getRegistration.mockResolvedValue({ active: worker, pushManager: { getSubscription } });
    const result = await collectPushDiagnostics();
    expect(result.serviceWorker.hasSubscription).toBe(true);
    expect(result.serviceWorker.diagnostics).toMatchObject({ executionState: 'activated', storageReadable: true });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(getSubscription).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('구독 조회가 멈춰도 제한시간 안에 이미 받은 SW 진단을 반환한다', async () => {
    vi.useFakeTimers();
    const worker = installWorker({ type: 'teacher-push-diagnostics', version: '2.47.8' });
    navigator.serviceWorker.getRegistration.mockResolvedValue({ active: worker,
      pushManager: { getSubscription: () => new Promise(() => {}) } });
    const collected = collectPushDiagnostics();
    await vi.advanceTimersByTimeAsync(1500);
    expect((await collected).serviceWorker).toMatchObject({ hasSubscription: null, diagnostics: { available: true, version: '2.47.8' } });
  });
});
