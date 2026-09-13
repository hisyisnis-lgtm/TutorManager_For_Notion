import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { signTypedToken } from '../lib/auth.js';
import { recordNotificationEvent } from '../lib/notificationFollowups.js';
import { localD1 } from './helpers/localD1.js';
import { reportNotificationBatch, reportNotificationRelay } from '../../01_automation/notification_followups.mjs';
import { sendNotificationBatch } from '../../01_automation/notification_batch.mjs';

const ID = '11111111-1111-4111-8111-111111111111';
let local, env, teacher, student;
beforeEach(async () => {
  local = localD1(); env = { GAME_DB: local.db, JWT_SECRET: 'isolated-jwt', NTFY_TOKEN: 'isolated-ntfy', SOLAPI_API_SECRET: 'isolated-solapi' };
  teacher = await signTypedToken(env.JWT_SECRET, 'teacher', 'teacher', 600, { role: 'teacher' });
  student = await signTypedToken(env.JWT_SECRET, 'student', 'personal:TEST12345678', 600);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Live network denied'); }));
  vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { local.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const call = (token, method = 'GET', path = '/notification-followups', body) => worker.fetch(new Request('https://worker.test' + path, {
  method, headers: { Origin: 'http://localhost:5173', ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
}), env, { waitUntil() {} });

describe('teacher-only follow-up operations', () => {
  it('denies anonymous and student reads/changes and never calls a provider', async () => {
    for (const token of [undefined, student]) {
      expect((await call(token)).status).toBe(401);
      expect((await call(token, 'PATCH', '/notification-followups/' + ID, { resolutionKind: 'contacted' })).status).toBe(401);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('allows teacher read and idempotent resolution while preserving the delivery outcome', async () => {
    await recordNotificationEvent(env, { id: ID, kind: 'homework-assign', referenceId: null, state: 'unknown', reason: 'solapi_response_unknown' });
    const list = await call(teacher);
    expect(list.status).toBe(200); expect(list.headers.get('Cache-Control')).toContain('no-store');
    expect((await list.json()).items).toHaveLength(1);
    const patch = await call(teacher, 'PATCH', '/notification-followups/' + ID, { resolutionKind: 'contacted' });
    expect(patch.status).toBe(200);
    expect((await patch.json()).item).toMatchObject({ state: 'unknown', resolutionKind: 'contacted' });
    expect((await (await call(teacher)).json()).items).toHaveLength(0);
    expect((await (await call(teacher, 'GET', '/notification-followups?filter=resolved')).json()).items).toHaveLength(1);
    expect((await call(teacher, 'PATCH', '/notification-followups/' + ID, { resolutionKind: 'contacted', note: 'private text' })).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('automation result reporting uses existing secrets without resending', () => {
  const automationEnv = () => ({ ...env, NOTIFICATION_FOLLOWUP_URL: 'https://worker.test/notification-followups/ingest', GITHUB_RUN_ID: '123456', GITHUB_RUN_ATTEMPT: '1' });
  const throughWorker = () => vi.fn(async (url, init) => {
    expect(init.redirect).toBe('manual');
    expect(init.headers.Authorization).toBeUndefined();
    return worker.fetch(new Request(url, init), env, { waitUntil() {} });
  });
  it('ingests signed aggregate and relay results through the actual origin-independent route', async () => {
    const fetchImpl = throughWorker(), log = vi.fn();
    const counts = { sent: 2, alreadyAccepted: 1, failed: 0, unknown: 1, phone: 'private-ignored' };
    expect(await reportNotificationBatch('notify-student-tomorrow.yml', counts, { env: automationEnv(), fetchImpl, log })).toEqual({ ok: true });
    expect(await reportNotificationRelay({ id: ID, kind: 'homework-submit', referenceId: null }, 'accepted', { env: automationEnv(), fetchImpl, log })).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.every(([, init]) => !init.body.includes('private-ignored'))).toBe(true);
    expect(local.sqlite.prepare('SELECT delivery_state FROM notification_followups ORDER BY delivery_state').all().map(row => row.delivery_state)).toEqual(['accepted', 'unknown']);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('makes the same run-attempt callback idempotent and creates a separate row for a rerun', async () => {
    const fetchImpl = throughWorker(), options = { env: automationEnv(), fetchImpl, log: vi.fn() };
    const counts = { sent: 0, alreadyAccepted: 0, failed: 1, unknown: 0 };
    await reportNotificationBatch('notify-consult-tomorrow.yml', counts, options);
    await reportNotificationBatch('notify-consult-tomorrow.yml', counts, options);
    options.env.GITHUB_RUN_ATTEMPT = '2';
    await reportNotificationBatch('notify-consult-tomorrow.yml', counts, options);
    expect(local.sqlite.prepare('SELECT * FROM notification_followups').all()).toHaveLength(2);
  });
  it('does not retry failed collection or leak secret values, and rejects insecure destinations', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('private-provider-error'); }), log = vi.fn();
    const options = { env: automationEnv(), fetchImpl, log };
    const counts = { sent: 1, alreadyAccepted: 0, failed: 0, unknown: 0 };
    expect(await reportNotificationBatch('notify-student-tomorrow.yml', counts, options)).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-provider-error|isolated-solapi/);
    options.env.NOTIFICATION_FOLLOWUP_URL = 'http://worker.test/notification-followups/ingest';
    expect(await reportNotificationBatch('notify-student-tomorrow.yml', counts, options)).toMatchObject({ ok: false });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('reports a blocked-unknown batch without resending and reporting failure does not change successful sending', async () => {
    const sendKakao = vi.fn(async () => ({ ok: true, state: 'accepted' }));
    const onResult = vi.fn(async () => { throw new Error('private-collector-error'); });
    const ledger = { get: key => key === 'b'.repeat(64) ? 'unknown' : undefined, record: vi.fn() };
    const item = key => ({ key: key === 'blocked' ? 'b'.repeat(64) : 'f'.repeat(64), to: 'not-a-real-recipient', templateId: 'fixture', variables: {} });
    await expect(sendNotificationBatch({ notifications: [item('blocked')], ledger, sendKakao, onResult })).rejects.toMatchObject({ counts: { unknown: 1 } });
    expect(sendKakao).not.toHaveBeenCalled(); expect(onResult).toHaveBeenCalledOnce();
    await expect(sendNotificationBatch({ notifications: [item('fresh')], ledger, sendKakao, onResult })).resolves.toMatchObject({ sent: 1, failed: 0, unknown: 0 });
    expect(sendKakao).toHaveBeenCalledOnce();
  });
});
