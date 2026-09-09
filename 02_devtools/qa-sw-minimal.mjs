// 일회성 경계 검사: 앱과 activation gate 없이 두 정적 client에서 SW 갱신만 비교한다.
// 레포 루트 실행: QA_PLAYWRIGHT_PACKAGE=<설치된 playwright 패키지> node 02_devtools/qa-sw-minimal.mjs
// 기본: minimal/production SW 비교. QA_SKIP_TIMING_AB=1: installed 즉시/waiting 확인 전송 비교.
// QA_USE_ACTUAL_HELPER=1: 원본 requestAppUpdate로 활성화 후 1회 reload 확인.
// QA_BRIDGE_BEFORE_UPDATE=1: 루트 정적 문서에서 원본 push bridge를 5초 사용·해제한 뒤 helper 검사.
// QA_EARLY_BRIDGE_UPDATE=1: SW 등록 전부터 bridge를 연결해 최초 activating 조회와 이후 갱신 비교.
// Chrome 152 로컬에서 기본·타이밍 AB·helper는 통과했다. React App, 폰 푸시 성공을 보증하지 않는다.
// 5182 전용, 외부 DNS/요청 차단, dist는 읽기만 하며 응답에 revision 주석만 붙인다.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.QA_PLAYWRIGHT_PACKAGE || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'pwa/dist');
const origin = 'http://localhost:5182';
let mode = 'minimal';
let revision = 0;
let localRequests = 0;
const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, origin);
    if (url.origin !== origin || request.method !== 'GET') { response.writeHead(403).end(); return; }
    localRequests += 1;
    if (['/', '/__observer__', '/__blank__', '/intro'].includes(url.pathname)) {
      response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      response.end('<!doctype html><title>Inert SW client</title><body>Local SW lifecycle check</body>');
      return;
    }
    let body;
    if (url.pathname === '/__qa_update_helper__.js') {
      body = await readFile(resolve(root, 'pwa/src/api/serviceWorkerUpdate.js'));
    } else if (['/__qa_api__/pushNavigation.js', '/__qa_api__/pushDiagnostics.js'].includes(url.pathname)) {
      body = await readFile(resolve(root, 'pwa/src/api', url.pathname.split('/').at(-1)));
    } else if (mode === 'minimal' && url.pathname === '/sw.js') {
      body = `/* minimal revision ${revision} */
self.addEventListener('install', event => event.waitUntil(Promise.resolve()));
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));`;
    } else {
      const target = resolve(dist, `.${decodeURIComponent(url.pathname)}`);
      if (!target.startsWith(`${dist}${sep}`)) { response.writeHead(403).end(); return; }
      body = await readFile(target);
      if (url.pathname === '/sw.js') body = `${body.toString('utf8')}\n/* isolated revision ${revision} */`;
    }
    response.writeHead(200, { 'Content-Type': mime[extname(url.pathname)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(5182, 'localhost', resolveListen); });
const within = (promise, timeout = 15000) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('bounded local QA timeout')), timeout);
  })]).finally(() => clearTimeout(timer));
};
let browser;
const results = [];
try {
  browser = await chromium.launch({
    executablePath: process.env.QA_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'],
  });
  const modes = process.env.QA_EARLY_BRIDGE_UPDATE === '1' ? ['production-early-bridge-helper']
    : process.env.QA_BRIDGE_BEFORE_UPDATE === '1' ? ['production-bridge-helper']
    : process.env.QA_USE_ACTUAL_HELPER === '1' ? ['production-helper'] : process.env.QA_SKIP_TIMING_AB === '1'
    ? ['production-immediate', 'production-waiting'] : ['minimal', 'production'];
  for (const currentMode of modes) {
    mode = currentMode.startsWith('production') ? 'production' : 'minimal';
    const immediateSkip = currentMode === 'production-immediate';
    const earlyBridge = currentMode === 'production-early-bridge-helper';
    const useBridge = earlyBridge || currentMode === 'production-bridge-helper';
    const useHelper = currentMode.endsWith('helper');
    revision = 0;
    localRequests = 0;
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    let externalBlocked = 0;
    let pageErrors = 0;
    let phase = 'initial';
    const started = Date.now();
    await context.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      externalBlocked += 1;
      return route.abort('blockedbyclient');
    });
    if (useHelper) await context.addInitScript(() => {
      if (!['/', '/intro'].includes(location.pathname)) return;
      const postMessage = ServiceWorker.prototype.postMessage;
      ServiceWorker.prototype.postMessage = function (message, ...args) {
        if (message?.type === 'teacher-push-navigation-request') {
          const snapshots = JSON.parse(sessionStorage.getItem('qa-bridge-worker-states') || '[]');
          snapshots.push({ state: this.state, at: Date.now() });
          sessionStorage.setItem('qa-bridge-worker-states', JSON.stringify(snapshots.slice(-20)));
        }
        if (message?.type === 'SKIP_WAITING') {
          const snapshots = JSON.parse(sessionStorage.getItem('qa-helper-skip') || '[]');
          snapshots.push({ state: this.state, at: Date.now() });
          sessionStorage.setItem('qa-helper-skip', JSON.stringify(snapshots));
        }
        return postMessage.call(this, message, ...args);
      };
      window.addEventListener('beforeunload', () => {
        const states = JSON.parse(sessionStorage.getItem('qa-helper-reloads') || '[]');
        states.push(navigator.serviceWorker.controller?.state || 'none');
        sessionStorage.setItem('qa-helper-reloads', JSON.stringify(states));
      });
    });
    const observer = await context.newPage();
    const page = await context.newPage();
    page.on('pageerror', () => { pageErrors += 1; });
    observer.on('pageerror', () => { pageErrors += 1; });
    try {
      // 두 문서 모두 등록 전에 열어 Workbox navigation fallback이 앱을 실행하지 않게 한다.
      await observer.goto(`${origin}/__observer__`);
      // /intro는 production Workbox navigation denylist에 있어 reload 후에도 빈 문서다.
      await page.goto(`${origin}/${useBridge ? '#/settings' : useHelper ? 'intro' : '__blank__'}`);
      if (earlyBridge) {
        await page.bringToFront();
        await within(page.evaluate(async () => {
          const { connectPushNavigation } = await import('/__qa_api__/pushNavigation.js');
          window.qaStopBridge = connectPushNavigation({ canNavigate: () => true });
        }));
      }
      await within(page.evaluate(async () => {
        window.qaEvents = [];
        window.qaSkipMessages = 0;
        window.qaSkipSnapshots = [];
        window.qaRegistration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
        const posted = new WeakSet();
        window.qaSendSkip = (worker) => {
          if (posted.has(worker)) return;
          posted.add(worker);
          window.qaSkipMessages += 1;
          window.qaSkipSnapshots.push({ workerState: worker.state, waitingExists: Boolean(window.qaRegistration.waiting),
            waitingMatches: window.qaRegistration.waiting === worker, installingMatches: window.qaRegistration.installing === worker,
            activeState: window.qaRegistration.active?.state, at: Date.now() });
          worker.postMessage({ type: 'SKIP_WAITING' });
        };
        const watch = (worker) => {
          if (!worker) return;
          window.qaEvents.push({ kind: 'worker', state: worker.state, at: Date.now() });
          worker.addEventListener('statechange', () => {
            window.qaEvents.push({ kind: 'worker', state: worker.state, at: Date.now() });
            if (worker.state === 'installed' && window.qaImmediateSkip) window.qaSendSkip(worker);
          });
        };
        watch(window.qaRegistration.installing);
        window.qaRegistration.addEventListener('updatefound', () => watch(window.qaRegistration.installing));
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          window.qaEvents.push({ kind: 'controller', state: navigator.serviceWorker.controller?.state, at: Date.now() });
        });
      }));
      await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated', null, { timeout: 15000 });
      await observer.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated', null, { timeout: 15000 });
      await page.evaluate(() => { window.qaOldActive = window.qaRegistration.active; });
      if (useHelper) await observer.evaluate(async () => {
        window.qaRegistration = await navigator.serviceWorker.getRegistration();
        window.qaOldActive = window.qaRegistration.active;
      });
      if (useBridge) {
        phase = 'bridge-before-update';
        await page.bringToFront();
        if (!earlyBridge) await within(page.evaluate(async () => {
          const { connectPushNavigation } = await import('/__qa_api__/pushNavigation.js');
          window.qaStopBridge = connectPushNavigation({ canNavigate: () => true });
        }));
        await page.waitForTimeout(earlyBridge ? 6000 : 5200);
        await page.evaluate(() => {
          window.qaStopBridge();
          const events = JSON.parse(sessionStorage.getItem('teacher_push_diagnostics_v1') || '[]');
          const count = (event) => events.filter((item) => item.event === event).length;
          sessionStorage.setItem('qa-bridge-summary', JSON.stringify({ requests: count('pull-request'),
            empty: count('pull-empty'), pending: count('pull-pending'), timeouts: count('pull-timeout'),
            disposed: count('bridge-dispose'), visible: document.visibilityState,
            workerStates: JSON.parse(sessionStorage.getItem('qa-bridge-worker-states') || '[]') }));
          // bridge를 닫은 뒤 helper 기준 검사와 같은 문서 주소로만 바꾼다. App은 실행하지 않는다.
          history.replaceState(null, '', '/intro');
        });
      }
      phase = 'update';
      revision = 1;
      if (useHelper) {
        phase = 'helper-update';
        const helperNavigation = page.waitForEvent('load', { timeout: 20000 });
        helperNavigation.catch(() => {});
        await within(page.evaluate(async () => {
          const helper = await import('/__qa_update_helper__.js');
          helper.requestAppUpdate().catch(() => { sessionStorage.setItem('qa-helper-failed', '1'); });
        }));
        await helperNavigation;
        await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('qa-helper-reloads') || '[]').length === 1
          && navigator.serviceWorker.controller?.state === 'activated', null, { timeout: 20000 });
        if (await page.title() !== 'Inert SW client') throw new Error('helper reload executed the app');
        phase = 'activated-and-reloaded';
      } else {
      await page.evaluate((value) => { window.qaImmediateSkip = value; }, immediateSkip);
      await within(page.evaluate(() => window.qaRegistration.update()));
      phase = 'skip-waiting';
      if (!immediateSkip) {
        await page.waitForFunction(() => window.qaRegistration.waiting?.state === 'installed', null, { timeout: 15000 });
        await page.evaluate(() => window.qaSendSkip(window.qaRegistration.waiting));
      }
      await page.waitForFunction(() => window.qaRegistration.active !== window.qaOldActive
        && window.qaRegistration.active?.state === 'activated'
        && navigator.serviceWorker.controller === window.qaRegistration.active, null, { timeout: 15000 });
      phase = 'activated';
      }
    } catch (error) {
      phase = `${phase}-failed`;
      console.log(JSON.stringify({ mode: currentMode, failure: error.name, phase }));
    }
    const snapshot = await within((useHelper ? observer : page).evaluate(async () => ({
      sameRegistration: window.qaRegistration === await navigator.serviceWorker.getRegistration(),
      activeState: window.qaRegistration?.active?.state,
      waitingState: window.qaRegistration?.waiting?.state || null,
      installingState: window.qaRegistration?.installing?.state || null,
      controllerState: navigator.serviceWorker.controller?.state,
      oldActiveState: window.qaOldActive?.state,
      replaced: window.qaRegistration?.active !== window.qaOldActive,
      skipMessages: window.qaSkipMessages,
      skipSnapshots: window.qaSkipSnapshots,
      events: window.qaEvents?.slice(-15),
    })), 3000).catch(() => ({ unavailable: true }));
    const helperSnapshot = useHelper ? await within(page.evaluate(() => ({
      helperSourceUnchanged: true,
      reloadStates: JSON.parse(sessionStorage.getItem('qa-helper-reloads') || '[]'),
      helperSkipSnapshots: JSON.parse(sessionStorage.getItem('qa-helper-skip') || '[]'),
      helperFailed: sessionStorage.getItem('qa-helper-failed') === '1',
      bridge: JSON.parse(sessionStorage.getItem('qa-bridge-summary') || 'null'),
    })), 3000).catch(() => ({ helperUnavailable: true })) : {};
    const clientCounts = await Promise.all(context.serviceWorkers().map((worker) =>
      within(worker.evaluate(async () => ({ state: self.serviceWorker?.state,
        clients: (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).length })), 3000)
        .catch(() => ({ unavailable: true }))));
    results.push({ mode: currentMode, phase, durationMs: Date.now() - started, ...snapshot, ...helperSnapshot, clientCounts,
      localRequests, externalBlocked, pageErrors });
    console.log(JSON.stringify(results.at(-1), null, 2));
    await context.close();
  }
  console.log(JSON.stringify({ browser: browser.version(), appExecuted: false, activationGate: false,
    productionSourceChanged: false, actualPush: false, results }, null, 2));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolveClose) => server.close(resolveClose));
}
