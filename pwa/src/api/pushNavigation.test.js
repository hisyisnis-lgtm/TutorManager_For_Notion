import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectPushNavigation, normalizePushLaunch } from './pushNavigation.js';

let serviceWorker;
let worker;
let resolveReady;
let disconnect;
let sequence = 0;
const channels = [];

function pending(overrides = {}) {
  sequence += 1;
  return {
    url: `${window.location.origin}/#/notifications?id=notification-${sequence}`,
    clickId: `click-${sequence}`, createdAt: Date.now(), ...overrides,
  };
}

function deliver(value) {
  const event = new Event('message');
  Object.assign(event, { data: { type: 'teacher-push-navigation', pending: value }, source: worker });
  serviceWorker.dispatchEvent(event);
}

function reply(value, index = channels.length - 1) {
  channels[index].port1.onmessage({ data: { type: 'teacher-push-navigation', pending: value } });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/#/home');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  channels.length = 0;
  worker = { postMessage: vi.fn() };
  serviceWorker = new window.EventTarget();
  serviceWorker.controller = worker;
  serviceWorker.ready = new Promise((resolve) => { resolveReady = resolve; });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker });
  vi.stubGlobal('MessageChannel', class {
    constructor() {
      this.port1 = { close: vi.fn() };
      this.port2 = { close: vi.fn() };
      channels.push(this);
    }
  });
});

