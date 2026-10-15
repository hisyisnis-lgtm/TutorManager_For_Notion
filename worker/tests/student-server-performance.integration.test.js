import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import worker from '../src/index.js';
import { signTypedToken } from '../lib/auth.js';
import { localD1 } from './helpers/localD1.js';
import { allowSyntheticStudentApps } from './helpers/studentAppFixture.js';

const CODE = 'QAABCD123456', OTHER_CODE = 'QAOTHER12345';
const STUDENT = '11111111-1111-4111-8111-111111111111';
const OTHER_STUDENT = '22222222-2222-4222-8222-222222222222';
const STUDENT_DB = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';
const PAYMENT_DB = '314838fa-f2a6-8154-935b-edd3d2fbea83';
const CLASS_DB = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';
const NOTICE_DB = 'f93b423b-8ab0-493b-bdf3-78fde6ec430f';
const SECRET = 'synthetic-student-server-performance-secret';
const normalized = id => id.replaceAll('-', '').toLowerCase();
let database, env, tokens, calls, sqlExecutions, permissionReads, hook;

// Count actual execution, rather than prepare/bind, while retaining the real SQL.
function measuredD1(db) {
  function measure(statement, sql) {
    const execute = method => async (...args) => {
      sqlExecutions.push({ sql, method });
      if (/^SELECT \* FROM student_app_access WHERE student_id=/.test(sql)) permissionReads++;
      return statement[method](...args);
    };
    return {
      bind: (...args) => measure(statement.bind(...args), sql),
      first: execute('first'), all: execute('all'), run: execute('run'),
    };
  }
  return { prepare: sql => measure(db.prepare(sql), sql), batch: statements => db.batch(statements) };
}
function revoke(studentId = STUDENT) {
  database.sqlite.prepare("UPDATE student_app_access SET allowed=0,revision=revision+1,revoked_at='fixture',revoked_by='fixture' WHERE student_id=?")
    .run(normalized(studentId));
}
const send = (studentId = STUDENT, operation = 'booking/student') => worker.fetch(new Request(`https://audit.invalid/${operation}/${studentId === STUDENT ? CODE : OTHER_CODE}`, {
  headers: { Origin: 'http://localhost:5173', Authorization: `Bearer ${tokens.get(studentId)}` },
}), env, { waitUntil: promise => promise.catch(() => {}) });

beforeEach(async () => {
  database = localD1(); allowSyntheticStudentApps(database, [STUDENT, OTHER_STUDENT]);
  calls = []; sqlExecutions = []; permissionReads = 0; hook = null;
  env = { GAME_DB: measuredD1(database.db), JWT_SECRET: SECRET, NOTION_TOKEN: 'fixture-only' };
  tokens = new Map([
    [STUDENT, await signTypedToken(SECRET, 'student', `personal:${CODE}`, 600)],
    [OTHER_STUDENT, await signTypedToken(SECRET, 'student', `personal:${OTHER_CODE}`, 600)],
  ]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (raw, init = {}) => {
    const url = new URL(raw), body = JSON.parse(init.body || '{}');
    if (url.origin !== 'https://api.notion.com') throw new Error('Unmocked external request denied');
    const call = { path: url.pathname, body, permissionReadsBeforeFetch: permissionReads };
    calls.push(call);
    const intercepted = await hook?.(call);
    if (intercepted) return intercepted;
    if (url.pathname === `/v1/databases/${STUDENT_DB}/query`) {
      const id = body.filter?.rich_text?.equals === OTHER_CODE ? OTHER_STUDENT : STUDENT;
      return Response.json({ results: [{ id, properties: {
        '이름': { title: [{ plain_text: '합성 검수 학생' }] },
        '공유일': { date: null }, '사용 시간 회차': { rollup: { number: 0 } },
      } }], has_more: false });
    }
    if ([PAYMENT_DB, CLASS_DB, NOTICE_DB].some(id => url.pathname === `/v1/databases/${id}/query`)) {
      return Response.json({ results: [], has_more: false, next_cursor: null });
    }
    throw new Error(`Unexpected synthetic Notion path: ${url.pathname}`);
  }));
});
afterEach(() => { database.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('student upstream authorization performs only necessary current D1 reads', () => {
  it('retains checks before and after each student data fetch without an extra wrapper-start check', async () => {
    const response = await send();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ paidHours: 0, remainingSessions: 0 });
    // One grant at the identity gate and three wrapper calls, each checked before and after fetch.
    expect(permissionReads).toBe(7);
    expect(calls.map(call => call.permissionReadsBeforeFetch)).toEqual([0, 2, 5, 5]);
    expect(calls).toHaveLength(4); // Identity gate, detail identity, payments, classes.
    if (process.env.STUDENT_SERVER_MEASUREMENT_FILE) {
      writeFileSync(process.env.STUDENT_SERVER_MEASUREMENT_FILE, JSON.stringify({
        fixture: true, route: '/booking/student/:syntheticCode',
        totalSqlExecutions: sqlExecutions.length, studentGrantSelects: permissionReads,
        notionFetches: calls.length, permissionReadsBeforeEachFetch: calls.map(call => call.permissionReadsBeforeFetch),
        source: 'worker/tests/student-server-performance.integration.test.js',
        operationalLatencyMeasured: false, operationalCostMeasured: false,
      }, null, 2) + '\n', 'utf8');
    }
  });

  it('does not return business data revoked while the final class fetch is in flight', async () => {
    hook = call => { if (call.path === `/v1/databases/${CLASS_DB}/query`) revoke(); };
    const response = await send();
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty('timeLedger');
    expect(calls).toHaveLength(4);
  });

  it('checks a revoked grant again before retrying after upstream backoff', async () => {
    hook = call => {
      if (call.path === `/v1/databases/${NOTICE_DB}/query`) {
        revoke();
        return Response.json({ object: 'error', status: 503 }, { status: 503 });
      }
    };
    const response = await send(STUDENT, 'notice/student');
    expect(response.status).toBe(403);
    expect(calls.filter(call => call.path === `/v1/databases/${NOTICE_DB}/query`)).toHaveLength(1);
    expect(await response.json()).not.toHaveProperty('timeLedger');
  });

  it('fails closed before calling upstream when the next current permission read fails', async () => {
    const originalPrepare = env.GAME_DB.prepare;
    hook = call => {
      if (call.path === `/v1/databases/${STUDENT_DB}/query` && calls.length === 2) {
        env.GAME_DB.prepare = sql => /^SELECT \* FROM student_app_access WHERE student_id=/.test(sql)
          ? { bind: () => ({ first: async () => { throw new Error('Synthetic D1 unavailable'); } }) }
          : originalPrepare(sql);
      }
    };
    expect((await send()).status).toBe(503);
    expect(calls).toHaveLength(2);
  });

  it('keeps permission and relation scopes separate between successive student requests', async () => {
    expect((await send()).status).toBe(200);
    revoke(); calls = [];
    expect((await send(OTHER_STUDENT)).status).toBe(200);
    expect(calls.filter(call => [PAYMENT_DB, CLASS_DB].some(id => call.path === `/v1/databases/${id}/query`))
      .every(call => call.body.filter?.relation?.contains === OTHER_STUDENT)).toBe(true);
    calls = [];
    expect((await send()).status).toBe(403);
    expect(calls).toHaveLength(1); // Authorization identity only, no business data.
  });
});
