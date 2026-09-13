import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { localD1 } from '../tests/helpers/localD1.js';
import { recordNotificationEvent, queueNotificationRecord, listNotificationFollowups, resolveNotificationFollowup, ingestNotificationFollowup, handleNotificationFollowups } from './notificationFollowups.js';

const ID = '11111111-1111-4111-8111-111111111111', REF = '22222222-2222-4222-8222-222222222222';
const event = overrides => ({ id: ID, kind: 'homework-submit', referenceId: REF, state: 'queued', reason: 'ntfy_queued', ...overrides });
let local, env;
beforeEach(() => { local = localD1(); env = { GAME_DB: local.db, NTFY_TOKEN: 'isolated-ntfy', SOLAPI_API_SECRET: 'isolated-solapi' }; });
afterEach(() => { local.close(); vi.restoreAllMocks(); vi.useRealTimers(); });
const signedRequest = (body, secret = env.NTFY_TOKEN, timestamp = String(Math.floor(Date.now() / 1000))) => {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const signature = createHmac('sha256', secret).update(`tutor-notification-followup/v1\n${timestamp}\n${raw}`).digest('hex');
  return new Request('https://worker.test/notification-followups/ingest', { method: 'POST', headers: {
    'X-Notification-Timestamp': timestamp, 'X-Notification-Signature': signature,
  }, body: raw });
};

