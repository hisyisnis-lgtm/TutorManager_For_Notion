import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { signTypedToken } from '../lib/auth.js';
import { localD1 } from './helpers/localD1.js';

const NOTICE_DB = 'f93b423b-8ab0-493b-bdf3-78fde6ec430f';
const STUDENT_DB = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';
const STUDENT = '22222222-2222-4222-8222-222222222222';
const CLASS_DB = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';
const BLOCKED_DB = '31e838fa-f2a6-81d3-b034-c47a4f0e5f3e';
const PAGE = '11111111-1111-1111-1111-111111111111';
const CODE = 'ABCDEF123456';
const SECRET = 'isolated-notion-failure-test-secret';
const ORIGIN = 'http://localhost:5173';
const SAFE_ERROR = '요청을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.';
const UPSTREAM_DETAIL = 'private-fixture-upstream-details';
const TIME_SLOTS = '/booking/time-slots?date=2026-10-07&skipMinDate=1';
const CONFLICT = '/booking/check-conflict?date=2026-10-07&startTime=10:00&duration=60';
let database, env, teacherToken, studentToken, currentPage, calls, respond, background;

function noticePage() {
  return {
    object: 'page', id: PAGE, parent: { database_id: NOTICE_DB },
    properties: {
      '제목': { title: [{ plain_text: 'Fixture notice' }] },
      '내용': { rich_text: [{ plain_text: 'Fixture content' }] },
      '게시일': { date: { start: '2026-10-07T09:00:00Z' } },
      '노출': { checkbox: true }, '중요': { checkbox: false },
    },
  };
}

const queryPath = db => `/v1/databases/${db}/query`;
const rejected = status => Response.json({ object: 'error', status, message: UPSTREAM_DETAIL }, { status });
const emptyList = () => Response.json({ object: 'list', results: [], has_more: false, next_cursor: null });
function normalResponse(call) {
  if (call.method === 'POST' && call.path === queryPath(STUDENT_DB)) return Response.json({ object: 'list',
    results: [{ object: 'page', id: STUDENT, parent: { database_id: STUDENT_DB }, properties: { '예약 코드': { rich_text: [{ plain_text: CODE }] } } }],
    has_more: false, next_cursor: null });
  if (call.method === 'POST' && /^\/v1\/databases\/[^/]+\/query$/.test(call.path)) return emptyList();
  if (call.path === `/v1/pages/${PAGE}` && (call.method === 'GET' || call.method === 'PATCH')) return Response.json(currentPage);
  if (call.path === '/v1/pages' && call.method === 'POST') return Response.json(noticePage());
  throw new Error(`Unexpected mocked Notion request: ${call.method} ${call.path}`);
}

const send = (path, { token = teacherToken, method = 'GET', body } = {}) => worker.fetch(new Request(`https://audit.invalid${path}`, {
  method,
  headers: { Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
}), env, { waitUntil: promise => background.push(promise.catch(() => {})) });

function expectListQueries(role, length) {
  const queries = calls.filter(call => call.path === queryPath(role === 'blocked' ? BLOCKED_DB : NOTICE_DB));
  expect(queries).toHaveLength(length);
  expect(calls.filter(call => call.path === queryPath(STUDENT_DB))).toHaveLength(role === 'student' ? 1 : 0);
  expect(calls).toHaveLength(length + (role === 'student' ? 1 : 0));
  return queries;
}

async function expectRejected(response) {
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: SAFE_ERROR });
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(background).toHaveLength(0);
  expect(calls.every(call => call.host === 'api.notion.com')).toBe(true);
}

