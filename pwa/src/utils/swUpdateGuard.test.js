import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOnFormPage, startGuardedSwUpdate } from './swUpdateGuard.js';
import { hasUnsavedChanges, setUnsavedChanges } from './unsavedChanges.js';

describe('작성 중 서비스워커 자동 업데이트 유예', () => {
  it('공지처럼 경로가 그대로인 화면도 변경 중에만 보호하고 저장·이탈 후 해제한다', () => {
    const notice = Symbol('notice');
    const location = { pathname: '/', hash: '#/notices' };
    expect(isOnFormPage(location)).toBe(false);
    setUnsavedChanges(notice, true);
    expect(hasUnsavedChanges()).toBe(true);
    expect(isOnFormPage(location)).toBe(true);
    setUnsavedChanges(notice, false);
    expect(hasUnsavedChanges()).toBe(false);
    expect(isOnFormPage(location)).toBe(false);
  });
  it.each([
    { pathname: '/personal/homework/hw-1', hash: '' },
    { pathname: '/personal/homework/hw-1/', hash: '#audio' },
    { pathname: '/personal/ABCD1234EFGH/homework/hw-1', hash: '' },
    { pathname: '/personal/ABCD1234EFGH/homework/hw-1/', hash: '#audio' },
    { pathname: '/student/ABCD1234EFGH/homework/hw-1', hash: '' },
    { pathname: '/', hash: '#/personal/ABCD1234EFGH/homework/hw-1' },
    { pathname: '/', hash: '#/personal/ABCD1234EFGH/homework/hw-1?tab=submit' },
    { pathname: '/', hash: '#/logs/log-1/edit' },
    { pathname: '/', hash: '#/classes/new' },
    { pathname: '/', hash: '#/students/student-1/edit' },
    { pathname: '/', hash: '#/payments/payment-1/edit' },
    { pathname: '/', hash: '#/homework/new' },
  ])('학생 숙제 또는 기존 강사 작성 경로 %j는 보호한다', (location) => {
    expect(isOnFormPage(location)).toBe(true);
  });

  it.each([
    { pathname: '/personal/ABCD1234EFGH', hash: '' },
    { pathname: '/', hash: '#/personal/ABCD1234EFGH' },
    { pathname: '/personal/ABCD1234EFGH/notice/notice-1', hash: '' },
    { pathname: '/', hash: '#/logs/log-1' },
    { pathname: '/', hash: '#/home' },
  ])('작성 화면을 이탈한 경로 %j에서는 업데이트를 허용한다', (location) => {
    expect(isOnFormPage(location)).toBe(false);
  });
});

describe('예약된 SW 업데이트와 리로드 보호', () => {
  afterEach(() => vi.useRealTimers());
  it.each(['controller', 'fallback', 'plugin'])('업데이트 시작 후 작성 화면 진입 시 %s 리로드를 이탈까지 유예한다', async trigger => {
    vi.useFakeTimers();
    const serviceWorker = new globalThis.EventTarget();
    let protectedNow = false;
    const reload = vi.fn(), update = vi.fn();
    const controller = startGuardedSwUpdate({ serviceWorker, update, reload, protectedPage: () => protectedNow });
    await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(1);
    protectedNow = true;
    if (trigger === 'controller') serviceWorker.dispatchEvent(new Event('controllerchange'));
    else if (trigger === 'plugin') controller.requestReload();
    else await vi.advanceTimersByTimeAsync(10000);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15000);
    expect(reload).not.toHaveBeenCalled();
    protectedNow = false;
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('보호 중에는 worker 활성화를 시작하지 않고 이탈 후 한 번 실행한다', async () => {
    vi.useFakeTimers();
    let protectedNow = true;
    const update = vi.fn(), reload = vi.fn();
    const controller = startGuardedSwUpdate({ serviceWorker: new globalThis.EventTarget(), update, reload, protectedPage: () => protectedNow });
    await vi.advanceTimersByTimeAsync(20000);
    expect(update).not.toHaveBeenCalled();
    protectedNow = false;
    await vi.advanceTimersByTimeAsync(500);
    expect(update).toHaveBeenCalledTimes(1);
    controller.dispose();
    await vi.advanceTimersByTimeAsync(30000);
    expect(reload).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('effect 정리 후 늦은 controllerchange와 플러그인 콜백은 새로고침하지 않는다', async () => {
    vi.useFakeTimers();
    const serviceWorker = new globalThis.EventTarget(), reload = vi.fn(), update = vi.fn();
    const controller = startGuardedSwUpdate({ serviceWorker, update, reload, protectedPage: () => false });
    controller.dispose();
    await Promise.resolve();
    serviceWorker.dispatchEvent(new Event('controllerchange'));
    controller.requestReload();
    await vi.advanceTimersByTimeAsync(30000);
    expect(reload).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