afterEach(() => {
  disconnect?.();
  disconnect = undefined;
  delete navigator.serviceWorker;
  delete document.visibilityState;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('푸시 클릭 목적지 복구', () => {
  it.each([null, 'existing-auth-value'])('cold query를 인증 변경 없이 상세 주소로 한 번만 소비한다 (인증 %s)', (credential) => {
    if (credential) localStorage.setItem('auth_token', credential);
    else localStorage.removeItem('auth_token');
    window.history.replaceState({ retained: true }, '', '/?push_notification=fixture-query');
    expect(normalizePushLaunch()).toBe(true);
    expect(window.location.hash).toBe('#/notifications?id=fixture-query&via=push');
    expect(window.location.search).toBe('');
    expect(window.history.state).toEqual({ retained: true });
    expect(localStorage.getItem('auth_token')).toBe(credential);
    expect(normalizePushLaunch()).toBe(false);
    window.history.replaceState(window.history.state, '', '/#/notifications?via=push');
    expect(normalizePushLaunch()).toBe(false);
    expect(window.location.hash).toBe('#/notifications?via=push');
    localStorage.removeItem('auth_token');
  });

  it('native query만 소비하고 다른 검색 파라미터는 보존한다', () => {
    window.history.replaceState(null, '', '/?view=all&push_notification=fixture-query');
    expect(normalizePushLaunch()).toBe(true);
    expect(window.location.search).toBe('?view=all');
    expect(window.location.hash).toBe('#/notifications?id=fixture-query&via=push');
  });

  it.each([
    '/?push_notification=',
    '/?push_notification=https%3A%2F%2Fevil.example',
    '/?push_notification=%3Cscript%3E',
    '/?push_notification=..%2Fstudent',
    `/?push_notification=${'a'.repeat(129)}`,
    '/?push_notification=first&push_notification=second',
    '/personal/student?push_notification=fixture',
    '/?push_notification=fixture#/personal/student',
    '/?push_notification=fixture#/intro',
  ])('잘못된 native query 또는 학생·공개 경로는 정규화하지 않는다: %s', (url) => {
    window.history.replaceState(null, '', url);
    const before = window.location.href;
    expect(normalizePushLaunch()).toBe(false);
    expect(window.location.href).toBe(before);
  });

  it('시작 메시지를 놓치고 controller가 늦게 생겨도 ready 이후 목적지를 조회하고 적용한다', async () => {
    serviceWorker.controller = null;
    disconnect = connectPushNavigation({ canNavigate: () => true });
    expect(worker.postMessage).not.toHaveBeenCalled();

    resolveReady({ active: worker });
    await Promise.resolve();
    expect(worker.postMessage).toHaveBeenCalledWith(
      { type: 'teacher-push-navigation-request' }, [channels[0].port2],
    );
    const click = pending();
    reply(click);
    expect(window.location.hash).toBe(new URL(click.url).hash);
    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'teacher-push-navigation-ack', clickId: click.clickId });
  });

  it('인증·앱 준비 전에는 클릭을 소비하지 않고, 준비된 새 연결이 남은 클릭을 복구한다', () => {
    const click = pending();
    disconnect = connectPushNavigation({ canNavigate: () => false });
    deliver(click);
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#/home');
    disconnect();

    disconnect = connectPushNavigation({ canNavigate: () => true });
    reply(click);
    expect(window.location.hash).toBe(new URL(click.url).hash);
  });

  it('앱 포커스·화면 복귀·controller 변경 때 새 클릭을 조회한다', () => {
    disconnect = connectPushNavigation({ canNavigate: () => true });
    reply(null);
    window.dispatchEvent(new Event('focus'));
    expect(channels).toHaveLength(2);
    reply(null);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(channels).toHaveLength(3);
    reply(null);
    serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(channels).toHaveLength(4);
    delete document.visibilityState;
  });

  it('강사 공지사항 화면에서도 푸시를 누르면 해당 알림 상세로 이동한다', () => {
    window.history.replaceState(null, '', '/#/notices');
    disconnect = connectPushNavigation({ canNavigate: () => true });
    expect(channels).toHaveLength(1);
    const click = pending();
    reply(click);
    expect(window.location.hash).toBe(new URL(click.url).hash);
    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'teacher-push-navigation-ack', clickId: click.clickId });
  });

  it('확인 응답이 유실돼 동일 클릭이 반복돼도 닫은 팝업을 다시 열지 않는다', () => {
    disconnect = connectPushNavigation({ canNavigate: () => true });
    const click = pending();
    reply(click);
    window.location.hash = '#/notifications';
    deliver(click);
    expect(window.location.hash).toBe('#/notifications');
    expect(worker.postMessage.mock.calls.filter(([data]) => data.type === 'teacher-push-navigation-ack')).toHaveLength(2);

    const clickedAgain = pending({ url: click.url });
    deliver(clickedAgain);
    expect(window.location.hash).toBe(new URL(click.url).hash);
  });

  it.each([
    'https://example.com/#/notifications?id=outside',
    '/personal/student/#/notifications?id=student',
    '/?next=redirect#/notifications?id=query',
    '/#/settings?id=not-notification',
    '/#/notifications?id=',
    '/#/notifications/other?id=invalid',
    'javascript:alert(1)',
  ])('외부 URL이나 알림 상세가 아닌 목적지를 거부한다: %s', (url) => {
    disconnect = connectPushNavigation({ canNavigate: () => true });
    deliver(pending({ url }));
    expect(window.location.hash).toBe('#/home');
    expect(worker.postMessage.mock.calls.some(([data]) => data.type.endsWith('-ack'))).toBe(false);
  });

  it.each(['/personal/student', '/game/tone', '/#/personal/student', '/#/intro', '/#/book/student'])('학생·공개 화면에서 pending을 소비하지 않는다: %s', (url) => {
    window.history.replaceState(null, '', url);
    disconnect = connectPushNavigation({ canNavigate: () => true });
    deliver(pending());
    expect(`${window.location.pathname}${window.location.hash}`).toBe(url);
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it('만료됐거나 미래 시각이 잘못된 클릭을 무시한다', () => {
    disconnect = connectPushNavigation({ canNavigate: () => true });
    deliver(pending({ createdAt: Date.now() - 600001 }));
    deliver(pending({ createdAt: Date.now() + 60001 }));
    deliver(pending({ clickId: '' }));
    expect(window.location.hash).toBe('#/home');
  });

  it('로그아웃으로 인증 범위가 바뀌면 늦게 온 응답도 이동·확인 처리하지 않는다', () => {
    let authenticated = true;
    disconnect = connectPushNavigation({ canNavigate: () => authenticated });
    authenticated = false;
    reply(pending());
    expect(window.location.hash).toBe('#/home');
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
  });

  it('종료 후 ready 응답·포커스 이벤트·늦은 포트 응답을 무시한다', async () => {
    disconnect = connectPushNavigation({ canNavigate: () => true });
    disconnect();
    expect(channels[0].port1.close).toHaveBeenCalled();
    resolveReady({ active: worker });
    await Promise.resolve();
    window.dispatchEvent(new Event('focus'));
    reply(pending());
    expect(window.location.hash).toBe('#/home');
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
  });

  it('응답 없는 포트는 닫고 다음 복귀에 다시 요청한다', () => {
    vi.useFakeTimers();
    disconnect = connectPushNavigation({ canNavigate: () => true });
    window.dispatchEvent(new Event('focus'));
    expect(channels).toHaveLength(1);
    vi.advanceTimersByTime(2500);
    expect(channels[0].port1.close).toHaveBeenCalled();
    window.dispatchEvent(new Event('focus'));
    expect(channels).toHaveLength(2);
  });

  it('첫 조회가 클릭 저장보다 빨라 null이어도 잠깐 재조회하여 새로 저장된 클릭을 복구한다', () => {
    vi.useFakeTimers();
    disconnect = connectPushNavigation({ canNavigate: () => true });
    reply(null);
    vi.advanceTimersByTime(500);
    expect(channels).toHaveLength(2);
    const click = pending();
    reply(click);
    expect(window.location.hash).toBe(new URL(click.url).hash);
    vi.advanceTimersByTime(5000);
    expect(channels).toHaveLength(2);
  });

  it('클릭이 없으면 재조회는 5초 안에 끝나고 이후 포커스 때만 다시 시작한다', () => {
    vi.useFakeTimers();
    worker.postMessage.mockImplementation((data) => {
      if (data.type === 'teacher-push-navigation-request') reply(null);
    });
    disconnect = connectPushNavigation({ canNavigate: () => true });
    vi.advanceTimersByTime(5000);
    expect(channels).toHaveLength(11);
    vi.advanceTimersByTime(5000);
    expect(channels).toHaveLength(11);
    window.dispatchEvent(new Event('focus'));
    expect(channels).toHaveLength(12);
  });

  it.each([0, 100])('새 직접 클릭 이후 지연된 이전 조회 응답은 목적지를 덮어쓰지 않는다 (시차 %i ms)', (difference) => {
    vi.useFakeTimers();
    disconnect = connectPushNavigation({ canNavigate: () => true });
    const older = pending({ createdAt: Date.now() - difference });
    const newer = pending();
    deliver(newer);
    expect(channels[0].port1.close).toHaveBeenCalled();
    reply(older, 0);
    expect(window.location.hash).toBe(new URL(newer.url).hash);
    expect(worker.postMessage.mock.calls.filter(([data]) => data.type.endsWith('-ack'))).toEqual([
      [{ type: 'teacher-push-navigation-ack', clickId: newer.clickId }],
    ]);
  });

  it('뒤늦은 옛 직접 클릭이나 새 조회의 오래된 응답도 최신 목적지를 바꾸지 않는다', () => {
    disconnect = connectPushNavigation({ canNavigate: () => true });
    const older = pending({ createdAt: Date.now() - 100 });
    const newer = pending();
    deliver(newer);
    deliver(older);
    window.dispatchEvent(new Event('focus'));
    reply(older);
    expect(window.location.hash).toBe(new URL(newer.url).hash);
  });

  it('숨겨진 강사 탭은 pending을 조회·소비하지 않고 화면에 돌아온 뒤 복구한다', () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    disconnect = connectPushNavigation({ canNavigate: () => true });
    const click = pending();
    deliver(click);
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#/home');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(channels).toHaveLength(1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    reply(click);
    expect(window.location.hash).toBe('#/home');
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    reply(click);
    expect(window.location.hash).toBe(new URL(click.url).hash);
    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'teacher-push-navigation-ack', clickId: click.clickId });
  });

  it('native 알림 B로 시작하면 이전 pending A를 확인 처리하고 팝업 닫기 뒤에도 다시 열지 않는다', () => {
    vi.useFakeTimers();
    const older = pending({ createdAt: Date.now() - 1000 });
    window.history.replaceState(null, '', '/#/notifications?id=native-start&via=push');
    disconnect = connectPushNavigation({ canNavigate: () => true });
    reply(older);
    expect(window.location.hash).toBe('#/notifications?id=native-start&via=push');
    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'teacher-push-navigation-ack', clickId: older.clickId });

    window.location.hash = '#/notifications?via=push';
    window.dispatchEvent(new Event('focus'));
    reply(older);
    expect(window.location.hash).toBe('#/notifications?via=push');
  });

  it.each(['pull', 'direct'])('native 표식이 남아 있어도 이후에 새로 누른 legacy 알림 C는 처리한다 (%s)', (delivery) => {
    vi.useFakeTimers();
    window.history.replaceState(null, '', `/#/notifications?id=native-before-${delivery}&via=push`);
    disconnect = connectPushNavigation({ canNavigate: () => true });
    reply(pending({ createdAt: Date.now() - 1000 }));
    vi.advanceTimersByTime(100);
    const fresh = pending();
    if (delivery === 'direct') deliver(fresh);
    else {
      window.dispatchEvent(new Event('focus'));
      reply(fresh);
    }
    expect(window.location.hash).toBe(new URL(fresh.url).hash);
    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'teacher-push-navigation-ack', clickId: fresh.clickId });
  });

  it('native 목적지의 첫 관찰 시각은 인증·SW 준비에 따른 재연결에서 바뀌지 않는다', () => {
    vi.useFakeTimers();
    window.history.replaceState(null, '', '/#/notifications?id=native-before-login&via=push');
    disconnect = connectPushNavigation({ canNavigate: () => false });
    vi.advanceTimersByTime(100);
    const fresh = pending();
    vi.advanceTimersByTime(100);
    disconnect();
    disconnect = connectPushNavigation({ canNavigate: () => true });
    reply(fresh);
    expect(window.location.hash).toBe(new URL(fresh.url).hash);
  });

  it('이미 열린 앱의 native hash 이동도 관찰하여 이전 pending이 덮지 못하게 한다', () => {
    vi.useFakeTimers();
    disconnect = connectPushNavigation({ canNavigate: () => true });
    const older = pending();
    reply(null);
    vi.advanceTimersByTime(100);
    window.location.hash = '#/notifications?id=native-warm&via=push';
    window.dispatchEvent(new Event('hashchange'));
    reply(older);
    expect(window.location.hash).toBe('#/notifications?id=native-warm&via=push');
    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'teacher-push-navigation-ack', clickId: older.clickId });
  });
});