describe('isolated D1 notification outcomes and resolution', () => {
  it('updates queued to final and does not downgrade on late queued, replay, or manual resolution', async () => {
    await recordNotificationEvent(env, event());
    await recordNotificationEvent(env, event({ state: 'unknown', reason: 'ntfy_publish_unknown' }));
    const resolved = await resolveNotificationFollowup(env, ID, 'provider_checked');
    expect(resolved).toMatchObject({ state: 'unknown', resolutionKind: 'provider_checked' });
    expect(resolved.resolvedAt).toBeGreaterThan(0);
    await recordNotificationEvent(env, event());
    await recordNotificationEvent(env, event({ state: 'accepted', reason: 'ntfy_accepted' }));
    expect(await resolveNotificationFollowup(env, ID, 'contacted')).toEqual(resolved);
    expect((await listNotificationFollowups(env)).items).toHaveLength(0);
    expect((await listNotificationFollowups(env, { filter: 'resolved' })).items).toEqual([resolved]);
  });
  it('preserves a callback arriving before the dispatch result', async () => {
    await recordNotificationEvent(env, event({ state: 'accepted', reason: 'ntfy_accepted' }));
    await recordNotificationEvent(env, event());
    expect((await listNotificationFollowups(env, { filter: 'all' })).items[0]).toMatchObject({ state: 'accepted', reason: 'ntfy_accepted' });
    expect(await resolveNotificationFollowup(env, ID, 'no_action_needed')).toBeNull();
  });
  it('shows missing relay callbacks after 15 minutes and preserves operator history on a late accepted callback', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-10T00:00:00Z'));
    await recordNotificationEvent(env, event());
    vi.setSystemTime(new Date('2026-09-10T00:14:59Z'));
    expect((await listNotificationFollowups(env)).items).toHaveLength(0);
    expect(await resolveNotificationFollowup(env, ID, 'provider_checked')).toBeNull();
    vi.setSystemTime(new Date('2026-09-10T00:15:00Z'));
    expect((await listNotificationFollowups(env)).items[0]).toMatchObject({ state: 'queued', needsAttention: true });
    await resolveNotificationFollowup(env, ID, 'provider_checked');
    const final = await recordNotificationEvent(env, event({ state: 'accepted', reason: 'ntfy_accepted' }));
    expect(final).toMatchObject({ state: 'accepted', needsAttention: false, resolutionKind: 'provider_checked' });
    expect(final.resolvedAt).toBeGreaterThan(0);
    expect((await listNotificationFollowups(env)).items).toHaveLength(0);
  });
  it('paginates tied timestamps without omitting or duplicating a record', async () => {
    const ids = Array.from({ length: 53 }, (_, n) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`);
    for (const id of ids) await recordNotificationEvent(env, event({ id, state: 'failed', reason: 'ntfy_publish_failed' }));
    const first = await listNotificationFollowups(env), second = await listNotificationFollowups(env, { before: first.nextCursor });
    expect(first.items).toHaveLength(50); expect(second.items).toHaveLength(3); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(53);
  });
  it('rejects arbitrary text and identity collisions without changing the original record', async () => {
    await expect(recordNotificationEvent(env, event({ phone: '01012345678' }))).rejects.toThrow();
    await expect(recordNotificationEvent(env, event({ reason: 'private-body-or-token' }))).rejects.toThrow();
    await recordNotificationEvent(env, event());
    await expect(recordNotificationEvent(env, event({ referenceId: ID }))).rejects.toThrow();
    expect(local.sqlite.prepare('SELECT * FROM notification_followups').all()).toHaveLength(1);
  });
  it('keeps logging errors ancillary and calls waitUntil with its receiver', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = { GAME_DB: { prepare() { throw new Error('private-db-error'); } } };
    const ctx = { waitUntil: vi.fn(function (task) { expect(this).toBe(ctx); expect(task).toBeInstanceOf(Promise); }) };
    await expect(queueNotificationRecord(broken, ctx, { kind: 'homework-assign', referenceId: REF }, { state: 'failed' })).resolves.toBeUndefined();
    expect(ctx.waitUntil).toHaveBeenCalledOnce(); expect(JSON.stringify(console.error.mock.calls)).not.toContain('private-db-error');
  });
});

describe('server-to-server follow-up ingestion', () => {
  it('accepts a bounded signed callback and makes a replay idempotent', async () => {
    const body = event({ state: 'accepted', reason: 'ntfy_accepted' });
    expect((await ingestNotificationFollowup(signedRequest(body), env)).status).toBe(200);
    expect((await ingestNotificationFollowup(signedRequest(body), env)).status).toBe(200);
    expect(local.sqlite.prepare('SELECT * FROM notification_followups').all()).toHaveLength(1);
  });
  it('rejects unauthenticated, stale, wrong-domain-key, and oversized callbacks', async () => {
    const body = event({ state: 'unknown', reason: 'ntfy_publish_unknown' });
    expect((await ingestNotificationFollowup(new Request('https://worker.test', { method: 'POST', body: JSON.stringify(body) }), env)).status).toBe(401);
    expect((await ingestNotificationFollowup(signedRequest(body, env.NTFY_TOKEN, '1000000000'), env)).status).toBe(401);
    expect((await ingestNotificationFollowup(signedRequest(body, env.SOLAPI_API_SECRET), env)).status).toBe(401);
    expect((await ingestNotificationFollowup(signedRequest('x'.repeat(4097)), env)).status).toBe(400);
    expect(local.sqlite.prepare('SELECT * FROM notification_followups').all()).toHaveLength(0);
  });
  it('rejects private extra fields and inconsistent aggregate counts', async () => {
    expect((await ingestNotificationFollowup(signedRequest(event({ state: 'failed', reason: 'ntfy_publish_failed', token: 'private-token' })), env)).status).toBe(400);
    const batch = { id: 'a'.repeat(64), kind: 'student-tomorrow', referenceId: '1234', state: 'accepted', reason: 'batch_result', counts: { sent: 1, alreadyAccepted: 0, failed: 0, unknown: 1 } };
    expect((await ingestNotificationFollowup(signedRequest(batch, env.SOLAPI_API_SECRET), env)).status).toBe(400);
    batch.state = 'unknown';
    expect((await ingestNotificationFollowup(signedRequest(batch, env.SOLAPI_API_SECRET), env)).status).toBe(200);
  });
  it('returns visible storage failure rather than empty success when D1 is unavailable', async () => {
    const response = await handleNotificationFollowups(new Request('https://worker.test/notification-followups'), {}, {});
    expect(response.status).toBe(503); expect(await response.json()).toHaveProperty('error');
    const ingest = await ingestNotificationFollowup(signedRequest(event({ state: 'failed', reason: 'ntfy_publish_failed' })), { NTFY_TOKEN: env.NTFY_TOKEN });
    expect(ingest.status).toBe(503);
  });
});
