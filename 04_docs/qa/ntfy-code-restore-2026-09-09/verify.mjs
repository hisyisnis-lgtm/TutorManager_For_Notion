// 격리된 로컬 빌드 QA. 운영 API·ntfy 요청은 모두 fixture로 대체하며 실제 알림은 발송하지 않는다.
import { chromium } from 'file:///C:/Users/hisyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { fixtureSession } from '../../../pwa/src/api/authFixtures.js';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.dirname(fileURLToPath(import.meta.url));
const origin = 'http://127.0.0.1:5180';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const errors = [];
const calls = [];
context.on('page', (p) => p.on('pageerror', (error) => errors.push(error.message)));
await context.route('**/*', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin === origin) return route.continue();
  if (url.hostname === 'ntfy.sh') {
    assert.equal(request.headers().authorization, undefined);
    calls.push({ path: url.pathname, query: url.search });
    const id = url.pathname.includes('fixture-topic') ? 'history' : 'new-topic';
    return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: JSON.stringify({
      event: 'message', id, time: Math.floor(Date.now() / 1000), title: '일일리포트 · 검수용 가상 데이터',
      message: id === 'history' ? '오늘 수업 안내\n\n09:00 가상 학생 A · 온라인 수업\n10:30 가상 학생 B · 복습 수업\n\n이 내용은 실제 발송하지 않은 검수용 데이터입니다.\n긴문자열: ' + 'A'.repeat(180) : '변경한 토픽의 가상 알림',
    }) + '\n' });
  }
  if (url.pathname === '/auth/login') return route.fulfill({ json: { token: fixtureSession() } });
  if (url.hostname.endsWith('workers.dev')) return route.fulfill({ json: { results: [], students: [], classes: [], payments: [] } });
  return route.fulfill({ status: 200, body: '', contentType: request.resourceType() === 'stylesheet' ? 'text/css' : 'text/plain' });
});
await context.addInitScript(() => {
  const original = window.fetch.bind(window);
  window.fetch = async (url, options) => {
    if (String(url).startsWith('https://ntfy.sh/') && String(url).endsWith('/sse')) {
      if (options?.headers?.Authorization || options?.credentials !== 'omit') throw new Error('외부 인증정보 전송');
      return new Response(new ReadableStream({ start(source) {
        window.sendFixtureNtfy = (msg) => source.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(msg)}\n\n`));
        options.signal.addEventListener('abort', () => source.error(new DOMException('Aborted', 'AbortError')), { once: true });
      } }), { headers: { 'Content-Type': 'text/event-stream' } });
    }
    return original(url, options);
  };
});
const page = await context.newPage();
try {
  await page.goto(`${origin}/#/settings`);
  await page.getByLabel('비밀번호').fill('fixture-only-not-a-real-password');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForFunction(() => Boolean(localStorage.getItem('auth_token')));
  await page.goto(`${origin}/#/settings`);
  const input = page.getByRole('textbox', { name: 'ntfy 알림 코드' });
  await input.fill('잘못된 코드');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await input.getAttribute('aria-invalid'), 'true');
  await page.screenshot({ path: path.join(out, 'mobile-settings-error.png'), fullPage: true });
  await input.fill('fixture-topic');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.reload();
  await input.waitFor();
  assert.equal(await input.inputValue(), 'fixture-topic');
  await page.screenshot({ path: path.join(out, 'mobile-settings.png'), fullPage: true });
  await page.getByRole('link', { name: '알림함 보기' }).click();
  await page.getByText('ntfy 연결됨', { exact: true }).waitFor();
  const history = page.getByText(/오늘 수업 안내/);
  await history.waitFor();
  assert.equal(await history.evaluate((el) => getComputedStyle(el).whiteSpace), 'pre-wrap');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.evaluate(() => window.sendFixtureNtfy({ event: 'message', id: 'live-fixture', time: Date.now() / 1000, title: '실시간 검수 알림', message: '앱 알림함 실시간 표시\n두 번째 줄' }));
  await page.getByText('실시간 검수 알림', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(out, 'mobile-notifications.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: path.join(out, 'desktop-notifications.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.goto(`${origin}/#/settings`);
  await input.waitFor();
  await page.screenshot({ path: path.join(out, 'desktop-settings.png'), fullPage: true });
  await input.fill('');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('link', { name: '알림함 보기' }).click();
  await page.getByRole('link', { name: '알림 코드 설정' }).waitFor();
  assert.equal(await page.getByText('실시간 검수 알림', { exact: true }).count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(out, 'mobile-disconnected.png'), fullPage: true });
  assert.equal(await page.evaluate(() => localStorage.getItem('ntfy_topic')), null);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', mode: 'isolated-fixture', historyRequests: calls.length, checks: ['invalid input', 'save and reload persists', 'same-topic history', 'SSE arrival', 'line breaks', 'mobile/desktop overflow', 'disconnect clears history', 'no app JWT sent to ntfy', 'no page errors'], realNotificationsSent: 0 }));
} catch (error) {
  console.error(JSON.stringify({ url: page.url(), body: (await page.locator('body').innerText()).slice(0, 1500), errors }));
  throw error;
} finally { await context.close(); await browser.close(); }
