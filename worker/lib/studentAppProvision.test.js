import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { changeStudentAppProvision, readStudentAppProvision } from './studentAppProvision.js';
import { readStudentAppAccess, writeStudentAppAccess } from './studentAppAccess.js';
import { SITE_LEDGER_DATABASES } from './siteNotionSync.js';
import { siteD1 } from '../tests/helpers/siteD1.js';

const ID = '11111111111141118111111111111111';
let local, env, page, patches, getHook, patchHook, losePatch, rejectPatch;
const on = revision => changeStudentAppProvision(env, ID, { allowed: true, expectedRevision: revision });
const off = revision => changeStudentAppProvision(env, ID, { allowed: false, expectedRevision: revision });
const row = () => local.sqlite.prepare('SELECT * FROM student_app_homework_sync WHERE student_id=?').get(ID);
beforeEach(() => {
  local = siteD1(); local.sqlite.exec(readFileSync(new URL('../migrations/0011_student_app_access.sql', import.meta.url), 'utf8'));
  env = { GAME_DB: local.db, NOTION_TOKEN: 'synthetic-notion-only' };
  page = { object: 'page', id: ID, parent: { database_id: SITE_LEDGER_DATABASES.student }, properties: {
    VIP: { id: 'D%3D%7DP', type: 'checkbox', checkbox: false },
  } };
  patches = []; getHook = null; patchHook = null; losePatch = null; rejectPatch = null;
  vi.stubGlobal('fetch', vi.fn(async (raw, options = {}) => {
    const url = new URL(raw), method = options.method || 'GET';
    if (url.origin !== 'https://api.notion.com' || !url.pathname.startsWith('/v1/pages/')) throw new Error('External network denied');
    if (method === 'GET') return await getHook?.() || Response.json(page);
    if (method !== 'PATCH') throw new Error('Unexpected synthetic method');
    const input = JSON.parse(options.body); expect(Object.keys(input.properties)).toEqual(['VIP']);
    const target = input.properties.VIP.checkbox; patches.push(target);
    await patchHook?.(target);
    if (rejectPatch) return Response.json({ object: 'error' }, { status: rejectPatch });
    if (losePatch !== 'drop') page.properties.VIP.checkbox = target;
    if (losePatch) throw new Error('Synthetic Notion response lost');
    return Response.json(page);
  }));
});
afterEach(() => { local.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('one student app and homework setting', () => {
  it('requires confirmed VIP before granting and returns verified metadata', async () => {
    expect(await readStudentAppProvision(env, ID)).toMatchObject({ access: { allowed: false, revision: 0 },
      sync: { state: 'synced', ready: true, homeworkEnabled: false, pendingAllowed: null, expectedRevision: null } });
    patchHook = async target => { if (target) expect(await readStudentAppAccess(env, ID)).toMatchObject({ allowed: false, revision: 0 }); };
    expect(await on(0)).toMatchObject({ access: { allowed: true, revision: 1 }, sync: { state: 'synced', ready: true, homeworkEnabled: true } });
    expect(patches).toEqual([true]); expect(row().verified_allowed).toBe(1);
  });
  it('revokes D1 before any Notion call and increments a fresh false-to-false request', async () => {
    await on(0);
    getHook = async () => { expect((await readStudentAppAccess(env, ID)).allowed).toBe(false); };
    expect(await off(1)).toMatchObject({ access: { allowed: false, revision: 2 }, sync: { ready: true, homeworkEnabled: false } });
    expect(await off(2)).toMatchObject({ access: { allowed: false, revision: 3 } });
    expect(patches).toEqual([true, false]);
    expect(await off(2)).toMatchObject({ access: { allowed: false, revision: 3 } }); // Same request, not another revision.
  });
  it('lets a concurrent OFF fence an in-flight ON and compensates VIP under the original lease', async () => {
    let release; const barrier = new Promise(resolve => { release = resolve; });
    patchHook = async target => { if (target) await barrier; };
    const enabling = on(0).then(value => ({ value }), error => ({ error }));
    await vi.waitFor(() => expect(patches).toEqual([true]));
    await expect(off(0)).rejects.toMatchObject({ code: 'student_app_sync_in_progress', access: { allowed: false, revision: 1 } });
    release();
    expect((await enabling).error).toMatchObject({ code: 'access_revision_changed', access: { allowed: false, revision: 1 } });
    expect(patches).toEqual([true, false]); expect(page.properties.VIP.checkbox).toBe(false);
    expect(await readStudentAppAccess(env, ID)).toMatchObject({ allowed: false, revision: 1 });
    expect(row()).toMatchObject({ state: 'synced', verified_allowed: 0 });
  }, 20_000);
  it('keeps uncertain ON closed and recovers only by observing the original write, without another PATCH', async () => {
    losePatch = 'apply';
    await expect(on(0)).rejects.toMatchObject({ code: 'student_app_sync_unknown', access: { allowed: false, revision: 0 }, sync: { state: 'unknown', ready: false } });
    expect((await readStudentAppProvision(env, ID)).sync.state).toBe('unknown');
    expect(await readStudentAppAccess(env, ID)).toMatchObject({ allowed: false, revision: 0 });
    losePatch = null;
    expect(await on(0)).toMatchObject({ access: { allowed: true, revision: 1 }, sync: { ready: true, homeworkEnabled: true } });
    expect(patches).toEqual([true]);
  });
  it('never repeats a PATCH while an unknown write has not been observed, even after lease expiry', async () => {
    losePatch = 'drop'; await expect(on(0)).rejects.toMatchObject({ code: 'student_app_sync_unknown' });
    local.sqlite.prepare("UPDATE student_app_homework_sync SET state='processing',lease_token='old-worker',lease_until=0 WHERE student_id=?").run(ID);
    losePatch = null;
    await expect(on(0)).rejects.toMatchObject({ code: 'student_app_sync_unknown' });
    getHook = async () => { throw new Error('Synthetic lookup unavailable'); };
    await expect(on(0)).rejects.toMatchObject({ sync: { state: 'unknown' } });
    expect(row().state).toBe('unknown'); expect(patches).toEqual([true]);
    expect(await readStudentAppAccess(env, ID)).toMatchObject({ allowed: false, revision: 0 });
  });
  it('retains a completed OFF after a lost response and does not revoke twice on the same retry', async () => {
    await on(0); losePatch = 'apply';
    await expect(off(1)).rejects.toMatchObject({ access: { allowed: false, revision: 2 }, sync: { state: 'unknown' } });
    losePatch = null;
    expect(await off(1)).toMatchObject({ access: { allowed: false, revision: 2 }, sync: { ready: true, homeworkEnabled: false } });
    expect(patches).toEqual([true, false]);
  });
  it('closes an existing true entitlement when VIP repair becomes unknown, and safely resumes its own closure', async () => {
    await writeStudentAppAccess(env, ID, { allowed: true, expectedRevision: 0 });
    losePatch = 'apply';
    await expect(on(1)).rejects.toMatchObject({ access: { allowed: false, revision: 2 }, sync: { state: 'unknown' } });
    expect(row().result_revision).toBe(2);
    losePatch = null;
    expect(await on(1)).toMatchObject({ access: { allowed: true, revision: 3 }, sync: { ready: true, homeworkEnabled: true } });
    expect(patches).toEqual([true]);
  });
  it('never restores an unknown grant after a separate explicit OFF revision', async () => {
    await writeStudentAppAccess(env, ID, { allowed: true, expectedRevision: 0 });
    losePatch = 'apply'; await expect(on(1)).rejects.toMatchObject({ access: { allowed: false, revision: 2 } });
    await writeStudentAppAccess(env, ID, { allowed: false, expectedRevision: 2 });
    losePatch = null;
    await expect(on(1)).rejects.toMatchObject({ code: 'access_revision_changed', access: { allowed: false, revision: 3 } });
    expect(patches).toEqual([true, false]);
    expect(await readStudentAppAccess(env, ID)).toMatchObject({ allowed: false, revision: 3 });
  });
  it.each(['replace', 'expire'])('rejects an old ON owner at the grant CAS when the lease is %s', async kind => {
    const originalBatch = local.db.batch;
    let intercepted = false;
    env.GAME_DB = { ...local.db, batch: async statements => {
      if (!intercepted) {
        intercepted = true;
        if (kind === 'replace') local.sqlite.prepare("UPDATE student_app_homework_sync SET lease_token='new-worker' WHERE student_id=?").run(ID);
        else local.sqlite.prepare('UPDATE student_app_homework_sync SET lease_until=0 WHERE student_id=?').run(ID);
      }
      return originalBatch(statements);
    } };
    await expect(on(0)).rejects.toMatchObject({ code: 'access_revision_changed', access: { allowed: false, revision: 0 } });
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM student_app_access_events').get().n).toBe(0);
    expect(patches).toEqual([true]);
  });
  it('can close only its own unchanged entitlement when its lease expired during an uncertain repair', async () => {
    await writeStudentAppAccess(env, ID, { allowed: true, expectedRevision: 0 });
    patchHook = async () => { local.sqlite.prepare('UPDATE student_app_homework_sync SET lease_until=0 WHERE student_id=?').run(ID); };
    losePatch = 'apply';
    await expect(on(1)).rejects.toMatchObject({ access: { allowed: false, revision: 2 }, sync: { state: 'unknown' } });
  });
  it('allows a definite setup rejection to be retried explicitly without a grant', async () => {
    rejectPatch = 400;
    await expect(on(0)).rejects.toMatchObject({ code: 'student_app_sync_failed', access: { allowed: false, revision: 0 }, sync: { state: 'failed' } });
    rejectPatch = null;
    expect(await on(0)).toMatchObject({ access: { allowed: true, revision: 1 } });
    expect(patches).toEqual([true, true]);
  });
  it('strictly refuses missing or wrongly typed VIP properties rather than treating them as false', async () => {
    delete page.properties.VIP;
    await expect(on(0)).rejects.toMatchObject({ code: 'student_app_sync_failed', access: { allowed: false, revision: 0 } });
    page.properties.VIP = { type: 'rich_text', rich_text: [] };
    await expect(off(0)).rejects.toMatchObject({ access: { allowed: false, revision: 1 }, sync: { ready: false } });
    expect(patches).toEqual([]);
  });
  it('rechecks the revision after an idempotent replay waits for Notion', async () => {
    await on(0);
    getHook = async () => {
      const original = structuredClone(page);
      getHook = null;
      await writeStudentAppAccess(env, ID, { allowed: false, expectedRevision: 1 });
      return Response.json(original);
    };
    await expect(on(0)).rejects.toMatchObject({ code: 'access_revision_changed', access: { allowed: false, revision: 2 } });
    expect(patches).toEqual([true]);
  });
});
