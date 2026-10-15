import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signTypedToken } from '../lib/auth.js';
import { localD1 } from './helpers/localD1.js';

// Only the coordinator is intercepted: JWT, CORS, body validation and Notion
// ownership checks run through the production Worker without any live network.
vi.mock('../lib/lessonLogs.js', () => ({
  runLessonLogAutomation: vi.fn(),
  handleLessonLogRequest: vi.fn(),
}));
import { handleLessonLogRequest } from '../lib/lessonLogs.js';
import worker from '../src/index.js';

const LOG_DB = '318838fa-f2a6-81f1-9b9c-fd379b1026ed';
const LOG = '11111111-1111-4111-8111-111111111111';
const CLASS = '22222222-2222-4222-8222-222222222222';
const OUTSIDE_DB = '33333333-3333-4333-8333-333333333333';
const ORIGIN = 'http://localhost:5173';
const SECRET = 'isolated-lesson-log-proxy-fixture-secret';
let database, env, teacher, currentPage, calls, background, scopeResponse;

const createBody = () => ({
  parent: { database_id: LOG_DB },
  properties: {
    '제목': { title: [{ text: { content: '격리된 수업 일지' } }] },
    '수업': { relation: [{ id: CLASS }] },
  },
});

function send(path, { method = 'GET', body, token = teacher, rawBody, origin = ORIGIN } = {}) {
  return worker.fetch(new Request(`https://audit.invalid${path}`, {
    method,
    headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((body !== undefined || rawBody !== undefined) ? { 'Content-Type': 'application/json' } : {}) },
    ...((body !== undefined || rawBody !== undefined) ? { body: rawBody ?? JSON.stringify(body) } : {}),
  }), env, { waitUntil: promise => background.push(promise) });
}

function expectProtected(response) {
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  expect(response.headers.get('Vary')).toContain('Origin');
  expect(response.headers.get('Content-Type')).toContain('application/json');
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(response.headers.get('Cache-Control')).toContain('no-store');
}

beforeEach(async () => {
  database = localD1(); calls = []; background = []; scopeResponse = undefined;
  env = { GAME_DB: database.db, JWT_SECRET: SECRET, NOTION_TOKEN: 'synthetic-lesson-log-notion',
    LESSON_LOG_AUTOMATION_ENABLED: 'true' };
  teacher = await signTypedToken(SECRET, 'teacher', 'teacher', 600, { role: 'teacher' });
  currentPage = { object: 'page', id: LOG, parent: { database_id: LOG_DB }, archived: false,
    properties: { '수업': { relation: [{ id: CLASS }] }, '제목': { title: [{ plain_text: '격리된 수업 일지' }] } } };
  handleLessonLogRequest.mockReset();
  handleLessonLogRequest.mockResolvedValue(null);
  vi.stubGlobal('fetch', vi.fn(async (raw, init = {}) => {
    if (init.redirect === 'error') throw new TypeError('Unsupported redirect mode: error');
    const url = new URL(typeof raw === 'string' ? raw : raw.url);
    const call = { host: url.hostname, path: url.pathname, method: init.method || 'GET',
      ...(init.body ? { body: JSON.parse(init.body) } : {}) };
    calls.push(call);
    if (url.hostname !== 'api.notion.com') throw new Error('Non-mocked network denied');
    if (call.path === `/v1/pages/${LOG}` && call.method === 'GET') return scopeResponse || Response.json(currentPage);
    if (call.path === `/v1/pages/${LOG}` && call.method === 'PATCH') return Response.json({ ...currentPage, ...call.body });
    if (call.path === '/v1/pages' && call.method === 'POST') return Response.json({ ...currentPage, ...call.body }, { status: 201 });
    throw new Error(`Unexpected mocked Notion request: ${call.method} ${call.path}`);
  }));
});

