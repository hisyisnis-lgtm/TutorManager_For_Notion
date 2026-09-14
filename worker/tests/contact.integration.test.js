import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { localD1 } from './helpers/localD1.js';

const ORIGIN = 'https://tiantianchinese.com';
const VALID = { type: 'lecture', company: '가상 기관', name: '가상 담당자', email: 'contact@example.test', message: '출강 일정과 내용을 문의합니다.', website: '' };
const ctx = { waitUntil: promise => promise.catch(() => {}) };
let local, env, send;

const request = (body = VALID, { origin = ORIGIN, path = '/contact', method = 'POST', ip = '192.0.2.1', headers = {} } = {}) => worker.fetch(new Request(`https://worker.test${path}`, {
  method, headers: { Origin: origin, 'CF-Connecting-IP': ip, 'Content-Type': 'application/json', ...headers },
  ...(!['GET', 'HEAD', 'OPTIONS'].includes(method) ? { body: JSON.stringify(body) } : {}),
}), env, ctx);

beforeEach(() => {
  local = localD1();
  send = vi.fn(async () => ({ messageId: 'isolated-email-id' }));
  env = { GAME_DB: local.db, JWT_SECRET: 'isolated-contact-test-key', CONTACT_EMAIL: { send } };
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Contact must not call Notion or notification services'); }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  local.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('contact email submission', () => {
  it.each([
    ['lecture', '기업·기관 출강'], ['collaboration', '콘텐츠·브랜드 협업'],
  ])('sends %s only to the fixed business inbox with the submitter as reply-to', async (type, label) => {
    const response = await request({ ...VALID, type, company: ' 가상 기관 ', name: ' 가상 담당자 ', email: ' contact@example.test ', website: undefined });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(send).toHaveBeenCalledExactlyOnceWith({
      to: 'tiantianchinese_@naver.com', from: { email: 'contact@tiantianchinese.com', name: '하늘하늘 중국어' },
      replyTo: 'contact@example.test', subject: `[${label}] 가상 기관`,
      text: expect.stringContaining(`담당자: 가상 담당자\n답변 이메일: contact@example.test`),
      html: expect.stringContaining('출강 일정과 내용을 문의합니다.'),
    });
    expect(console.error).not.toHaveBeenCalled();
  });

  it('waits for provider confirmation before reporting success', async () => {
    let confirm;
    send.mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
    let finished = false;
    const pending = request().then(response => { finished = true; return response; });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(finished).toBe(false);
    confirm({ messageId: 'confirmed-message-id' });
    expect((await pending).status).toBe(200);
  });

  it('escapes HTML while retaining readable plain text and body line breaks', async () => {
    const message = '<img src=x onerror="alert(1)">\nA & B\n\'single\'';
    const response = await request({ ...VALID, company: 'A & <B>', name: '가상 "담당자"', message });
    expect(response.status).toBe(200);
    const email = send.mock.calls[0][0];
    expect(email.text).toContain(message);
    expect(email.html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(email.html).toContain('A &amp; &lt;B&gt;');
    expect(email.html).toContain('&#39;single&#39;');
    expect(email.html).not.toContain('<img');
  });

  it.each([
    ['type', 'consult'], ['company', ' '], ['company', 'x'.repeat(101)], ['name', ''], ['name', 'x'.repeat(51)],
    ['email', 'invalid'], ['email', 'x'.repeat(255) + '@example.test'], ['message', ''], ['message', 'x'.repeat(2001)],
    ['email', 'contact@example.test\r\nBcc: attacker@example.test'], ['email', '\ncontact@example.test'],
    ['company', 'company\r\nBcc: attacker@example.test'], ['name', 'name\nFrom: attacker@example.test'],
    ['message', 'content\u0000'], ['website', 'https://spam.example.test'],
  ])('rejects invalid %s before sending', async (field, value) => {
    const response = await request({ ...VALID, [field]: value });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBeDefined();
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    { to: 'attacker@example.test' }, { from: 'attacker@example.test' }, { replyTo: 'attacker@example.test' },
    { cc: ['attacker@example.test'] }, { bcc: ['attacker@example.test'] }, { headers: { Bcc: 'attacker@example.test' } },
  ])('rejects recipient and header overrides %j', async extra => {
    expect((await request({ ...VALID, ...extra })).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON and unexpected content types', async () => {
    const malformed = await worker.fetch(new Request('https://worker.test/contact', {
      method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: '{',
    }), env, ctx);
    expect(malformed.status).toBe(400);
    expect((await request(VALID, { headers: { 'Content-Type': 'text/plain' } })).status).toBe(415);
    expect(send).not.toHaveBeenCalled();
  });

  it('bounds actual body bytes and declared content length to 32 KiB', async () => {
    expect((await request({ ...VALID, message: 'x'.repeat(32768) })).status).toBe(413);
    expect((await request(VALID, { headers: { 'Content-Length': '32769' } })).status).toBe(413);
    expect(send).not.toHaveBeenCalled();
  });

  it('returns 503 if the email binding is missing', async () => {
    delete env.CONTACT_EMAIL;
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty('ok');
    expect(send).not.toHaveBeenCalled();
  });

  it('returns a sanitized error on rejection without retrying or logging private provider details', async () => {
    send.mockRejectedValueOnce(new Error('private-provider-message contact@example.test private-submitted-body'));
    const response = await request();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: '문의 전송을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.' });
    expect(send).toHaveBeenCalledOnce();
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([undefined, null, {}, { messageId: '' }, { messageId: 123 }])('does not claim success for an unconfirmed provider result %j', async result => {
    send.mockResolvedValueOnce(result);
    const response = await request();
    expect(response.status).toBe(502);
    expect(await response.json()).not.toHaveProperty('ok');
    expect(send).toHaveBeenCalledOnce();
  });

  it('limits each IP to five requests per five minutes', async () => {
    for (let index = 0; index < 5; index += 1) {
      expect((await request({ ...VALID, email: `contact${index}@example.test` })).status).toBe(200);
    }
    expect((await request({ ...VALID, email: 'another@example.test' })).status).toBe(429);
    expect(send).toHaveBeenCalledTimes(5);
  });

  it('limits each normalized email to three requests per day across IPs without storing it in plain text', async () => {
    for (let index = 0; index < 3; index += 1) {
      expect((await request(VALID, { ip: `192.0.2.${index + 1}` })).status).toBe(200);
    }
    expect((await request({ ...VALID, email: ' CONTACT@EXAMPLE.TEST ' }, { ip: '192.0.2.4' })).status).toBe(429);
    expect(send).toHaveBeenCalledTimes(3);
    const rows = local.sqlite.prepare('SELECT * FROM security_rate_limits').all();
    expect(JSON.stringify(rows)).not.toMatch(/contact@example|192\.0\.2\./);
    expect(rows.every(row => /^[a-f0-9]{64}$/.test(row.key_hash))).toBe(true);
  });

  it('fails closed without rate-limit storage', async () => {
    delete env.GAME_DB;
    expect((await request()).status).toBe(429);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('contact origin and method boundary', () => {
  it.each([ORIGIN, 'https://www.tiantianchinese.com', 'https://tiantianchinese.pages.dev'])('allows exact POST and preflight from %s without opening private routes', async origin => {
    const preflight = await request(undefined, { origin, method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toBe('POST');
    const invalid = await request({}, { origin });
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    for (const path of ['/auth/login', '/notifications', '/v1/pages/12345678-1234-1234-1234-123456789abc']) {
      expect((await request({}, { origin, path })).status).toBe(403);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects lookalike origins, path variants and unsupported methods before sending', async () => {
    for (const origin of ['https://tiantianchinese.com.attacker.test', 'http://tiantianchinese.com', 'https://attacker.test', '']) {
      expect((await request(VALID, { origin })).status).toBe(403);
      const preflight = await request(undefined, { origin, method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST' } });
      expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('');
    }
    for (const path of ['/contact/', '/contact/extra']) expect((await request(VALID, { path })).status).toBe(403);
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      expect((await request(VALID, { method })).status).toBe(403);
      const preflight = await request(undefined, { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': method } });
      expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('');
    }
    expect((await request(undefined, { method: 'OPTIONS' })).headers.get('Access-Control-Allow-Origin')).toBe('');
    expect(send).not.toHaveBeenCalled();
  });
});
