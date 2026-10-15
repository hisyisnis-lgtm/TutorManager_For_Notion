import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { buildContactEmail, contactOriginAllowed, handleSiteContactRoutes } from '../lib/siteContact.js';
import { siteD1 } from './helpers/siteD1.js';

const ORIGIN = 'https://tiantianchinese.com';
const fields = { type: 'lecture', company: '합성 기업', name: '김담당', email: 'contact@fixture.invalid', message: '합성 출강 문의입니다.\n일정과 수업 방식을 알고 싶어요.', website: '' };
let local, env, send;
function request({ origin = ORIGIN, method = 'POST', body = fields, path = '/api/site/contact', headers = {}, raw, stream } = {}) {
  return new Request(`https://api.fixture.invalid${path}`, { method, headers: { ...(origin === null ? {} : { Origin: origin }),
    'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.75', ...headers },
    ...(['GET', 'HEAD', 'OPTIONS'].includes(method) ? {} : { body: stream || raw || JSON.stringify(body), ...(stream ? { duplex: 'half' } : {}) }) });
}
const submit = options => handleSiteContactRoutes(request(options), env);
beforeEach(() => {
  local = siteD1(); send = vi.fn(async () => ({ messageId: 'synthetic-message-id' }));
  env = { GAME_DB: local.db, JWT_SECRET: 'synthetic-contact-rate-key', SITE_CONTACT_FROM: 'sender@fixture.invalid', CONTACT_EMAIL: { send } };
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('External contact transport is forbidden'); }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { local.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('public contact handler and fixed Email Sending contract', () => {
  it.each(['/api/site/contact', '/contact'])('reaches the real Worker %s without a member or teacher login', async path => {
    const response = await worker.fetch(request({ path }), env, { waitUntil(promise) { promise.catch(() => {}); } });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(response.headers.get('Cache-Control')).toBe(path === '/contact' ? 'private, no-store' : 'no-store'); expect(send).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses fixed recipient and configured sender; user email is Reply-To and body only', async () => {
    const response = await submit({ body: { ...fields, company: ' <script>&企業 ', message: '<img src=x onerror="alert(1)">\n두 번째 줄' } });
    expect(response.status).toBe(200);
    const message = send.mock.calls[0][0];
    expect(message).toMatchObject({ to: 'tiantianchinese_@naver.com', from: { email: 'sender@fixture.invalid', name: '하늘하늘중국어' },
      replyTo: fields.email, subject: '[하늘하늘중국어] 기업·기관 출강 문의' });
    expect(Object.keys(message).sort()).toEqual(['from', 'html', 'replyTo', 'subject', 'text', 'to']);
    expect(message.html).toContain('&lt;script&gt;&amp;企業'); expect(message.html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(message.html).not.toContain('<img'); expect(message.text).toContain('두 번째 줄');
    expect(JSON.stringify(await response.json())).not.toMatch(/fixture|contact@|synthetic|messageId/);
    expect(buildContactEmail(env, { ...fields, type: 'collaboration' }).subject).toContain('콘텐츠·브랜드 협업');
  });
  it('handles preflight and rejects other methods without spending quota or sending mail', async () => {
    const options = await submit({ method: 'OPTIONS' }); expect(options.status).toBe(204); expect(await options.text()).toBe('');
    expect(options.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    const get = await submit({ method: 'GET' }); expect(get.status).toBe(405); expect(get.headers.get('Allow')).toBe('POST, OPTIONS');
    expect(send).not.toHaveBeenCalled(); expect(local.sqlite.prepare('SELECT COUNT(*) n FROM security_rate_limits').get().n).toBe(0);
    expect(await handleSiteContactRoutes(request({ path: '/unrelated' }), env)).toBeNull();
  });
});

describe('contact origin, parser and input boundaries', () => {
  it.each([null, '', 'null', 'https://evil.invalid', 'https://tiantianchinese.com.evil.invalid', 'http://localhost:4330'])('rejects origin %s in production before any delivery', async origin => {
    const response = await submit({ origin }); expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull(); expect(send).not.toHaveBeenCalled();
  });
  it('allows only official origins or the exact loopback development origin, and denies cross-site fetches', async () => {
    for (const origin of [ORIGIN, 'https://www.tiantianchinese.com', 'https://tiantianchinese.pages.dev']) expect(contactOriginAllowed(origin, env)).toBe(true);
    env.SITE_ENVIRONMENT = 'development'; env.SITE_ORIGIN = 'http://localhost:4330';
    expect((await submit({ origin: env.SITE_ORIGIN })).status).toBe(200);
    for (const origin of ['http://localhost:4331', 'http://127.0.0.1:4330']) expect(contactOriginAllowed(origin, env)).toBe(false);
    for (const bad of ['http://localhost:4330/path', 'http://name@localhost:4330', 'https://tiantianchinese.com.evil.invalid']) {
      expect(contactOriginAllowed(bad, { ...env, SITE_ORIGIN: bad })).toBe(false);
    }
    expect((await submit({ headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([
    null, [], {}, { ...fields, type: 'toString' }, { ...fields, company: ' ' }, { ...fields, company: 'a'.repeat(101) },
    { ...fields, name: 'a'.repeat(51) }, { ...fields, company: 'company\r\nBcc: attacker@invalid.test' },
    { ...fields, email: 'one@fixture.invalid,two@fixture.invalid' }, { ...fields, email: 'one\u0001@fixture.invalid' },
    { ...fields, email: 'one@fixture.invalid\r\nBcc: two@fixture.invalid' }, { ...fields, message: ' ' },
    { ...fields, message: 'a'.repeat(2001) }, { ...fields, message: '\0' }, { ...fields, to: 'attacker@fixture.invalid' },
    { ...fields, website: {} },
  ])('rejects invalid fields without sending mail', async body => {
    expect((await submit({ body })).status).toBe(400); expect(send).not.toHaveBeenCalled();
  });
  it('treats a filled honeypot as a quiet no-op without delivery or quota usage', async () => {
    const response = await submit({ body: { website: 'https://bot.invalid/' } });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true }); expect(send).not.toHaveBeenCalled();
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM security_rate_limits').get().n).toBe(0);
  });
  it('rejects non-JSON, malformed JSON and search parameters', async () => {
    for (const options of [{ headers: { 'Content-Type': 'text/plain' } }, { raw: '{"bad":' }, { path: '/api/site/contact?debug=1' }]) expect((await submit(options)).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
  it('bounds both the declared length and the actual streamed bytes at 16 KiB', async () => {
    const declared = await submit({ headers: { 'Content-Length': '16385' } }); expect(declared.status).toBe(413);
    const bytes = new TextEncoder().encode(JSON.stringify({ ...fields, message: '가'.repeat(6000) })); let cancelled = false;
    const stream = new ReadableStream({ start(controller) { controller.enqueue(bytes); }, cancel() { cancelled = true; } });
    const response = await submit({ headers: { 'Content-Length': '1' }, stream }); expect(response.status).toBe(413);
    expect(cancelled).toBe(true); expect(send).not.toHaveBeenCalled();
  });
});

describe('persistent quotas and ambiguous delivery', () => {
  it('persists the three-per-ten-minute IP limit and never records inquiry details in quota rows', async () => {
    for (let index = 0; index < 3; index++) expect((await submit()).status).toBe(200);
    const response = await submit(); expect(response.status).toBe(429); expect((await response.json()).code).toBe('contact_rate_limited');
    expect(send).toHaveBeenCalledTimes(3); expect(JSON.stringify(local.sqlite.prepare('SELECT * FROM security_rate_limits').all())).not.toMatch(/198\.51|합성|fixture/);
  });
  it('enforces the global daily cap across different IP addresses', async () => {
    for (let index = 0; index < 50; index++) expect((await submit({ headers: { 'CF-Connecting-IP': `198.51.100.${index}` } })).status).toBe(200);
    expect((await submit({ headers: { 'CF-Connecting-IP': '198.51.100.250' } })).status).toBe(429); expect(send).toHaveBeenCalledTimes(50);
  });
  it('fails closed if quota storage is missing or a supplied limiter throws', async () => {
    delete env.GAME_DB; expect((await submit()).status).toBe(429); expect(send).not.toHaveBeenCalled();
    const response = await handleSiteContactRoutes(request(), env, { rateLimit: async () => { throw new Error('Private SQL failure'); } });
    expect(response.status).toBe(503); expect((await response.json()).code).toBe('contact_unavailable'); expect(send).not.toHaveBeenCalled();
  });
  it.each([undefined, '', 'sender@fixture.invalid\r\nBcc:x@fixture.invalid'])('rejects missing or invalid sender configuration %s', async sender => {
    env.SITE_CONTACT_FROM = sender; expect((await submit()).status).toBe(503); expect(send).not.toHaveBeenCalled();
  });
  it('does not fall back to another email binding when the restricted contact binding is absent', async () => {
    delete env.CONTACT_EMAIL; env.SITE_EMAIL = { send }; env.EMAIL = { send };
    const response = await submit(); expect(response.status).toBe(503); expect((await response.json()).code).toBe('contact_unavailable'); expect(send).not.toHaveBeenCalled();
  });
  it.each([undefined, {}, { messageId: '' }, { messageId: ' ' }, { messageId: 123 }])('does not claim success for an unconfirmed receipt', async receipt => {
    send.mockResolvedValue(receipt); const response = await submit(); expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('contact_unconfirmed'); expect(send).toHaveBeenCalledTimes(1);
  });
  it('does not automatically retry or expose provider errors after a failed/uncertain send', async () => {
    send.mockRejectedValue(new Error('Private provider request / secret / customer information'));
    const response = await submit(); expect(response.status).toBe(503); expect(await response.json()).toEqual({
      error: '접수 결과를 확인하지 못했어요. 이메일로 접수 여부를 확인해 주세요.', code: 'contact_unconfirmed',
    });
    expect(send).toHaveBeenCalledTimes(1); expect(console.error).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
});
