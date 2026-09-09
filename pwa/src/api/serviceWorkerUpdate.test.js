import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NativeEventTarget = window.EventTarget;
let worker;
let registration;
let container;
let reload;
let requestAppUpdate;
let reloadWhenActivated;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  worker = new NativeEventTarget();
  worker.state = 'activating';
  worker.postMessage = vi.fn();
  registration = {
    active: worker, waiting: null, installing: null,
    update: vi.fn(async () => registration), unregister: vi.fn(),
    pushManager: { getSubscription: vi.fn(), subscribe: vi.fn() },
  };
  container = Object.assign(new NativeEventTarget(), {
    controller: worker, getRegistration: vi.fn(async () => registration), getRegistrations: vi.fn(),
  });
  reload = vi.fn();
  vi.stubGlobal('window', { location: { reload } });
  vi.stubGlobal('navigator', { serviceWorker: container });
  vi.stubGlobal('caches', { keys: vi.fn(), delete: vi.fn() });
  ({ requestAppUpdate, reloadWhenActivated } = await import('./serviceWorkerUpdate.js'));
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function changeState(state) {
  worker.state = state;
  worker.dispatchEvent(new Event('statechange'));
}

describe('기존 SW 등록을 보존하는 업데이트', () => {
  it('activating 동안에는 새로고침하지 않고 activated가 된 뒤 한 번만 수행한다', async () => {
    const updated = reloadWhenActivated();
    await vi.advanceTimersByTimeAsync(1000);
    expect(reload).not.toHaveBeenCalled();
    changeState('activated');
    await updated;
    expect(reload).toHaveBeenCalledTimes(1);
    expect(registration.update).not.toHaveBeenCalled();
  });

  it('수동 확인으로 설치되는 worker가 waiting을 거쳐 활성화될 때까지 기다린다', async () => {
    worker.state = 'installing';
    registration.active = { state: 'activated' };
    registration.installing = worker;
    const updated = requestAppUpdate();
    await vi.advanceTimersByTimeAsync(0);
    expect(registration.update).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    changeState('installed');
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    changeState('activating');
    expect(reload).not.toHaveBeenCalled();
    registration.active = worker;
    registration.installing = null;
    changeState('activated');
    await updated;
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('새 worker가 activated여도 기존 controller를 제어 중이면 controllerchange까지 기다린다', async () => {
    worker.state = 'installed';
    const oldWorker = { state: 'activated' };
    registration.active = oldWorker;
    registration.waiting = worker;
    container.controller = oldWorker;
    const updated = reloadWhenActivated();
    await vi.advanceTimersByTimeAsync(0);
    registration.active = worker;
    registration.waiting = null;
    changeState('activated');
    await vi.advanceTimersByTimeAsync(1000);
    expect(reload).not.toHaveBeenCalled();
    container.controller = worker;
    container.dispatchEvent(new Event('controllerchange'));
    await updated;
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('controllerchange가 activating 중에 와도 activated 이후에만 reload한다', async () => {
    container.controller = null;
    const updated = reloadWhenActivated();
    await vi.advanceTimersByTimeAsync(0);
    container.controller = worker;
    container.dispatchEvent(new Event('controllerchange'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(reload).not.toHaveBeenCalled();
    changeState('activated');
    await updated;
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('현재 등록의 active가 아닌 worker를 controller로 보더라도 reload하지 않는다', async () => {
    worker.state = 'activated';
    registration.waiting = worker;
    registration.active = { state: 'activated' };
    const failure = expect(reloadWhenActivated()).rejects.toThrow('업데이트를 완료하지 못했습니다.');
    await vi.advanceTimersByTimeAsync(15000);
    await failure;
    expect(reload).not.toHaveBeenCalled();
  });

  it('controller 교체가 끝나지 않으면 제한시간 후 실패하고 늦은 변경도 무시한다', async () => {
    worker.state = 'activated';
    container.controller = { state: 'activated' };
    const failure = expect(reloadWhenActivated()).rejects.toThrow('업데이트를 완료하지 못했습니다.');
    await vi.advanceTimersByTimeAsync(15000);
    await failure;
    container.controller = worker;
    container.dispatchEvent(new Event('controllerchange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).not.toHaveBeenCalled();
  });

  it.each(['manual-first', 'plugin-first'])('플러그인·수동 호출이 겹쳐도 활성화와 reload를 공유한다 (%s)', async (order) => {
    worker.state = 'installed';
    registration.waiting = worker;
    const first = order === 'manual-first' ? requestAppUpdate() : reloadWhenActivated();
    const second = order === 'manual-first' ? reloadWhenActivated() : requestAppUpdate();
    expect(first).toBe(second);
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    changeState('activated');
    await Promise.all([first, second]);
    await requestAppUpdate();
    await reloadWhenActivated();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('현재 등록만 update하며 등록·캐시·구독을 삭제하거나 바꾸지 않는다', async () => {
    worker.state = 'activated';
    await requestAppUpdate();
    expect(container.getRegistration).toHaveBeenCalledTimes(1);
    expect(registration.update).toHaveBeenCalledTimes(1);
    expect(container.getRegistrations).not.toHaveBeenCalled();
    expect(registration.unregister).not.toHaveBeenCalled();
    expect(caches.keys).not.toHaveBeenCalled();
    expect(caches.delete).not.toHaveBeenCalled();
    expect(registration.pushManager.getSubscription).not.toHaveBeenCalled();
    expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('활성화가 멈추면 15초 내 실패하고 늦은 statechange로 reload하지 않는다', async () => {
    const failure = expect(reloadWhenActivated()).rejects.toThrow('업데이트를 완료하지 못했습니다.');
    await vi.advanceTimersByTimeAsync(15000);
    await failure;
    changeState('activated');
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).not.toHaveBeenCalled();
    await requestAppUpdate();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('getRegistration이 멈춰도 제한시간 후 끝내고 늦은 응답을 무시한다', async () => {
    let respond;
    container.getRegistration.mockReturnValue(new Promise((resolve) => { respond = resolve; }));
    const failure = expect(requestAppUpdate()).rejects.toThrow('업데이트를 완료하지 못했습니다.');
    await vi.advanceTimersByTimeAsync(15000);
    await failure;
    worker.state = 'activated';
    respond(registration);
    await vi.advanceTimersByTimeAsync(0);
    expect(registration.update).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('update 요청이 멈춰도 실패하고 이후 설치 완료로 reload하지 않는다', async () => {
    let respond;
    registration.update.mockReturnValue(new Promise((resolve) => { respond = resolve; }));
    const failure = expect(requestAppUpdate()).rejects.toThrow('업데이트를 완료하지 못했습니다.');
    await vi.advanceTimersByTimeAsync(15000);
    await failure;
    worker.state = 'activated';
    respond(registration);
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).not.toHaveBeenCalled();
  });

  it('update 실패 이유의 상세 문자열을 노출하지 않고 재시도할 수 있다', async () => {
    registration.update.mockRejectedValueOnce(new Error('private internal details'));
    await expect(requestAppUpdate()).rejects.toThrow('업데이트를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    expect(reload).not.toHaveBeenCalled();
    worker.state = 'activated';
    await requestAppUpdate();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('설치 worker가 redundant로 끝나면 이전 앱을 억지로 reload하지 않는다', async () => {
    const failure = expect(reloadWhenActivated()).rejects.toThrow('업데이트를 완료하지 못했습니다.');
    await vi.advanceTimersByTimeAsync(0);
    changeState('redundant');
    await failure;
    expect(reload).not.toHaveBeenCalled();
  });

  it('SW 미지원·등록 없음도 무한 대기 없이 실패한다', async () => {
    vi.stubGlobal('navigator', {});
    await expect(requestAppUpdate()).rejects.toThrow('업데이트를 완료하지 못했습니다.');
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => undefined } });
    await expect(requestAppUpdate()).rejects.toThrow('업데이트를 완료하지 못했습니다.');
    expect(reload).not.toHaveBeenCalled();
  });
});
