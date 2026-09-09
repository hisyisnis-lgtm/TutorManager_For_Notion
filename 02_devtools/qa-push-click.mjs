// 로컬 production preview + 실제 SW 통합 검수. 모든 외부 API를 합성 fixture로 차단한다.
// 실행: QA_PLAYWRIGHT_PACKAGE=<playwright package> node 02_devtools/qa-push-click.mjs
// iOS/Android의 실제 OS 클릭을 검증하는 도구가 아니라 전달 실패·시작 순서를 재현한다.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { fixtureSession } from '../pwa/src/api/authFixtures.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.QA_PLAYWRIGHT_PACKAGE || 'playwright');
const origin = 'http://localhost:5180';
const output = resolve(dirname(fileURLToPath(import.meta.url)), '../04_docs/qa/push-click-v2.47.4');
const notices = [
  { event: 'message', id: 'qa-click-1', title: '가상 일일리포트',
    message: '[오늘 수업 2건]\n  · 10:00 가상학생 A\n  · 14:00 가상학생 B\n\n[후속 확인]\n전체 내용의 마지막 줄입니다.' },
  { event: 'message', id: 'qa-click-long', title: '가상 긴 리포트',
    message: Array.from({ length: 30 }, (_, i) => `[확인 항목 ${i + 1}]\n가상 상세 내용\n`).join('\n') + '\n전체 본문의 마지막 줄' },
].map((item) => ({ ...item, time: Math.floor(Date.now() / 1000), priority: 4 }));

const browser = await chromium.launch({
  executablePath: process.env.QA_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
  let interceptedWrites = 0;
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (route.request().method() !== 'GET') interceptedWrites += 1;
    if (url.pathname === '/notifications') return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: notices.map((item) => JSON.stringify(item)).join('\n') });
    if (url.pathname === '/auth/login') return route.fulfill({ status: 200, json: { token: fixtureSession() } });
    return route.fulfill({ status: 200, contentType: url.host.includes('fonts') ? 'text/css' : 'application/json', body: url.host.includes('fonts') ? '' : '{"results":[],"has_more":false}' });
  });
  await context.addInitScript(({ origin, token }) => {
    if (location.origin !== origin) return;
    if (!sessionStorage.getItem('qa-logout')) localStorage.setItem('auth_token', token);
    localStorage.setItem('teacher_device', '1');
  }, { origin, token: fixtureSession() });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/#/notifications`);
  await page.getByText(notices[0].title).waitFor();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  const worker = context.serviceWorkers().find((item) => item.url() === `${origin}/sw.js`);
  assert(worker, 'production service worker registered');

  async function simulateClick(mode, id = 'qa-click-1') {
    return worker.evaluate(async ({ mode, id }) => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const originalMatch = self.clients.matchAll;
      const originalOpen = self.clients.openWindow;
      self.clients.matchAll = async () => mode === 'cold' ? [] : windows.map((client) => ({
        url: client.url, focus: async () => client,
        navigate: async () => { throw new Error('simulated startup navigation failure'); },
        postMessage: (data) => client.postMessage(data),
      }));
      self.clients.openWindow = async () => null;
      try {
        let completion;
        const event = new Event('notificationclick');
        Object.defineProperties(event, {
          notification: { value: { close() {}, data: { id } } },
          waitUntil: { value(promise) { completion = promise; } },
        });
        self.dispatchEvent(event);
        await completion;
        return !!await (await caches.open('teacher-push-click-v1')).match('/__teacher-push-click__');
      } finally {
        self.clients.matchAll = originalMatch;
        self.clients.openWindow = originalOpen;
      }
    }, { mode, id });
  }
  const dialog = page.getByRole('dialog');
  const close = () => dialog.getByRole('button', { name: '닫기', exact: true }).last().click();
  async function stableScreenshot(name) {
    await dialog.waitFor();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[role="dialog"]')).opacity === '1');
    await page.screenshot({ path: resolve(output, name), animations: 'disabled' });
  }

  // 앱이 없고 openWindow가 URL을 반영하지 못한 후, root로 새로 열리는 상황.
  await page.goto('about:blank');
  assert(await simulateClick('cold'));
  await page.goto(`${origin}/#/home`);
  await dialog.getByText(/전체 내용의 마지막 줄/).waitFor();
  assert(page.url().includes('id=qa-click-1'));
  await page.waitForFunction(async () => !await (await caches.open('teacher-push-click-v1')).match('/__teacher-push-click__'));
  await mkdir(output, { recursive: true });
  await stableScreenshot('mobile-dialog.png');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await stableScreenshot('desktop-dialog.png');

  // 이미 열린 창 navigate 실패, 같은 알림을 닫고 재클릭.
  await close();
  await dialog.waitFor({ state: 'hidden' });
  await simulateClick('warm');
  await dialog.getByText(/전체 내용의 마지막 줄/).waitFor();
  await close();
  await dialog.waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(output, 'mobile-inbox.png'), animations: 'disabled' });

  // 앱이 먼저 준비되어 빈 응답을 받은 뒤 클릭 기록이 생기는 iOS 시작 순서.
  await page.reload();
  await page.getByText(notices[0].title).waitFor();
  await simulateClick('cold');
  await dialog.getByText(/전체 내용의 마지막 줄/).waitFor({ timeout: 7000 });
  await close();
  await dialog.waitFor({ state: 'hidden' });

  // 긴 본문도 모바일에서 마지막 줄과 닫기 버튼까지 접근할 수 있어야 한다.
  await page.setViewportSize({ width: 320, height: 640 });
  await simulateClick('warm', 'qa-click-long');
  await dialog.getByText(/전체 본문의 마지막 줄/).waitFor();
  await dialog.getByRole('button', { name: '닫기', exact: true }).last().scrollIntoViewIfNeeded();
  await stableScreenshot('mobile-long-bottom.png');
  const layout = await dialog.evaluate((element) => ({
    scrollable: element.scrollHeight > element.clientHeight,
    horizontalOverflow: element.scrollWidth > element.clientWidth,
    height: element.getBoundingClientRect().height, viewportHeight: innerHeight,
  }));
  assert(layout.scrollable && !layout.horizontalOverflow && layout.height <= layout.viewportHeight);

  // 로그인 전에는 클릭을 소비하지 않고 로그인 완료 후 복구한다.
  await page.evaluate(() => { sessionStorage.setItem('qa-logout', '1'); localStorage.removeItem('auth_token'); });
  await page.goto('about:blank');
  assert(await simulateClick('cold'));
  await page.goto(`${origin}/#/home`);
  await page.getByRole('textbox', { name: '비밀번호' }).or(page.locator('input[type="password"]')).first().fill('local-fixture-only');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await dialog.getByText(/전체 내용의 마지막 줄/).waitFor();
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(JSON.stringify({ productionServiceWorker: true, coldStart: true, warmNavigateFailure: true,
    sameNotificationReopen: true, clickPersistedAfterAppReady: true, loginRecovery: true, layout, appErrors: errors.length,
    externalWritesIntercepted: interceptedWrites, output, physicalDeviceTest: false }, null, 2));
} finally {
  await browser.close();
}
