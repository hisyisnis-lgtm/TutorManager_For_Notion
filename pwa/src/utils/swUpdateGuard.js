import { hasUnsavedChanges } from './unsavedChanges.js';

/** All reload triggers recheck protection, including triggers scheduled before entry. */
export function startGuardedSwUpdate({ update, serviceWorker = globalThis.navigator?.serviceWorker,
  reload = () => window.location.reload(), protectedPage = () => isOnFormPage(), pollMs = 500, fallbackMs = 10000 }) {
  let stopped = false;
  let requested = false;
  let reloadPending = false;
  let fallback;
  let poll;
  function dispose() {
    stopped = true;
    clearInterval(poll);
    clearTimeout(fallback);
    serviceWorker?.removeEventListener('controllerchange', requestReload);
  }
  function tick() {
    if (stopped || protectedPage()) return;
    if (reloadPending) { dispose(); reload(); return; }
    if (requested) return;
    requested = true;
    serviceWorker?.addEventListener('controllerchange', requestReload);
    fallback = setTimeout(requestReload, fallbackMs);
    // Network failures still use the guarded fallback; never reject into the UI.
    Promise.resolve().then(() => {
      if (stopped) return;
      if (protectedPage()) {
        requested = false;
        clearTimeout(fallback);
        serviceWorker?.removeEventListener('controllerchange', requestReload);
        return;
      }
      return update();
    }).catch(() => {});
  }
  function requestReload() {
    if (stopped) return;
    reloadPending = true;
    tick();
  }
  poll = setInterval(tick, pollMs);
  tick();
  return { requestReload, dispose };
}

/** 작성 화면은 이탈할 때까지 SW 교체·리로드를 유예한다. */
export function isOnFormPage(location = window.location) {
  const { pathname = '', hash = '' } = location;
  const teacherForm = /\/(logs|classes|students|payments|homework)\/(new|[^/]+\/edit)/;
  // 숙제 상세 안의 첨부·녹음은 메모리에 있으므로 읽기 상태를 포함해 경로 전체를 보호한다.
  const studentHomework = /^\/(personal|student)\/(?:[^/?#]+\/)?homework\/[^/?#]+(?:[/?#]|$)/;
  return hasUnsavedChanges()
    || teacherForm.test(hash)
    || studentHomework.test(pathname)
    || studentHomework.test(hash.replace(/^#/, ''));
}