beforeEach(async () => {
  database = localD1(); calls = []; background = [];
  database.sqlite.exec(readFileSync(new URL('../migrations/0011_student_app_access.sql', import.meta.url), 'utf8'));
  // The signed student fixture is explicitly allowed; production still defaults to denial.
  database.sqlite.prepare('INSERT INTO student_app_access(student_id,allowed,revision,granted_at,granted_by,last_operation_id) VALUES(?,1,1,?,?,?)')
    .run(STUDENT.replaceAll('-', ''), new Date().toISOString(), 'fixture-teacher', 'fixture-notice-grant');
  env = { GAME_DB: database.db, JWT_SECRET: SECRET, NOTION_TOKEN: 'synthetic-notion-token' };
  teacherToken = await signTypedToken(SECRET, 'teacher', 'teacher', 600, { role: 'teacher' });
  studentToken = await signTypedToken(SECRET, 'student', `personal:${CODE}`, 600);
  currentPage = noticePage(); respond = normalResponse;
  // Every fetch is intercepted. No live API or notification relay can be reached.
  vi.stubGlobal('fetch', vi.fn(async (raw, init = {}) => {
    const url = new URL(typeof raw === 'string' ? raw : raw.url);
    const call = { host: url.hostname, path: url.pathname, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    if (url.hostname !== 'api.notion.com') throw new Error('Non-mocked network denied');
    return respond(call);
  }));
});

afterEach(async () => {
  await Promise.allSettled(background);
  database.close(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('notice and booking reject upstream failures with isolated Notion and SQLite', () => {
  it.each(['teacher', 'student'])('does not turn a rejected first notice page into an empty %s list', async role => {
    respond = call => call.path === queryPath(NOTICE_DB) ? rejected(400) : normalResponse(call);
    await expectRejected(await send(role === 'student' ? `/notice/student/${CODE}` : '/notice', {
      token: role === 'student' ? studentToken : teacherToken,
    }));
    expectListQueries(role, 1);
  });

  it.each(['teacher', 'student'])('discards partial notices if a later %s query page is rejected', async role => {
    respond = call => call.path === queryPath(NOTICE_DB)
      ? call.body.start_cursor
        ? rejected(403)
        : Response.json({ object: 'list', results: [noticePage()], has_more: true, next_cursor: 'fixture-next-page' })
      : normalResponse(call);
    await expectRejected(await send(role === 'student' ? `/notice/student/${CODE}` : '/notice', {
      token: role === 'student' ? studentToken : teacherToken,
    }));
    const queries = expectListQueries(role, 2);
    expect(queries[1].body.start_cursor).toBe('fixture-next-page');
  });

  it.each([
    ['POST', '/notice', 400],
    ['PATCH', `/notice/${PAGE}`, 400],
    ['DELETE', `/notice/${PAGE}`, 403],
  ])('does not report a rejected notice %s as saved or deleted', async (method, route, status) => {
    const writeMethod = method === 'DELETE' ? 'PATCH' : method;
    const writePath = method === 'POST' ? '/v1/pages' : `/v1/pages/${PAGE}`;
    respond = call => call.method === writeMethod && call.path === writePath ? rejected(status) : normalResponse(call);
    await expectRejected(await send(route, { method, ...(method !== 'DELETE' ? { body: { title: 'Fixture notice', content: 'Fixture content' } } : {}) }));
    expect(calls.filter(call => call.method === writeMethod && call.path === writePath)).toHaveLength(1);
  });

  it.each([
    ['PATCH', `/notice/${PAGE}`],
    ['DELETE', `/notice/${PAGE}`],
    ['DELETE', `/booking/blocked/${PAGE}`],
  ])('reports failed scope lookup for %s %s as upstream failure without writing', async (method, route) => {
    respond = call => call.method === 'GET' ? rejected(403) : normalResponse(call);
    await expectRejected(await send(route, { method, ...(method === 'PATCH' ? { body: { title: 'Fixture notice' } } : {}) }));
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
  });

  it.each([CLASS_DB, BLOCKED_DB])('does not advertise available slots when database %s refuses its query', async db => {
    respond = call => call.path === queryPath(db) ? rejected(400) : normalResponse(call);
    await expectRejected(await send(TIME_SLOTS));
    expect(calls.filter(call => call.path === queryPath(db))).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it('does not report conflict false when its class query is rejected', async () => {
    respond = call => call.path === queryPath(CLASS_DB) ? rejected(403) : normalResponse(call);
    await expectRejected(await send(CONFLICT));
    expect(calls).toHaveLength(1);
  });

  it('does not turn a rejected blocked-date query into an empty list', async () => {
    respond = call => call.path === queryPath(BLOCKED_DB) ? rejected(400) : normalResponse(call);
    await expectRejected(await send('/booking/blocked'));
    expect(calls).toHaveLength(1);
  });

  it.each([
    ['POST', '/booking/blocked', 400],
    ['DELETE', `/booking/blocked/${PAGE}`, 403],
  ])('does not report a rejected blocked-date %s as saved or deleted', async (method, route, status) => {
    currentPage.parent.database_id = BLOCKED_DB;
    const writeMethod = method === 'DELETE' ? 'PATCH' : 'POST';
    const writePath = method === 'POST' ? '/v1/pages' : `/v1/pages/${PAGE}`;
    respond = call => call.method === writeMethod && call.path === writePath ? rejected(status) : normalResponse(call);
    await expectRejected(await send(route, { method, ...(method === 'POST' ? { body: { type: '일회성', start: '2026-10-07' } } : {}) }));
    expect(calls.filter(call => call.method === writeMethod && call.path === writePath)).toHaveLength(1);
  });

  it.each(['non-json', 'error-object'])('rejects a malformed accepted query response (%s) instead of an empty success', async variant => {
    respond = () => variant === 'non-json'
      ? new Response(UPSTREAM_DETAIL, { status: 200 })
      : Response.json({ object: 'error', status: 400, message: UPSTREAM_DETAIL });
    await expectRejected(await send('/notice'));
    expect(calls).toHaveLength(1);
  });

  it.each(['teacher', 'student', 'blocked'])('preserves a successful genuine empty %s list', async role => {
    const route = role === 'student' ? `/notice/student/${CODE}` : role === 'blocked' ? '/booking/blocked' : '/notice';
    const response = await send(route, { token: role === 'student' ? studentToken : teacherToken });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expectListQueries(role, 1);
  });

  it.each(['POST', 'PATCH', 'DELETE'])('keeps an accepted notice %s successful', async method => {
    const response = await send(method === 'POST' ? '/notice' : `/notice/${PAGE}`, {
      method, ...(method !== 'DELETE' ? { body: { title: 'Fixture notice', content: 'Fixture content' } } : {}),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject(method === 'DELETE' ? { ok: true } : { id: PAGE, title: 'Fixture notice', content: 'Fixture content' });
    const write = calls.find(call => call.method === (method === 'DELETE' ? 'PATCH' : method));
    expect(write.body).toMatchObject(method === 'DELETE'
      ? { archived: true }
      : { properties: { '제목': { title: [{ text: { content: 'Fixture notice' } }] } } });
  });

  it('keeps actual empty scheduling data available and conflict-free', async () => {
    const slotsResponse = await send(TIME_SLOTS);
    expect(slotsResponse.status).toBe(200);
    const slots = await slotsResponse.json();
    expect(slots.available).toHaveLength(27);
    expect(slots.passable).toEqual(slots.available);
    expect(slots.busyIntervals).toEqual([]);
    const conflictResponse = await send(CONFLICT);
    expect(conflictResponse.status).toBe(200);
    expect(await conflictResponse.json()).toEqual({ conflict: false });
  });

  it.each(['/notice', `/notice/student/${CODE}`, TIME_SLOTS, CONFLICT, '/booking/blocked'])('requires authentication before Notion access for %s', async route => {
    expect((await send(route, { token: null })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it.each([`/notice/${PAGE}`, `/booking/blocked/${PAGE}`])('preserves database ownership rejection for %s', async route => {
    currentPage.parent.database_id = CLASS_DB;
    expect((await send(route, { method: 'DELETE' })).status).toBe(403);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
  });
});
