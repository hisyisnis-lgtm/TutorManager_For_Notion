const UPDATE_TIMEOUT = 15000;
const UPDATE_ERROR = '업데이트를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.';
let updateInFlight = null;
let reloaded = false;

function bounded(promise, deadline) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(UPDATE_ERROR)), Math.max(0, deadline - Date.now()));
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); reject(new Error(UPDATE_ERROR)); },
    );
  });
}

function waitForActivation(worker, registration, container, deadline) {
  return new Promise((resolve, reject) => {
    let skipSent = false;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeEventListener('statechange', check);
      container.removeEventListener('controllerchange', check);
      if (error) reject(new Error(UPDATE_ERROR));
      else resolve(worker);
    };
    const check = () => {
      if (worker.state === 'activated' && registration.active === worker && container.controller === worker) {
        finish();
        return;
      }
      if (worker.state === 'redundant') { finish(true); return; }
      if (worker.state === 'installed' && !skipSent) {
        skipSent = true;
        try { worker.postMessage({ type: 'SKIP_WAITING' }); } catch { finish(true); }
      }
    };
    const timer = setTimeout(() => finish(true), Math.max(0, deadline - Date.now()));
    worker.addEventListener('statechange', check);
    container.addEventListener('controllerchange', check);
    check();
  });
}

function updateAndReload(checkForUpdate) {
  if (updateInFlight) return updateInFlight;
  if (reloaded) return Promise.resolve();
  const run = async () => {
    const deadline = Date.now() + UPDATE_TIMEOUT;
    const container = navigator.serviceWorker;
    if (!container?.getRegistration) throw new Error(UPDATE_ERROR);
    const registration = await bounded(container.getRegistration(), deadline);
    if (!registration) throw new Error(UPDATE_ERROR);
    if (checkForUpdate) await bounded(registration.update(), deadline);
    const worker = registration.installing || registration.waiting || registration.active || container.controller;
    if (!worker) throw new Error(UPDATE_ERROR);
    await waitForActivation(worker, registration, container, deadline);
    if (Date.now() > deadline || worker.state !== 'activated' || registration.active !== worker || container.controller !== worker) {
      throw new Error(UPDATE_ERROR);
    }
    if (!reloaded) {
      reloaded = true;
      try { window.location.reload(); } catch { reloaded = false; throw new Error(UPDATE_ERROR); }
    }
  };
  updateInFlight = run().catch(() => { throw new Error(UPDATE_ERROR); }).finally(() => {
    if (!reloaded) updateInFlight = null;
  });
  return updateInFlight;
}

// 현재 등록을 보존한다. push 구독·캐시·다른 등록에는 손대지 않는다.
export function requestAppUpdate() { return updateAndReload(true); }

// 플러그인과 수동 업데이트가 동시에 호출해도 같은 활성화 대기와 reload를 공유한다.
export function reloadWhenActivated() { return updateAndReload(false); }
