// dist의 실제 Workbox SW를 사용한 로컬 lifecycle 검수. 빌드 완료 후 레포 루트에서 실행한다.
// 실행: QA_PLAYWRIGHT_PACKAGE=<playwright package> node 02_devtools/qa-service-worker-update.mjs
// sw.js의 revision 주석/선택 activate 게이트로 비교하며 실제 푸시·운영 쓰기는 하지 않는다.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { fixtureSession } from '../pwa/src/api/authFixtures.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.QA_PLAYWRIGHT_PACKAGE || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distChoice = 'pwa/dist';
const dist = resolve(root, distChoice);
const output = resolve(root, '04_docs/qa/push-click-v2.47.8');
const origin = 'http://localhost:5181';
const timeoutCase = process.env.QA_UPDATE_TIMEOUT_CASE === '1';
const activationGate = timeoutCase || process.env.QA_ACTIVATION_GATE === '1';
const sameVersionCase = process.env.QA_SAME_VERSION_CASE === '1';
const disableRouting = process.env.QA_DISABLE_ROUTING === '1';
const forceNoImportCache = process.env.QA_UPDATE_VIA_CACHE_NONE === '1';
const autoUpdateCase = process.env.QA_AUTO_UPDATE_CASE === '1';
const bareAppCase = autoUpdateCase || process.env.QA_BARE_APP_CASE === '1';
assert(!sameVersionCase || !activationGate, 'same-version check cannot use a new-worker activation gate');
assert(!bareAppCase || (!sameVersionCase && !activationGate), 'bare App comparison uses an ungated new revision');
const pushScript = await readFile(resolve(dist, 'push-sw.js'), 'utf8');
assert(pushScript.includes("DIAGNOSTIC_VERSION = '2.47.8'"), 'v2.47.8 production build must exist before QA');
const clickCache = 'teacher-push-click-v1';
const clickKey = '/__teacher-push-click__';
const diagnosticCache = 'teacher-push-diagnostics-v1';
const diagnosticKey = '/__teacher-push-diagnostics__';
const notice = {
  event: 'message', id: 'qa-update-preserved', title: '갱신 보존 가상 리포트',
  message: '가상 알림입니다.\n업데이트 후에도 클릭 내용이 복구되었습니다.',
  time: Math.floor(Date.now() / 1000), priority: 3,
};
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
let revision = 0;
let releaseActivation;
let signalActivation;
let localApiRequests = 0;
let localApiWrites = 0;
const lifecycleRequests = [];
const noteRequest = (kind, stage) => {
  lifecycleRequests.push({ kind, stage, at: Date.now() });
  if (lifecycleRequests.length > 24) lifecycleRequests.shift();
};
const activationStarted = new Promise((resolveGate) => { signalActivation = resolveGate; });
const activationReleased = new Promise((resolveGate) => { releaseActivation = resolveGate; });
const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, origin);
    if (requestUrl.origin !== origin) {
      response.writeHead(403).end('external network disabled in isolated QA');
      return;
    }
    const path = decodeURIComponent(requestUrl.pathname);
    if (path.startsWith('/__qa_api__/')) {
      localApiRequests += 1;
      if (request.method !== 'GET') localApiWrites += 1;
      const endpoint = path.slice('/__qa_api__'.length);
      response.writeHead(200, { 'Content-Type': endpoint === '/notifications' ? 'application/x-ndjson' : 'application/json', 'Cache-Control': 'no-store' });
      response.end(endpoint === '/notifications' ? JSON.stringify(notice) : JSON.stringify(
        endpoint === '/push/config' ? { configured: false } : { results: [], has_more: false }));
      return;
    }
    if (path === '/__qa_activate_gate__') {
      noteRequest('activation-gate', 'start');
      signalActivation();
      await activationReleased;
      noteRequest('activation-gate', 'released');
      response.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      response.end('activation gate released');
      return;
    }
    if (path === '/__qa_observer__') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end('<!doctype html><html lang="ko"><title>격리 SW 관찰</title><body>격리 검수 관찰창</body></html>');
      return;
    }
    let target = resolve(dist, `.${path === '/' ? '/index.html' : path}`);
    if (!target.startsWith(`${dist}${sep}`)) { response.writeHead(403).end(); return; }
    let body;
    try { body = await readFile(target); } catch {
      if (extname(path)) { response.writeHead(404).end(); return; }
      target = resolve(dist, 'index.html');
      body = await readFile(target);
    }
    if (extname(target) === '.js') {
      // 운영 파일은 건드리지 않고 응답의 API base만 격리 fixture로 바꾼다.
      // 갱신 검수에는 production Workbox lifecycle을 유지한다.
      body = body.toString('utf8').replaceAll('https://tutor-manager-proxy.hisyisnis.workers.dev', `${origin}/__qa_api__`);
    }
    if (path === '/sw.js') {
      noteRequest('sw-script', `revision-${revision}`);
      body = `${body.toString('utf8')}\n/* isolated QA revision ${revision} */\n${revision && activationGate ?
        "self.addEventListener('activate', event => event.waitUntil(fetch('/__qa_activate_gate__', { cache: 'no-store' }).then(response => { if (!response.ok) throw new Error('QA gate failed'); })));" : ''}`;
    }
    response.writeHead(200, { 'Content-Type': mime[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(500).end('local QA server failure');
  }
});
await new Promise((resolveListen, reject) => {
  server.once('error', reject);
  server.listen(5181, 'localhost', resolveListen);
});
let browser;
let context;
let page;
let observer;
let phase = 'browser-start';
const errors = [];
const pendingRequests = new Map();
let externalApiAttempts = 0;
const within = (promise, timeout = 3000) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('QA diagnostic timeout')), timeout);
  })]).finally(() => clearTimeout(timer));
};
try {
  browser = await chromium.launch({
    executablePath: process.env.QA_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    // 외부 폰트 등은 fixture route로 차단하며 놓친 외부 hostname도 DNS 연결을 막는다.
    args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'],
  });
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
  context.on('request', (request) => {
    const url = new URL(request.url());
    const kind = url.origin !== origin ? 'external' : request.isNavigationRequest() ? 'document'
      : url.pathname.startsWith('/__qa_api__/') ? 'local-api' : url.pathname === '/sw.js' ? 'sw-script' : 'local-asset';
    pendingRequests.set(request, kind);
    if (url.hostname.endsWith('.workers.dev')) externalApiAttempts += 1;
  });
  context.on('requestfinished', (request) => pendingRequests.delete(request));
  context.on('requestfailed', (request) => pendingRequests.delete(request));
  let interceptedWrites = 0;
  let serviceWorkerExternalIntercepts = 0;
  if (!disableRouting) await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (route.request().serviceWorker()) serviceWorkerExternalIntercepts += 1;
    if (route.request().method() !== 'GET') interceptedWrites += 1;
    if (url.pathname === '/notifications') return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: JSON.stringify(notice) });
    if (url.pathname === '/push/config') return route.fulfill({ status: 200, json: { configured: false } });
    return route.fulfill({ status: 200, contentType: url.host.includes('fonts') ? 'text/css' : 'application/json', body: url.host.includes('fonts') ? '' : '{"results":[],"has_more":false}' });
  });
  await context.addInitScript(({ origin, token, clickCache, diagnosticCache, forceNoImportCache, bareAppCase }) => {
    if (location.origin !== origin) return;
    if (forceNoImportCache) {
      const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
      navigator.serviceWorker.register = (script, options) => register(script, { ...options, updateViaCache: 'none' });
    }
    if (location.pathname === '/') {
      localStorage.setItem('auth_token', token);
      localStorage.setItem('teacher_device', '1');
    }
    if (bareAppCase) return;
    const unregister = ServiceWorkerRegistration.prototype.unregister;
    ServiceWorkerRegistration.prototype.unregister = function (...args) {
      localStorage.setItem('qa-unregister-count', String(Number(localStorage.getItem('qa-unregister-count')) + 1));
      return unregister.apply(this, args);
    };
    const postMessage = ServiceWorker.prototype.postMessage;
    ServiceWorker.prototype.postMessage = function (message, ...args) {
      if (message?.type === 'SKIP_WAITING') {
        const messages = JSON.parse(localStorage.getItem('qa-update-messages') || '[]');
        messages.push({ kind: 'skip-waiting', state: this.state, at: Date.now() });
        localStorage.setItem('qa-update-messages', JSON.stringify(messages.slice(-8)));
      }
      return postMessage.call(this, message, ...args);
    };
    const deleteCache = CacheStorage.prototype.delete;
    CacheStorage.prototype.delete = function (name) {
      if ([clickCache, diagnosticCache].includes(name)) localStorage.setItem('qa-protected-cache-deleted', '1');
      return deleteCache.call(this, name);
    };
    window.addEventListener('beforeunload', () => {
      if (localStorage.getItem('qa-observe-reload') !== '1') return;
      const states = JSON.parse(localStorage.getItem('qa-reload-states') || '[]');
      states.push(navigator.serviceWorker.controller?.state || 'none');
      localStorage.setItem('qa-reload-states', JSON.stringify(states));
    });
  }, { origin, token: fixtureSession(), clickCache, diagnosticCache, forceNoImportCache, bareAppCase });
  // SW 등록 전에 같은 origin의 정적 관찰 문서를 열어 둔다.
  // 등록 후 열면 Workbox navigateFallback이 앱HTML을 반환해 두 번째 App이 갱신에 개입한다.
  if (!bareAppCase) {
    observer = await context.newPage();
    await observer.goto(`${origin}/__qa_observer__`);
    assert.equal(await observer.title(), '격리 SW 관찰', 'observer is an inert document, not the PWA fallback');
  }
  page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (request.isNavigationRequest()) noteRequest('main-navigation', 'requested'); });
  page.on('requestfinished', (request) => { if (request.isNavigationRequest()) noteRequest('main-navigation', 'finished'); });
  phase = 'initial-settings';
  await page.goto(`${origin}/#/settings`);
  const updateButton = page.getByRole('button', { name: /^(?:앱 )?업데이트(?:\s|$)/ });
  await updateButton.waitFor();
  await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated');
  if (bareAppCase) {
    phase = autoUpdateCase ? 'automatic-app-update' : 'bare-app-update';
    await page.waitForTimeout(6000);
    await page.evaluate(() => { window.qaOriginalActive = navigator.serviceWorker.controller; });
    const oldWorkers = new Set(context.serviceWorkers());
    let documentLoads = 0;
    page.on('load', () => { documentLoads += 1; });
    revision = 1;
    // load 감시는 trigger 전에 시작해 빠른 정상 재시작도 놓치지 않는다.
    const documentLoaded = page.waitForEvent('load', { timeout: 22000 });
    // trigger 도중 reject될 수 있으므로 즉시 handler를 붙이고 아래에서 원래 결과를 검사한다.
    documentLoaded?.catch(() => {});
    if (autoUpdateCase) {
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        if (!registration) throw new Error('QA registration unavailable');
        // 앱의 주기적 update()와 같은 호출. Settings/helper를 직접 호출하지 않는다.
        void registration.update().catch(() => { window.qaUpdateRequestFailed = true; });
      });
    } else {
      await updateButton.click({ noWaitAfter: true });
    }
    await Promise.all([
      documentLoaded,
      page.waitForFunction(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return registration?.active !== window.qaOriginalActive && registration?.active?.state === 'activated'
          && navigator.serviceWorker.controller === registration.active;
      }, null, { timeout: 20000 }),
    ]);
    await updateButton.waitFor();
    assert.equal(documentLoads, 1);
    const newWorkers = context.serviceWorkers().filter((worker) => !oldWorkers.has(worker));
    assert(newWorkers.length > 0, 'a new production worker was created');
    assert((await Promise.all(newWorkers.map((worker) => worker.evaluate(() => self.serviceWorker.state)))).includes('activated'));
    assert.equal(externalApiAttempts, 0);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(JSON.stringify({ bareAppCase: true, distChoice, autoUpdateCase, productionServiceWorker: true,
      observer: false, qaInstrumentationWrappers: false, registrationCacheOverride: forceNoImportCache,
      cacheSeed: false, newWorkerActivated: true,
      documentLoads, externalApiAttempts, localApiRequests, localApiWrites, appErrors: errors.length,
      physicalDeviceTest: false }, null, 2));
  } else {
  await page.bringToFront();
  // 복귀 재조회가 끝난 후 기록을 심는다. 새 문서의 정상 ACK 소비와 구별하기 위함이다.
  await page.waitForTimeout(6000);
  const before = await observer.evaluate(async ({ clickCache, clickKey, diagnosticCache, diagnosticKey, id, timeoutCase }) => {
    window.qaRegistration = await navigator.serviceWorker.getRegistration();
    window.qaOriginalActive = window.qaRegistration.active;
    const pending = JSON.stringify({ url: `${location.origin}/#/notifications?id=${id}`, clickId: crypto.randomUUID(), createdAt: Date.now() });
    const diagnostics = JSON.stringify([{ event: 'push-shown', at: Date.now(), targetKind: 'query', hasId: true }]);
    if (!timeoutCase) await (await caches.open(clickCache)).put(clickKey, new Response(pending));
    await (await caches.open(diagnosticCache)).put(diagnosticKey, new Response(diagnostics));
    localStorage.setItem('qa-unregister-count', '0');
    localStorage.removeItem('qa-protected-cache-deleted');
    localStorage.setItem('qa-reload-states', '[]');
    localStorage.setItem('qa-observe-reload', '1');
    return { pending, diagnostics, hasSubscription: Boolean(await window.qaRegistration.pushManager.getSubscription()) };
  }, { clickCache, clickKey, diagnosticCache, diagnosticKey, id: notice.id, timeoutCase });
  // 최초 설치가 아닌 동일 registration의 실제 갱신을 Settings 버튼에서 시작한다.
  revision = sameVersionCase ? 0 : 1;
  phase = 'settings-update';
  await updateButton.click({ noWaitAfter: true });
  if (activationGate) {
  let gateTimeout;
  await Promise.race([activationStarted, new Promise((_, reject) => {
    gateTimeout = setTimeout(() => reject(new Error('Settings update did not start the real SW activation')), 20000);
  })]).finally(() => clearTimeout(gateTimeout));
  await observer.waitForTimeout(600);
  const during = await observer.evaluate(async ({ clickCache, clickKey, diagnosticCache, diagnosticKey }) => ({
    sameRegistration: await navigator.serviceWorker.getRegistration() === window.qaRegistration,
    activeState: window.qaRegistration.active?.state,
    updateViaCache: window.qaRegistration.updateViaCache,
    oldActiveState: window.qaOriginalActive.state,
    reloadStates: JSON.parse(localStorage.getItem('qa-reload-states') || '[]'),
    pending: await (await (await caches.open(clickCache)).match(clickKey))?.text(),
    diagnostics: await (await (await caches.open(diagnosticCache)).match(diagnosticKey))?.text(),
  }), { clickCache, clickKey, diagnosticCache, diagnosticKey });
  assert(during.sameRegistration, 'update preserves the original registration object');
  assert.equal(during.activeState, 'activating', 'real activation gate is holding the new worker');
  assert.equal(during.oldActiveState, 'redundant', 'new SW replaced the previously active worker');
  assert.deepEqual(during.reloadStates, [], 'no reload before SW activation completes');
  assert.equal(during.pending, timeoutCase ? undefined : before.pending, 'pending click remains intact during update');
  assert.equal(during.diagnostics, before.diagnostics, 'diagnostic cache remains intact during update');
  if (timeoutCase) {
    phase = 'timeout-recovery';
    // 별도 선택 검사: 게이트를 helper의 15초 deadline보다 오래 유지해 영구 splash를 검출한다.
    // 클릭 기록은 아래 재시도 직전에 심어 timeout 후 정상 브리지 소비와 혼동하지 않는다.
    await page.waitForTimeout(16000);
    await updateButton.waitFor({ state: 'visible', timeout: 5000 });
    assert(await updateButton.isEnabled(), 'timeout restores usable Settings instead of an endless splash');
    assert.deepEqual(await observer.evaluate(() => JSON.parse(localStorage.getItem('qa-reload-states') || '[]')), []);
    await mkdir(output, { recursive: true });
    await updateButton.scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, 'mobile-update-timeout-recovery.png'), animations: 'disabled' });
    phase = 'timeout-gate-release';
    releaseActivation();
    await observer.waitForFunction(() => window.qaRegistration.active?.state === 'activated');
    await page.waitForTimeout(6000);
    await observer.evaluate(async ({ clickCache, clickKey, pending }) => {
      await (await caches.open(clickCache)).put(clickKey, new Response(pending));
    }, { clickCache, clickKey, pending: before.pending });
    await updateButton.click({ noWaitAfter: true });
  }
  releaseActivation();
  }
  phase = 'post-update-popup';
  const dialog = page.getByRole('dialog');
  await dialog.getByText(/업데이트 후에도 클릭 내용이 복구되었습니다/).waitFor({ timeout: 20000 });
  await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated');
  const after = await observer.evaluate(async ({ diagnosticCache, diagnosticKey }) => ({
    sameRegistration: await navigator.serviceWorker.getRegistration() === window.qaRegistration,
    activeState: window.qaRegistration.active?.state,
    updateViaCache: window.qaRegistration.updateViaCache,
    reloadStates: JSON.parse(localStorage.getItem('qa-reload-states') || '[]'),
    unregisterCalls: Number(localStorage.getItem('qa-unregister-count')),
    protectedCacheDeleted: localStorage.getItem('qa-protected-cache-deleted') === '1',
    hasSubscription: Boolean(await window.qaRegistration.pushManager.getSubscription()),
    diagnostics: await (await (await caches.open(diagnosticCache)).match(diagnosticKey))?.text(),
  }), { diagnosticCache, diagnosticKey });
  assert(after.sameRegistration);
  assert.equal(after.activeState, 'activated');
  assert.deepEqual(after.reloadStates, ['activated'], 'one reload, only after activation');
  assert.equal(after.unregisterCalls, 0);
  assert.equal(after.protectedCacheDeleted, false);
  assert.equal(after.hasSubscription, before.hasSubscription);
  assert.equal(after.diagnostics, before.diagnostics);
  await page.waitForFunction(async ({ clickCache, clickKey }) => !await (await caches.open(clickCache)).match(clickKey), { clickCache, clickKey });
  await observer.evaluate(() => localStorage.setItem('qa-observe-reload', '0'));
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: resolve(output, 'mobile-after-safe-update.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: '닫기', exact: true }).last().click();
  await dialog.waitFor({ state: 'hidden' });
  await page.goto(`${origin}/#/settings`);
  await updateButton.waitFor();
  await updateButton.scrollIntoViewIfNeeded();
  await page.getByText('알림 연결과 저장된 정보를 유지하면서 최신 버전을 확인해요.', { exact: true }).waitFor();
  await page.screenshot({ path: resolve(output, 'mobile-settings-safe-update.png'), animations: 'disabled' });
  await page.close();
  // 공통 App bootstrap을 사용하는 익명 학생 공개 경로도 새 활성 SW 아래에서 부팅한다.
  await observer.evaluate(() => { localStorage.removeItem('auth_token'); localStorage.removeItem('personal_student_token'); });
  const student = await context.newPage();
  phase = 'student-bootstrap';
  student.on('pageerror', (error) => errors.push(error.message));
  await student.goto(`${origin}/personal`);
  await student.getByRole('heading', { name: '학생 페이지', exact: true }).waitFor();
  await student.getByRole('textbox', { name: '학생 코드', exact: true }).waitFor();
  assert.equal(new URL(student.url()).pathname, '/personal');
  assert.equal(await student.evaluate(() => navigator.serviceWorker.controller?.state), 'activated');
  await student.screenshot({ path: resolve(output, 'mobile-student-after-update.png'), animations: 'disabled' });
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(externalApiAttempts, 0, 'API requests stay on the local fixture origin');
  console.log(JSON.stringify({ productionServiceWorker: true, testOnlyActivationGate: activationGate,
    playwrightRoutingDisabled: disableRouting, updateViaCache: after.updateViaCache, externalApiAttempts,
    settingsCheckedCurrentVersion: true, newWorkerRevisionRequested: !sameVersionCase,
    timeoutRestoresSettings: timeoutCase ? true : null,
    registrationPreserved: true, diagnosticCachePreserved: true,
    pendingClickRecoveredAfterReload: true, noReloadWhileActivating: activationGate ? true : null, reloadOnceAfterActivated: true,
    unregisterCalls: after.unregisterCalls, subscriptionPresenceUnchanged: true,
    actualPushSubscriptionCreated: false, studentPublicBootstrap: true, appErrors: errors.length,
    externalWritesIntercepted: interceptedWrites, serviceWorkerExternalIntercepts, localApiRequests, localApiWrites,
    output, physicalDeviceTest: false }, null, 2));
  }
} catch (error) {
  await mkdir(output, { recursive: true });
  const diagnostics = { phase, distChoice, autoUpdateCase, timeoutCase, sameVersionCase, disableRouting, forceNoImportCache, bareAppCase, failureType: error.name,
    lifecycleRequests, localApiRequests, localApiWrites, externalApiAttempts,
    pendingRequestKinds: [...pendingRequests.values()],
  };
  if (observer) diagnostics.registration = await within(observer.evaluate(async ({ clickCache, clickKey, diagnosticCache, diagnosticKey }) => {
    const registration = await navigator.serviceWorker.getRegistration();
    return {
      sameRegistration: registration === window.qaRegistration,
      activeState: registration?.active?.state, waitingState: registration?.waiting?.state,
      updateViaCache: registration?.updateViaCache,
      installingState: registration?.installing?.state, oldActiveState: window.qaOriginalActive?.state,
      reloadStates: JSON.parse(localStorage.getItem('qa-reload-states') || '[]'),
      updateMessages: JSON.parse(localStorage.getItem('qa-update-messages') || '[]'),
      unregisterCalls: Number(localStorage.getItem('qa-unregister-count')),
      pendingPresent: Boolean(await (await caches.open(clickCache)).match(clickKey)),
      diagnosticPresent: Boolean(await (await caches.open(diagnosticCache)).match(diagnosticKey)),
    };
  }, { clickCache, clickKey, diagnosticCache, diagnosticKey })).catch(() => ({ unavailable: true }));
  if (page) {
    diagnostics.app = await within(page.evaluate(async () => {
      let events = [];
      try { events = JSON.parse(sessionStorage.getItem('teacher_push_diagnostics_v1') || '[]'); } catch {}
      const registration = await navigator.serviceWorker.getRegistration();
      return {
        route: ['#/settings', '#/notifications', '#/home'].find((prefix) => location.hash.startsWith(prefix)) || 'other',
        hasNativeQuery: new URL(location.href).searchParams.has('push_notification'),
        hasNotificationId: /[?&]id=/.test(location.hash),
        controllerState: navigator.serviceWorker.controller?.state,
        activeState: registration?.active?.state, waitingState: registration?.waiting?.state,
        oldActiveState: window.qaOriginalActive?.state,
        visible: document.visibilityState, readyState: document.readyState,
        events: events.slice(-12).map(({ event, at, reason }) => ({ event, at, reason })),
      };
    })).catch(() => ({ unavailable: true }));
    await page.screenshot({ path: resolve(output, `lifecycle-failure-${timeoutCase ? 'timeout' : 'normal'}.png`), timeout: 4000 }).catch(() => {});
  }
  diagnostics.workers = await Promise.all((context?.serviceWorkers() || []).map((worker) =>
    within(worker.evaluate(() => ({ executionState: self.serviceWorker?.state,
      pushHandlerLoaded: typeof self.notificationPreview === 'function', workboxLoaderPresent: typeof self.define === 'function',
    }))).catch(() => ({ unavailable: true }))));
  if (process.env.QA_DIRECT_SKIP_PROBE === '1') {
    // 실패 원인 분리용일 뿐 정상 UI 검수를 통과시키는 경로로 사용하지 않는다.
    for (const worker of context?.serviceWorkers() || []) {
      await within(worker.evaluate(async () => {
        if (self.serviceWorker?.state === 'installed') await self.skipWaiting();
      })).catch(() => {});
    }
    await new Promise((resolveProbe) => setTimeout(resolveProbe, 700));
    diagnostics.directSkipProbe = await within(observer.evaluate(() => ({
      activeState: window.qaRegistration.active?.state, waitingState: window.qaRegistration.waiting?.state,
    }))).catch(() => ({ unavailable: true }));
  }
  diagnostics.appErrorCount = errors.length;
  console.error(JSON.stringify({ isolatedQaFailure: diagnostics }, null, 2));
  throw error;
} finally {
  releaseActivation();
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolveClose) => server.close(resolveClose));
}
