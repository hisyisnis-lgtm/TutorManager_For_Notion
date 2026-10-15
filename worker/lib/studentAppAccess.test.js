import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { StudentAppAccessError, readStudentAppAccess, requireStudentAppAccess, writeStudentAppAccess } from './studentAppAccess.js';
import { siteD1 } from '../tests/helpers/siteD1.js';
import { createStudentAppAccessPlan, createStudentAppAccessRollback, studentAppAccessPlanSql, syntheticStudentAppSnapshot } from '../../02_devtools/student-app-access-plan.mjs';

const STUDENT = '11111111-1111-4111-8111-111111111111', ID = STUDENT.replaceAll('-', '');
const OTHER = '22222222-2222-4222-8222-222222222222';
const migration = readFileSync(new URL('../migrations/0011_student_app_access.sql', import.meta.url), 'utf8');
let local, env;
beforeEach(() => { local = siteD1(); local.sqlite.exec(migration); env = { GAME_DB: local.db }; });
afterEach(() => local.close());
const change = (allowed, expectedRevision, extra = {}) => writeStudentAppAccess(env, STUDENT, { allowed, expectedRevision, ...extra });

describe('student-app access uses current explicit grants', () => {
  it('defaults to denial without inventing a grant and normalizes UUIDs', async () => {
    expect(await readStudentAppAccess(env, STUDENT.toUpperCase())).toMatchObject({ studentId: ID, allowed: false, revision: 0 });
    await expect(requireStudentAppAccess(env, STUDENT)).rejects.toMatchObject({ status: 403, code: 'student_app_not_provided' });
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM student_app_access').get().n).toBe(0);
  });
  it('rechecks allow, revoke and regrant with increasing revisions and an audit', async () => {
    expect(await change(true, 0)).toMatchObject({ allowed: true, revision: 1, grantedBy: 'teacher' });
    expect(await requireStudentAppAccess(env, ID)).toMatchObject({ allowed: true, revision: 1 });
    expect(await change(false, 1)).toMatchObject({ allowed: false, revision: 2, revokedBy: 'teacher' });
    await expect(requireStudentAppAccess(env, ID)).rejects.toMatchObject({ status: 403 });
    expect(await change(true, 2)).toMatchObject({ allowed: true, revision: 3, revokedAt: null, revokedBy: null });
    expect(local.sqlite.prepare('SELECT revision,allowed FROM student_app_access_events ORDER BY revision').all()).toEqual([
      { revision: 1, allowed: 1 }, { revision: 2, allowed: 0 }, { revision: 3, allowed: 1 },
    ]);
  });
  it('rejects stale writes, absent nonzero versions and concurrent stale requests', async () => {
    await expect(change(true, 1)).rejects.toMatchObject({ status: 409 });
    const results = await Promise.allSettled([change(true, 0), change(false, 0)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected').reason).toMatchObject({ status: 409 });
    await expect(change(false, 0)).rejects.toMatchObject({ status: 409 });
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM student_app_access_events').get().n).toBe(1);
  });
  it('rolls back the access change if its audit fails', async () => {
    local.sqlite.exec("CREATE TRIGGER reject_access_audit BEFORE INSERT ON student_app_access_events BEGIN SELECT RAISE(ABORT,'private SQL detail'); END;");
    await expect(change(true, 0)).rejects.toMatchObject({ status: 503, code: 'student_app_unavailable' });
    expect(await readStudentAppAccess(env, ID)).toMatchObject({ allowed: false, revision: 0 });
  });
  it('fails closed for missing bindings, schema and corrupt stored states without raw errors', async () => {
    await expect(readStudentAppAccess({}, ID)).rejects.toMatchObject({ status: 503 });
    local.sqlite.exec('DROP TABLE student_app_access_events; DROP TABLE student_app_access;');
    const failure = await readStudentAppAccess(env, ID).catch(error => error);
    expect(failure).toBeInstanceOf(StudentAppAccessError); expect(failure.status).toBe(503);
    expect(failure.message).not.toMatch(/no such table|SQL|student_app_access/);
    await expect(readStudentAppAccess({ GAME_DB: { prepare: () => ({ bind: () => ({ first: async () => ({ student_id: ID, allowed: 1, revision: 0 }) }) }) } }, ID)).rejects.toMatchObject({ status: 503 });
  });
  it('rejects invalid identifiers/input before storage and preserves the seed source on manual actions', async () => {
    await expect(readStudentAppAccess(env, 'not-a-student')).rejects.toMatchObject({ status: 400 });
    await expect(change('true', 0)).rejects.toMatchObject({ status: 400 });
    await expect(change(true, -1)).rejects.toMatchObject({ status: 400 });
    await change(true, 0, { sourceBatch: 'fixture-batch' });
    expect(await change(false, 1)).toMatchObject({ sourceBatch: 'fixture-batch', revision: 2 });
  });
});

describe('offline synthetic VIP seed and guarded rollback', () => {
  const options = { batchId: 'synthetic-fixture', actor: 'fixture-operator', at: '2026-10-07T00:00:00.000Z' };
  const rows = () => local.sqlite.prepare('SELECT * FROM student_app_access').all();
  it('seeds only a captured VIP, remains idempotent and leaves non-VIP denied', async () => {
    const plan = createStudentAppAccessPlan(syntheticStudentAppSnapshot(), [], options);
    expect(plan.changes).toHaveLength(1); expect(plan.skipped[0].reason).toBe('non_vip_default_deny');
    local.sqlite.exec(studentAppAccessPlanSql(plan)); local.sqlite.exec(studentAppAccessPlanSql(plan));
    expect(await requireStudentAppAccess(env, ID)).toMatchObject({ revision: 1, sourceBatch: options.batchId });
    await expect(requireStudentAppAccess(env, OTHER)).rejects.toMatchObject({ status: 403 });
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM student_app_access_events').get().n).toBe(1);
    expect(createStudentAppAccessPlan(syntheticStudentAppSnapshot(), rows(), options).changes).toEqual([]);
  });
  it('preserves earlier and concurrent manual revocations instead of automatically regranting', async () => {
    const plan = createStudentAppAccessPlan(syntheticStudentAppSnapshot(), [], options);
    await change(false, 0); local.sqlite.exec(studentAppAccessPlanSql(plan));
    expect(await readStudentAppAccess(env, ID)).toMatchObject({ allowed: false, revision: 1, sourceBatch: null });
    expect(createStudentAppAccessPlan(syntheticStudentAppSnapshot(), rows(), options).changes).toEqual([]);
  });
  it('rolls back only unchanged batch grants, records revocation and is idempotent', async () => {
    const seed = createStudentAppAccessPlan(syntheticStudentAppSnapshot(), [], options);
    local.sqlite.exec(studentAppAccessPlanSql(seed));
    const rollback = createStudentAppAccessRollback(seed, rows(), { ...options, batchId: 'fixture-rollback' });
    local.sqlite.exec(studentAppAccessPlanSql(rollback)); local.sqlite.exec(studentAppAccessPlanSql(rollback));
    expect(await readStudentAppAccess(env, ID)).toMatchObject({ allowed: false, revision: 2, sourceBatch: options.batchId });
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM student_app_access_events').get().n).toBe(2);
  });
  it('preserves manual changes made before or after the rollback plan', async () => {
    const seed = createStudentAppAccessPlan(syntheticStudentAppSnapshot(), [], options); local.sqlite.exec(studentAppAccessPlanSql(seed));
    const rollback = createStudentAppAccessRollback(seed, rows(), { ...options, batchId: 'fixture-rollback' });
    await change(false, 1); await change(true, 2);
    local.sqlite.exec(studentAppAccessPlanSql(rollback));
    expect(await readStudentAppAccess(env, ID)).toMatchObject({ allowed: true, revision: 3 });
    expect(createStudentAppAccessRollback(seed, rows(), { ...options, batchId: 'other-rollback' }).changes).toEqual([]);
  });
  it('rejects duplicate students and nonboolean VIP data, safely quotes actor values', () => {
    const snapshot = syntheticStudentAppSnapshot();
    expect(() => createStudentAppAccessPlan({ ...snapshot, students: [...snapshot.students, snapshot.students[0]] }, [], options)).toThrow();
    expect(() => createStudentAppAccessPlan({ ...snapshot, students: [{ studentId: STUDENT, vip: 'true' }] }, [], options)).toThrow();
    const plan = createStudentAppAccessPlan(snapshot, [], { ...options, actor: "x');DROP TABLE student_app_access;--" });
    local.sqlite.exec(studentAppAccessPlanSql(plan)); expect(rows()).toHaveLength(1);
  });
  it('migration is additive and never creates a grant by itself', () => {
    const sqlite = new DatabaseSync(':memory:');
    try { sqlite.exec(migration); sqlite.exec(migration); expect(sqlite.prepare('SELECT COUNT(*) n FROM student_app_access').get().n).toBe(0); }
    finally { sqlite.close(); }
  });
});
