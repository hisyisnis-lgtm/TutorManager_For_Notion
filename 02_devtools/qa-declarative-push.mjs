// Worker의 실제 직렬화 결과 → PWA 2.47.9 호환성을 격리 검수한다.
// OS/APNS/FCM 전달은 합성하지 않는다. 실제 휴대폰 성공과 구분할 것.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { fixtureSession } from '../pwa/src/api/authFixtures.js';
import { serializeWebPushPayload } from '../worker/lib/webPush.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.QA_PLAYWRIGHT_PACKAGE || 'playwright');
const origin = 'http://localhost:5180';
const output = resolve(dirname(fileURLToPath(import.meta.url)), '../04_docs/qa/declarative-push-2026-09-09');
const notices = [
  { id: 'qa-newer', title: '가상 최신 알림', message: '이 알림이 아닌 이전 알림을 눌렀습니다.' },
  { id: 'qa-tapped', title: '가상 일일리포트', message: '[오늘 수업]\n  · 10:00 가상학생 A\n  · 14:00 가상학생 B\n\n[후속 확인]\n누른 리포트 전체 본문의 마지막 줄입니다.' },
].map((item, index) => ({ ...item, event: 'message', time: Math.floor(Date.now() / 1000) - index, priority: 4 }));
const tapped = notices[1];
const serialized = serializeWebPushPayload({ id: tapped.id, time: tapped.time, title: tapped.title,
  body: tapped.message, priority: 4, tags: ['calendar'], url: `/#/notifications?id=${tapped.id}`, tag: `tutor-${tapped.id}` });
const wire = JSON.parse(serialized);
assert.equal(wire.web_push, 8030);
assert.notEqual(wire.mutable, true);
const native = new URL(wire.notification.navigate);
assert.equal(native.origin, 'https://tiantian-chinese.pages.dev');
assert.equal(native.searchParams.get('push_notification'), tapped.id);
const localNative = `${origin}${native.pathname}${native.search}${native.hash}`;

