import { afterEach, describe, it, expect, vi } from 'vitest';
import { rateLimitCheck, putChallenge, consumeChallenge, cleanupSecurityState, SecurityStoreUnavailable } from './securityStore.js';
import { localD1 } from '../tests/helpers/localD1.js';

let local;
const makeEnv = () => { local = localD1(); return { GAME_DB: local.db, JWT_SECRET: 'isolated-storage-key' }; };
afterEach(() => { local?.close(); local = null; vi.restoreAllMocks(); });

describe('atomic security storage', () => {
  it('100 concurrent requests admit exactly the 5 allowed attempts', async () => {
    const env = makeEnv();
    const results = await Promise.all(Array.from({ length: 100 }, () => rateLimitCheck(env, 'student:private-phone', 5, 600)));
    expect(results.filter(Boolean)).toHaveLength(5);
    const row = local.sqlite.prepare('SELECT * FROM security_rate_limits').get();
    expect(row.count).toBe(5);
    expect(row.key_hash).not.toContain('private-phone');
  });
  it('one-time OTP is consumed once under concurrent verification, never by a wrong proof', async () => {
    const env = makeEnv();
    await putChallenge(env, 'student-otp', 'private-student-code', '123456', { verified: true }, 300);
    expect(await consumeChallenge(env, 'student-otp', 'private-student-code', '654321')).toBeNull();
    const row = local.sqlite.prepare('SELECT * FROM security_challenges').get();
    expect(JSON.stringify(row)).not.toMatch(/123456|private-student-code/);
    const results = await Promise.all(Array.from({ length: 20 }, () => consumeChallenge(env, 'student-otp', 'private-student-code', '123456')));
    expect(results.filter(Boolean)).toEqual([{ verified: true }]);
  });
  it('expired records cannot authorize; cleanup removes them and a window restarts', async () => {
    const env = makeEnv();
    expect(await rateLimitCheck(env, 'account', 1, 300)).toBe(true);
    expect(await rateLimitCheck(env, 'account', 1, 300)).toBe(false);
    local.sqlite.prepare('UPDATE security_rate_limits SET expires_at=0').run();
    expect(await rateLimitCheck(env, 'account', 1, 300)).toBe(true);
    await putChallenge(env, 'oauth-code', 'code', 'proof', { sub: 'user' }, -1);
    expect(await consumeChallenge(env, 'oauth-code', 'code', 'proof')).toBeNull();
    await cleanupSecurityState(env);
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM security_challenges').get().n).toBe(0);
  });
  it('missing bindings and SQL failures never allow an attempt or create a session', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await rateLimitCheck({}, 'account', 10, 300)).toBe(false);
    const env = makeEnv();
    local.sqlite.exec('DROP TABLE security_rate_limits; DROP TABLE security_challenges');
    expect(await rateLimitCheck(env, 'account', 10, 300)).toBe(false);
    await expect(putChallenge(env, 'otp', 'key', 'proof', {}, 300)).rejects.toBeInstanceOf(SecurityStoreUnavailable);
    await expect(consumeChallenge(env, 'otp', 'key', 'proof')).rejects.toBeInstanceOf(SecurityStoreUnavailable);
  });
});
