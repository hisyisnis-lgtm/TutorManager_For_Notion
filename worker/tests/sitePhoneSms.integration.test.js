import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import Worker from '../src/index.js';
import { siteD1 } from './helpers/siteD1.js';

const ORIGIN = 'https://tiantianchinese.com', PHONE = '01012345678';
let local, env;
const ctx = { waitUntil() {} };
beforeEach(() => {
  local = siteD1(); local.sqlite.exec('BEGIN IMMEDIATE'); local.sqlite.exec(readFileSync(new URL('../migrations/0028_site_phone_auth.sql', import.meta.url), 'utf8')); local.sqlite.exec('COMMIT');
  env = { GAME_DB: local.db, SITE_SESSION_SECRET: 'synthetic-phone-session-secret-at-least-32', SITE_PHONE_ENABLED: 'true',
    SOLAPI_API_KEY: 'synthetic-solapi-key', SOLAPI_API_SECRET: 'synthetic-solapi-secret', SOLAPI_SENDER: '01000000000' };
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { local.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function send() {
  const initial = await Worker.fetch(new Request(`${ORIGIN}/api/site/session`, { headers: { Origin: ORIGIN } }), env, ctx);
  expect(initial.status).toBe(200); const session = await initial.json();
  return Worker.fetch(new Request(`${ORIGIN}/api/site/auth/phone/request`, { method: 'POST', headers: { Origin: ORIGIN,
    Cookie: initial.headers.get('Set-Cookie').split(';')[0], 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: PHONE, purpose: 'signin' }) }), env, ctx);
}
describe('site phone reuses the existing Solapi sender safely', () => {
  it('uses a fixed HTTPS endpoint, signed SMS, manual redirects and a bounded request without logging PII', async () => {
    let code;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      expect(url).toBe('https://api.solapi.com/messages/v4/send'); expect(init.redirect).toBe('manual'); expect(init.signal).toBeInstanceOf(AbortSignal);
      const parts = Object.fromEntries(init.headers.Authorization.replace('HMAC-SHA256 ', '').split(', ').map(value => value.split('=')));
      expect(parts.apiKey).toBe(env.SOLAPI_API_KEY);
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SOLAPI_API_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(parts.date + parts.salt)));
      expect(parts.signature).toBe([...bytes].map(value => value.toString(16).padStart(2, '0')).join(''));
      const { message } = JSON.parse(init.body); expect(message.to).toBe(PHONE); expect(message.from).toBe(env.SOLAPI_SENDER);
      expect(message.text).toContain('하늘하늘중국어'); expect(message.text).toContain('5분'); code = message.text.match(/\[(\d{6})\]/)[1];
      return Response.json({ statusCode: '2000' });
    }));
    const response = await send(); expect(response.status).toBe(200); expect(fetch).toHaveBeenCalledTimes(1);
    const output = JSON.stringify([console.log.mock.calls, console.error.mock.calls]);
    for (const privateValue of [PHONE, code, env.SOLAPI_API_SECRET, env.SOLAPI_API_KEY]) expect(output).not.toContain(privateValue);
  });
  it.each(['redirect', 'server-error', 'malformed', 'timeout'])('does not retry or accept %s as delivered', async kind => {
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      expect(url).toBe('https://api.solapi.com/messages/v4/send'); expect(init.redirect).toBe('manual');
      if (kind === 'timeout') throw new DOMException('Synthetic timeout', 'TimeoutError');
      if (kind === 'redirect') return new Response('Private response', { status: 302, headers: { Location: 'https://attacker.invalid/' } });
      if (kind === 'server-error') return new Response('Private response', { status: 500 });
      return Response.json({ message: 'Private response without acceptance evidence' });
    }));
    const response = await send(); expect(response.status).toBe(503); expect(fetch).toHaveBeenCalledTimes(1);
    expect((await response.json()).code).toBe('phone_delivery_failed');
    expect(local.sqlite.prepare('SELECT consumed_at FROM site_phone_challenges').get().consumed_at).not.toBeNull();
  });
});