const browser = await chromium.launch({
  executablePath: process.env.QA_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
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
  await page.goto(`${origin}/#/settings`);
  await page.getByRole('button', { name: '알림 진단', exact: true }).waitFor();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  const worker = context.serviceWorkers().find((item) => item.url() === `${origin}/sw.js`);
  assert(worker, 'real production service worker');
  const dialog = page.getByRole('dialog');
  const assertPopup = async () => {
    await dialog.getByText(/누른 리포트 전체 본문의 마지막 줄/).waitFor();
    assert(new URL(page.url()).hash.startsWith(`#/notifications?id=${tapped.id}`));
    assert.equal(await dialog.getByText(notices[0].message).count(), 0, 'not newest notification');
  };
  const close = async () => {
    await dialog.getByRole('button', { name: '닫기', exact: true }).last().click();
    await dialog.waitFor({ state: 'hidden' });
  };

  // 미지원 브라우저(현재 Android 경로)는 기존 SW가 hybrid JSON을 한 번 표시한다.
  const legacyNotification = await worker.evaluate(async (payload) => {
    const originalShow = self.registration.showNotification;
    const shown = [];
    self.registration.showNotification = async (title, options) => { shown.push({ title, ...options }); };
    try {
      let completion;
      const event = new Event('push');
      Object.defineProperties(event, {
        data: { value: { json: () => JSON.parse(payload) } },
        waitUntil: { value(promise) { completion = promise; } },
      });
      self.dispatchEvent(event);
      await completion;
      return shown;
    } finally { self.registration.showNotification = originalShow; }
  }, serialized);
  assert.equal(legacyNotification.length, 1);
  assert.equal(legacyNotification[0].data.id, tapped.id);
  assert.equal(legacyNotification[0].data.url, wire.url);
  assert.equal(legacyNotification[0].title, wire.notification.title);
  assert.equal(legacyNotification[0].body, wire.notification.body);
  assert.equal(await dialog.count(), 0, 'receiving alone must not open popup');

  const clickLegacy = async (cold) => worker.evaluate(async ({ data, cold }) => {
    const originalMatch = self.clients.matchAll;
    const originalOpen = self.clients.openWindow;
    const windows = await originalMatch.call(self.clients, { type: 'window', includeUncontrolled: true });
    self.clients.matchAll = async () => cold ? [] : windows.map((client) => ({
      url: client.url, focus: async () => client,
      navigate: async () => { throw new Error('isolated navigation failure'); },
      postMessage: (message) => client.postMessage(message),
    }));
    self.clients.openWindow = async () => null;
    try {
      let completion;
      const event = new Event('notificationclick');
      Object.defineProperties(event, {
        notification: { value: { close() {}, data } },
        waitUntil: { value(promise) { completion = promise; } },
      });
      self.dispatchEvent(event);
      await completion;
    } finally {
      self.clients.matchAll = originalMatch;
      self.clients.openWindow = originalOpen;
    }
  }, { data: legacyNotification[0].data, cold });
  await clickLegacy(false);
  await assertPopup();
  await close();
  await clickLegacy(false);
  await assertPopup();
  await close();
  await page.goto('about:blank');
  await clickLegacy(true);
  await page.goto(`${origin}/#/home`);
  await assertPopup();
  await close();
  await page.waitForFunction(async () => !await (await caches.open('teacher-push-click-v1')).match('/__teacher-push-click__'));

  // declarative native URL이 실제 앱에 도착한 이후를 검수한다. OS 전달 검증은 아님.
  await page.evaluate((notification) => {
    sessionStorage.setItem('teacher_push_notifications', JSON.stringify([
      { ...notification, title: '잘린 제목…', message: '짧게 받은 푸시 미리보기…' },
    ]));
  }, tapped);
  await page.goto('about:blank');
  await page.goto(localNative);
  await assertPopup();
  assert.equal(await dialog.getByText('짧게 받은 푸시 미리보기…').count(), 0);
  assert(!new URL(page.url()).searchParams.has('push_notification'));
  await close();
  await page.goto(`${origin}/#/settings`);
  await page.getByRole('button', { name: '알림 진단', exact: true }).waitFor();
  // 살아 있는 앱의 주소만 바뀌고 라우터 이벤트 없이 focus로 복귀한 경우.
  await page.evaluate((url) => {
    history.replaceState(history.state, '', url);
    window.dispatchEvent(new Event('focus'));
  }, localNative);
  await assertPopup();
  await mkdir(output, { recursive: true });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[role="dialog"]')).opacity === '1');
  await page.screenshot({ path: resolve(output, 'mobile-exact-report.png'), animations: 'disabled' });
  const layout = await dialog.evaluate((element) => ({
    horizontalOverflow: element.scrollWidth > element.clientWidth,
    bodyWhitespace: getComputedStyle(element.querySelector('.whitespace-pre-wrap')).whiteSpace,
  }));
  assert.equal(layout.horizontalOverflow, false);
  assert.equal(layout.bodyWhitespace, 'pre-wrap');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: resolve(output, 'desktop-exact-report.png'), animations: 'disabled' });
  await close();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  assert.equal(await dialog.count(), 0, 'ordinary resume does not reopen');

  await page.evaluate(() => { sessionStorage.setItem('qa-logout', '1'); localStorage.removeItem('auth_token'); });
  await page.goto(localNative);
  await page.locator('input[type="password"]').fill('local-fixture-only');
  assert.equal(await dialog.count(), 0, 'auth required for full content');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await assertPopup();
  assert.equal(errors.length, 0, errors.join('\n'));
  const result = { appVersion: '2.47.9', actualSerializedPayload: true, legacySingleDisplay: true,
    legacyColdRecovery: true, legacyWarmRecovery: true, sameNotificationReopen: true,
    nativeColdUrl: true, nativeWarmUrlWithoutRouterEvent: true, clickedOlderNotLatest: true,
    receiveWithoutPopup: true, ordinaryResumeWithoutPopup: true, authenticatedFullContent: true,
    cachedPreviewReplacedByFullContent: true,
    layout, appErrors: errors.length, externalWritesIntercepted: interceptedWrites,
    physicalDeviceTest: false, osPushDeliveryTest: false };
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