afterEach(async () => {
  await Promise.allSettled(background);
  database.close(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('인증된 Notion 프록시는 수업 일지 쓰기를 공유 조정자로 보낸다', () => {
  it.each([200, 201])('일지 생성 응답 %s의 페이지 원형과 CORS를 보존한다', async status => {
    const body = createBody();
    const result = { ...currentPage, created_time: '2026-10-08T01:00:00.000Z', url: 'https://notion.fixture.invalid/log',
      properties: { ...currentPage.properties, '저장 내용': { rich_text: [{ plain_text: '강사가 쓴 내용' }] } } };
    handleLessonLogRequest.mockResolvedValue({ status, body: result, headers: {} });
    const response = await send('/v1/pages', { method: 'POST', body });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(result);
    expectProtected(response);
    expect(handleLessonLogRequest).toHaveBeenCalledOnce();
    const [coordinatorEnv, options] = handleLessonLogRequest.mock.calls[0];
    expect(coordinatorEnv).toBe(env);
    expect(options).toMatchObject({ method: 'POST', body });
    expect(options.page).toBeUndefined();
    expect(options).not.toHaveProperty('url');
    expect(calls).toEqual([]);
  });

  it('일지 삭제에 권한 확인으로 읽은 현재 페이지를 전달하고 추가 조회를 하지 않는다', async () => {
    const body = { archived: true };
    const archivedPage = { ...currentPage, archived: true };
    handleLessonLogRequest.mockResolvedValue({ status: 200, body: archivedPage, headers: {} });
    const response = await send(`/v1/pages/${LOG}`, { method: 'PATCH', body });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(archivedPage);
    expectProtected(response);
    expect(handleLessonLogRequest).toHaveBeenCalledExactlyOnceWith(env, { method: 'PATCH', body, page: currentPage });
    expect(calls).toEqual([{ host: 'api.notion.com', path: `/v1/pages/${LOG}`, method: 'GET' }]);
  });

  it('조정 대상이 아닌 일반 본문 수정은 기존 Notion 프록시로 한 번만 전달한다', async () => {
    const body = { properties: { '오늘의 피드백': { rich_text: [{ text: { content: '수동 작성 내용' } }] } } };
    const response = await send(`/v1/pages/${LOG}`, { method: 'PATCH', body });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject(body);
    expectProtected(response);
    expect(handleLessonLogRequest).toHaveBeenCalledExactlyOnceWith(env, { method: 'PATCH', body, page: currentPage });
    expect(calls.map(call => call.method)).toEqual(['GET', 'PATCH']);
    expect(calls[1].body).toEqual(body);
  });

  it.each([
    ['POST', '/v1/pages', () => createBody()],
    ['PATCH', `/v1/pages/${LOG}`, () => ({ archived: true })],
  ])('비활성 상태의 %s는 기존 프록시로 전달한다', async (method, path, buildBody) => {
    env.LESSON_LOG_AUTOMATION_ENABLED = 'false';
    const body = buildBody();
    const response = await send(path, { method, body });
    expect(response.status).toBe(method === 'POST' ? 201 : 200);
    expect(await response.json()).toMatchObject(body);
    expectProtected(response);
    expect(handleLessonLogRequest).not.toHaveBeenCalled();
    expect(calls.map(call => call.method)).toEqual(method === 'POST' ? ['POST'] : ['GET', 'PATCH']);
  });

  it('읽기 요청은 조정자를 호출하지 않고 권한 확인 페이지를 반환한다', async () => {
    const response = await send(`/v1/pages/${LOG}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(currentPage);
    expect(handleLessonLogRequest).not.toHaveBeenCalled();
    expect(calls.map(call => call.method)).toEqual(['GET']);
  });

  it.each([null, 'forged-fixture-token'])('유효하지 않은 강사 인증은 생성 경로에 도달하지 않는다 (%s)', async token => {
    const response = await send('/v1/pages', { method: 'POST', body: createBody(), token });
    expect(response.status).toBe(401);
    expect(handleLessonLogRequest).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('유효한 학생 토큰도 강사 일지 생성 권한으로 사용하지 않는다', async () => {
    const token = await signTypedToken(SECRET, 'student', 'personal:FIXTURE123', 600);
    const response = await send('/v1/pages', { method: 'POST', body: createBody(), token });
    expect(response.status).toBe(401);
    expect(handleLessonLogRequest).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it.each([
    { database_id: OUTSIDE_DB },
    { page_id: LOG },
    { database_id: LOG_DB, page_id: LOG },
  ])('허용되지 않은 생성 상위 페이지는 쓰기 전에 차단한다 (%j)', async parent => {
    const response = await send('/v1/pages', { method: 'POST', body: { ...createBody(), parent } });
    expect(response.status).toBe(403);
    expect(handleLessonLogRequest).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('읽은 페이지가 다른 DB에 있으면 조정자를 호출하거나 삭제하지 않는다', async () => {
    currentPage.parent.database_id = OUTSIDE_DB;
    const response = await send(`/v1/pages/${LOG}`, { method: 'PATCH', body: { archived: true } });
    expect(response.status).toBe(403);
    expect(handleLessonLogRequest).not.toHaveBeenCalled();
    expect(calls.map(call => call.method)).toEqual(['GET']);
  });

  it.each([[404, 404], [403, 502]])('페이지 권한 조회가 %s이면 %s로 차단한다', async (upstream, expected) => {
    scopeResponse = Response.json({ object: 'error', status: upstream, message: 'fixture-only-notion-detail' }, { status: upstream });
    const response = await send(`/v1/pages/${LOG}`, { method: 'PATCH', body: { archived: true } });
    expect(response.status).toBe(expected);
    expect(handleLessonLogRequest).not.toHaveBeenCalled();
    expect(calls.map(call => call.method)).toEqual(['GET']);
  });

  it.each([409, 503])('조정자의 %s 응답과 재시도 안내를 보존하고 Notion 생성으로 우회하지 않는다', async status => {
    const result = { error: status === 409 ? '다른 요청이 일지를 저장하고 있습니다.' : '잠시 후 다시 시도해주세요.' };
    handleLessonLogRequest.mockResolvedValue({ status, body: result, headers: { 'Retry-After': '3' } });
    const response = await send('/v1/pages', { method: 'POST', body: createBody() });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(result);
    expectProtected(response);
    expect(response.headers.get('Retry-After')).toBe('3');
    expect(response.headers.get('Access-Control-Expose-Headers')).toMatch(/Retry-After/i);
    expect(handleLessonLogRequest).toHaveBeenCalledOnce();
    expect(calls).toEqual([]);
    expect(background).toEqual([]);
  });
});
