import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSiteAuthRoutes, authorizeSiteMember } from '../lib/siteAuth.js';
import { siteD1 } from './helpers/siteD1.js';

const ORIGIN = 'https://tiantianchinese.com';
const MEMBER_ID = 'synthetic-auth-performance-member';
let local, env, session, calls;

// Count executed production SQL, rather than prepare() calls, against real local SQLite.
function countedDb(db) {
  return { ...db, prepare(sql) {
    const wrap = (statement, args = []) => ({ ...statement,
      bind: (...params) => wrap(statement.bind(...params), params),
      first: async () => { calls.push({ sql, args }); return statement.first(); },
      all: async () => { calls.push({ sql, args }); return statement.all(); },
      run: async () => { calls.push({ sql, args }); return statement.run(); },
    });
    return wrap(db.prepare(sql));
  } };
}

function request({ method = 'GET', cookie = session.cookie, csrf = session.csrfToken, origin = ORIGIN } = {}) {
  return new Request(`${ORIGIN}/api/site/me`, { method,
    headers: { ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
  });
}
async function error(options = {}, authOptions = {}) {
  const response = await authorizeSiteMember(request(options), env, authOptions);
  expect(response).toBeInstanceOf(Response);
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  return { status: response.status, ...(await response.json()) };
}

beforeEach(async () => {
  local = siteD1();
  calls = [];
  env = { GAME_DB: countedDb(local.db), SITE_SESSION_SECRET: 'synthetic-performance-session-secret-32-characters' };
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected network access'); }));
  const response = await handleSiteAuthRoutes(new Request(`${ORIGIN}/api/site/session`, { headers: { Origin: ORIGIN } }), env);
  session = { cookie: response.headers.get('Set-Cookie').split(';')[0], ...(await response.json()) };
  local.sqlite.prepare(`INSERT INTO site_members(id,status,email,name,nickname,phone,member_code,customer_key,provider,
    password_hash,password_salt,password_iterations,terms_accepted_at,privacy_accepted_at,marketing_accepted,created_at,updated_at)
    VALUES(?,'active','member@example.invalid','가상 회원','별명','01000000000','HSYNTHETIC1','synthetic-customer','google',
      'synthetic-password-hash','synthetic-password-salt',100000,'2026-10-11','2026-10-11',1,'2026-10-11','2026-10-11')`).run(MEMBER_ID);
  local.sqlite.prepare('UPDATE site_sessions SET member_id=?').run(MEMBER_ID);
  calls.length = 0;
});
afterEach(() => { local.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('site member authorization SQL and security behavior', () => {
  it('executes one indexed read for successful read authorization without reading password credentials', async () => {
    const access = await authorizeSiteMember(request(), env);
    expect(access).not.toBeInstanceOf(Response);
    expect(access.member).toEqual({ id: MEMBER_ID, memberCode: 'HSYNTHETIC1', customerKey: 'synthetic-customer',
      name: '가상 회원', nickname: '별명', email: 'member@example.invalid', phone: '01000000000', status: 'active',
      provider: 'google', profileComplete: true, marketingAccepted: true });
    expect(access.session).toEqual(local.sqlite.prepare('SELECT * FROM site_sessions').get());
    expect(access.member).not.toHaveProperty('password_hash');
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).not.toMatch(/SELECT\s+\*|password_hash|password_salt|password_iterations/i);
    const plans = calls.flatMap(({ sql, args }) => local.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args))
      .map(row => row.detail);
    expect(plans).toEqual(expect.arrayContaining([
      expect.stringMatching(/SEARCH s USING INDEX .*token_hash/),
      expect.stringMatching(/SEARCH m USING INDEX .*id.*LEFT-JOIN/),
    ]));
  });

  it('retains two indexed reads for CSRF authorization and reads the member after verification', async () => {
    const access = await authorizeSiteMember(request({ method: 'POST' }), env, { requireCsrf: true });
    expect(access).not.toBeInstanceOf(Response);
    expect(access.member.id).toBe(MEMBER_ID);
    expect(access.member.profileComplete).toBe(true);
    expect(access.session).toEqual(local.sqlite.prepare('SELECT * FROM site_sessions').get());
    expect(calls).toHaveLength(2);
    const plans = calls.flatMap(({ sql, args }) => local.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args))
      .map(row => row.detail);
    expect(plans).toEqual(expect.arrayContaining([
      expect.stringMatching(/SEARCH site_sessions USING INDEX .*token_hash/),
      expect.stringMatching(/SEARCH site_members USING INDEX .*id/),
    ]));
  });

  it.each(['suspended', 'withdrawn'])('rejects a member changed to %s while CSRF verification is pending', async status => {
    const verify = crypto.subtle.verify.bind(crypto.subtle);
    const verifySpy = vi.spyOn(crypto.subtle, 'verify').mockImplementation(async (...args) => {
      const valid = await verify(...args);
      // The session was read while active. Revoke the member before crypto.verify resolves to the caller.
      local.sqlite.prepare('UPDATE site_members SET status=? WHERE id=?').run(status, MEMBER_ID);
      return valid;
    });
    expect(await error({ method: 'POST' }, { requireCsrf: true })).toMatchObject({ status: 403, code: 'member_unavailable' });
    expect(verifySpy).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(2);
  });

  it('rejects invalid origin and missing cookie before reading the database', async () => {
    expect(await error({ origin: 'https://other.example.invalid' })).toMatchObject({ status: 403, code: 'origin_denied' });
    expect(await error({ cookie: '' })).toMatchObject({ status: 401, code: 'session_required' });
    expect(calls).toHaveLength(0);
  });

  it('rejects expired or revoked sessions before the CSRF or member checks', async () => {
    local.sqlite.exec('UPDATE site_sessions SET expires_at=0');
    expect(await error({ method: 'POST', csrf: '' }, { requireCsrf: true }))
      .toMatchObject({ status: 401, code: 'session_expired' });
    local.sqlite.exec('UPDATE site_sessions SET expires_at=unixepoch()+3600,revoked_at=unixepoch()');
    expect(await error()).toMatchObject({ status: 401, code: 'session_expired' });
  });

  it('checks CSRF before an anonymous or missing member and retains default read behavior', async () => {
    local.sqlite.exec('UPDATE site_sessions SET member_id=NULL');
    expect(await error({ method: 'POST', csrf: '' }, { requireCsrf: true })).toMatchObject({ status: 403, code: 'csrf_denied' });
    expect(await error()).toMatchObject({ status: 401, code: 'login_required' });
    local.sqlite.exec("PRAGMA foreign_keys=OFF; UPDATE site_sessions SET member_id='missing-member'");
    expect(await error({ method: 'POST', csrf: 'x'.repeat(43) }, { requireCsrf: true })).toMatchObject({ status: 403, code: 'csrf_denied' });
    expect(await error()).toMatchObject({ status: 403, code: 'member_unavailable' });
  });

  it.each(['suspended', 'withdrawn'])('rejects a %s member after valid CSRF without losing the session', async status => {
    local.sqlite.prepare('UPDATE site_members SET status=?').run(status);
    // Synthetic malformed state: retain a current session to exercise the account check itself.
    local.sqlite.exec('UPDATE site_sessions SET revoked_at=NULL');
    expect(await error({ method: 'POST', csrf: '' }, { requireCsrf: true })).toMatchObject({ status: 403, code: 'csrf_denied' });
    expect(await error({ method: 'POST' }, { requireCsrf: true })).toMatchObject({ status: 403, code: 'member_unavailable' });
  });

  it.each(['status', 'name', 'terms_accepted_at', 'privacy_accepted_at'])('preserves incomplete profile checks for %s', async field => {
    const values = { status: 'pending', name: '', terms_accepted_at: null, privacy_accepted_at: null };
    local.sqlite.prepare(`UPDATE site_members SET ${field}=?`).run(values[field]);
    expect(await error()).toMatchObject({ status: 409, code: 'profile_incomplete' });
    const access = await authorizeSiteMember(request(), env, { allowIncomplete: true });
    expect(access).not.toBeInstanceOf(Response);
    expect(access.member.profileComplete).toBe(false);
  });

  it('reads current authorization on every invocation after membership changes', async () => {
    expect(await authorizeSiteMember(request(), env)).not.toBeInstanceOf(Response);
    local.sqlite.exec("UPDATE site_members SET status='suspended'");
    expect(await error()).toMatchObject({ status: 401, code: 'session_expired' });
  });

  it('fails closed when the database or deployment configuration is unavailable', async () => {
    env.SITE_SESSION_SECRET = 'short';
    expect(await error()).toMatchObject({ status: 503, code: 'site_unavailable' });
    expect(calls).toHaveLength(0);
    env.SITE_SESSION_SECRET = 'synthetic-performance-session-secret-32-characters';
    local.sqlite.exec('DROP TABLE site_sessions');
    const response = await error();
    expect(response).toMatchObject({ status: 503, code: 'site_unavailable' });
    expect(response.error).not.toMatch(/SQL|site_sessions|password|secret/);
  });
});
