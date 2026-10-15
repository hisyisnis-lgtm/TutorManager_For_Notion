import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleLessonLogRequest, LessonLogAutomationError, runLessonLogAutomation } from './lessonLogs.js';
import { localD1 } from '../tests/helpers/localD1.js';

const NOW = Date.parse('2026-10-07T12:00:00.000Z');
const CLASS_DB = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';
const LOG_DB = '318838fa-f2a6-81f1-9b9c-fd379b1026ed';
const LEASE_KEY = 'automation/lesson-logs/v1/lease';
const CURSOR_KEY = 'automation/lesson-logs/v1/cursor';
const CLASS_LEASE_PREFIX = 'automation/lesson-logs/v2/class-lease/';
const CLASS_STATE_PREFIX = 'automation/lesson-logs/v2/class-state/';
const COOLDOWN_KEY = 'automation/lesson-logs/v2/cooldown';
let local;

function lesson(id = 'class-1', options = {}) {
  return {
    object: 'page', id, archived: false, in_trash: false,
    parent: { database_id: CLASS_DB },
    properties: {
      '수업 일시': { date: { start: new Date(NOW - 60 * 60 * 1000).toISOString() } },
      '수업 시간(분)': { select: { name: '60분' } },
      '특이사항': { select: null },
      '수업 일지': { relation: [] },
      '학생': { relation: [{ id: 'student-1' }] },
      ...options.properties,
    },
    ...options.page,
  };
}

function student(id = 'student-1', title = '🟢 테스트학생') {
  return { object: 'page', id, properties: { '이름': { title: [{ plain_text: title }] } } };
}

function list(results = [], has_more = false, next_cursor = null) {
  return { object: 'list', results, has_more, next_cursor };
}

function mockNotion({ lessons = [lesson()], pages = new Map(), existing = new Map(), onRequest } = {}) {
  const created = [];
  const calls = [];
  const fetchMock = vi.fn(async (url, init) => {
    const path = new URL(url).pathname.replace('/v1', '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    const call = { path, method: init.method, body, init, at: Date.now() };
    calls.push(call);
    const override = await onRequest?.(call, { created, calls });
    if (override !== undefined) return override;
    if (path === `/databases/${CLASS_DB}/query`) return Response.json(list(lessons));
    if (path === `/databases/${LOG_DB}/query`) {
      const classId = body.filter.relation.contains;
      return Response.json(list((existing.get(classId) || []).map(log => ({
        parent: { database_id: LOG_DB }, ...log,
        properties: { '수업': { relation: [{ id: classId }] }, ...log.properties },
      }))));
    }
    if (path.startsWith('/pages/')) {
      const id = path.slice('/pages/'.length);
      let value = pages.get(id) ?? lessons.find(item => item.id === id) ?? created.find(item => item.id === id);
      if (!value) {
        for (const [classId, logs] of existing) {
          const log = logs.find(item => item.id === id);
          if (log) value = { parent: { database_id: LOG_DB }, ...log, properties: { '수업': { relation: [{ id: classId }] }, ...log.properties } };
        }
      }
      value ??= student(id);
      if (init.method === 'PATCH') Object.assign(value, body);
      return Response.json(value);
    }
    if (path === '/pages' && init.method === 'POST') {
      const value = { object: 'page', id: `log-${created.length}`, parent: { database_id: LOG_DB }, properties: body.properties };
      created.push(value);
      existing.set(body.properties['수업'].relation[0].id, [value]);
      return Response.json(value);
    }
    throw new Error('Unexpected isolated mock request');
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, created, fetchMock, existing };
}

function env() { return { GAME_DB: local.db, NOTION_TOKEN: 'isolated-notion-token' }; }

function countSql(database = local.db) {
  let count = 0;
  const wrap = statement => ({
    bind: (...values) => wrap(statement.bind(...values)),
    ...Object.fromEntries(['first', 'all', 'run'].map(method => [method, async (...args) => {
      count++;
      return statement[method](...args);
    }])),
  });
  return { database: { prepare: sql => wrap(database.prepare(sql)) }, count: () => count, reset: () => { count = 0; } };
}

// 먼저 rejection을 관찰하여 fake timer가 돌 때 unhandled rejection을 만들지 않는다.
async function execute(environment = env()) {
  const promise = runLessonLogAutomation(environment).then(result => ({ result }), error => ({ error }));
  await vi.runAllTimersAsync();
  const outcome = await promise;
  if (outcome.error) throw outcome.error;
  return outcome.result;
}

function createBody(classId = 'class-1', students = ['student-1']) {
  return {
    parent: { database_id: LOG_DB },
    properties: {
      '제목': { title: [{ text: { content: '수동 작성 제목' } }] },
      '수업': { relation: [{ id: classId }] },
      '학생': { relation: students.map(id => ({ id })) },
    },
  };
}

async function manual(request, environment = env()) {
  const promise = handleLessonLogRequest(environment, request);
  await vi.runAllTimersAsync();
  return promise;
}

beforeEach(() => {
  local = localD1();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  local?.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Worker lesson log automation', () => {
  it('수업 종료 정확한 시각에 KST 날짜·학생·수업 관계를 가진 빈 일지를 생성한다', async () => {
    const api = mockNotion();
    const result = await execute();
    expect(result.created).toBe(1);
    const create = api.calls.find(call => call.path === '/pages');
    expect(create.body).toEqual({
      parent: { database_id: LOG_DB },
      properties: {
        '제목': { title: [{ text: { content: '테스트학생 10/7' } }] },
        '수업': { relation: [{ id: 'class-1' }] },
        '학생': { relation: [{ id: 'student-1' }] },
      },
    });
    expect(create.body.children).toBeUndefined();
    expect(api.calls.every(call => call.init.redirect === 'manual')).toBe(true);
    expect(api.calls.every(call => call.init.headers['Notion-Version'] === '2022-06-28')).toBe(true);
    expect(api.calls.slice(1).every((call, i) => call.at - api.calls[i].at >= 350)).toBe(true);
    expect(local.sqlite.prepare('SELECT * FROM security_challenges WHERE key_hash=?').get(LEASE_KEY)).toBeUndefined();
  });

  it.each([
    ['종료 1ms 전', lesson('class-1', { properties: { '수업 일시': { date: { start: new Date(NOW - 60 * 60 * 1000 + 1).toISOString() } } } })],
    ['취소', lesson('class-1', { properties: { '특이사항': { select: { name: '🚫 취소' } } } })],
    ['기존 연결 일지', lesson('class-1', { properties: { '수업 일지': { relation: [{ id: 'existing' }] } } })],
    ['archived', lesson('class-1', { page: { archived: true } })],
    ['in_trash', lesson('class-1', { page: { in_trash: true } })],
    ['7일보다 오래됨', lesson('class-1', { properties: { '수업 일시': { date: { start: new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString() } } } })],
    ['날짜 없음', lesson('class-1', { properties: { '수업 일시': { date: null } } })],
  ])('%s 수업은 생성하지 않는다', async (_, item) => {
    const api = mockNotion({ lessons: [item] });
    expect(await execute()).toMatchObject({ created: 0, skipped: 1 });
    expect(api.calls).toHaveLength(1);
  });

  it('수업 시간이 비어 있으면 60분을 사용한다', async () => {
    const api = mockNotion({ lessons: [lesson('class-1', { properties: { '수업 시간(분)': { select: null } } })] });
    expect((await execute()).created).toBe(1);
    expect(api.created).toHaveLength(1);
  });

  it('쿼리 이후 취소·시간 변경·일지 연결이 발생하면 최신 페이지에서 제외한다', async () => {
    for (const properties of [
      { '특이사항': { select: { name: '🚫 취소' } } },
      { '수업 일시': { date: { start: new Date(NOW).toISOString() } } },
      { '수업 일지': { relation: [{ id: 'manual-log' }] } },
    ]) {
      const api = mockNotion({ pages: new Map([['class-1', lesson('class-1', { properties })]]) });
      expect((await execute()).created).toBe(0);
      expect(api.calls).toHaveLength(2);
    }
  });

  it('수업 relation이 아직 비어 있어도 LOG DB에서 기존 일지를 찾아 중복을 막는다', async () => {
    const existingLog = { object: 'page', id: 'old-log', properties: {} };
    const api = mockNotion({ existing: new Map([['class-1', [existingLog]]]) });
    expect(await execute()).toMatchObject({ created: 0, existing: 1 });
    expect(api.created).toHaveLength(0);
    expect(api.calls.at(-1).body.filter).toEqual({ property: '수업', relation: { contains: 'class-1' } });
  });

  it('학생이 없거나 이름 title이 비면 기존 title·수업 제목으로 생성한다', async () => {
    const fallbackStudent = { object: 'page', id: 'student-1', properties: { '이름': { title: [] }, '다른 제목': { title: [{ plain_text: '기존 이름' }] } } };
    let api = mockNotion({ pages: new Map([['student-1', fallbackStudent]]) });
    expect((await execute()).created).toBe(1);
    expect(api.created[0].properties['제목'].title[0].text.content).toBe('기존 이름 10/7');
    api = mockNotion({ lessons: [lesson('class-2', { properties: { '학생': { relation: [] } } })] });
    expect((await execute()).created).toBe(1);
    expect(api.created[0].properties['제목'].title[0].text.content).toBe('수업 10/7');
  });

  it('동시 cron은 원자적 lease로 하나만 생성한다', async () => {
    const api = mockNotion();
    const resultPromise = Promise.all([runLessonLogAutomation(env()), runLessonLogAutomation(env())]);
    await vi.runAllTimersAsync();
    const results = await resultPromise;
    expect(results.filter(result => result.locked)).toHaveLength(1);
    expect(results.reduce((sum, result) => sum + result.created, 0)).toBe(1);
    expect(api.created).toHaveLength(1);
  });

  it('만료 lease는 회수하고 다른 소유자의 lease를 finally에서 삭제하지 않는다', async () => {
    local.sqlite.prepare('INSERT INTO security_challenges VALUES(?,?,?,?)').run(LEASE_KEY, 'expired-owner', '{}', Math.floor(NOW / 1000) - 1);
    mockNotion({ lessons: [] });
    expect((await execute()).locked).toBe(false);
    expect(local.sqlite.prepare('SELECT * FROM security_challenges WHERE key_hash=?').get(LEASE_KEY)).toBeUndefined();
    mockNotion({ onRequest: () => {
      local.sqlite.prepare('UPDATE security_challenges SET proof_hash=? WHERE key_hash=?').run('next-owner', LEASE_KEY);
      return new Response('server failed', { status: 503 });
    } });
    await expect(execute()).rejects.toThrow('notion-http-503');
    expect(local.sqlite.prepare('SELECT proof_hash FROM security_challenges WHERE key_hash=?').get(LEASE_KEY).proof_hash).toBe('next-owner');
  });

  it.each([400, 401, 429, 500, 503])('Notion HTTP %s는 실패를 빈 결과로 보고하지 않는다', async status => {
    const api = mockNotion({ onRequest: () => new Response('student name secret token', { status }) });
    await expect(execute()).rejects.toThrow(`notion-http-${status}`);
    expect(api.calls).toHaveLength(1);
    expect(local.sqlite.prepare('SELECT * FROM security_challenges WHERE key_hash=?').get(LEASE_KEY)).toBeUndefined();
  });

  it('네트워크 오류·잘못된 JSON·잘못된 query/page 응답은 성공으로 바꾸지 않는다', async () => {
    const cases = [
      () => { throw new Error('private student and token'); },
      () => new Response('not json'),
      () => Response.json({ results: [] }),
      () => Response.json(list([{ object: 'page', id: 'id-without-properties' }])),
    ];
    for (const onRequest of cases) {
      mockNotion({ onRequest });
      await expect(execute()).rejects.toBeInstanceOf(LessonLogAutomationError);
    }
  });

  it('학생·수업 GET 및 LOG query 오류도 fake success를 만들지 않는다', async () => {
    for (const failurePath of ['/pages/class-1', '/pages/student-1', `/databases/${LOG_DB}/query`]) {
      const api = mockNotion({ onRequest: call => call.path === failurePath ? Response.json({ object: 'error', message: 'PII' }, { status: 500 }) : undefined });
      await expect(execute()).rejects.toThrow('notion-http-500');
      expect(api.created).toHaveLength(0);
    }
  });

  it('15초 timeout 이후 실패하고 lease를 해제한다', async () => {
    mockNotion({ onRequest: call => new Promise((_, reject) => call.init.signal.addEventListener('abort', () => reject(new Error('aborted')))) });
    await expect(execute()).rejects.toThrow('notion-timeout');
    expect(local.sqlite.prepare('SELECT * FROM security_challenges WHERE key_hash=?').get(LEASE_KEY)).toBeUndefined();
  });

  it('POST 생성 응답이 유실돼도 자동 재전송하지 않으며 다음 실행에서 기존 일지를 발견한다', async () => {
    const api = mockNotion({ onRequest: (call, state) => {
      if (call.path === '/pages') {
        const log = { object: 'page', id: 'created-but-lost', properties: call.body.properties };
        state.created.push(log);
        api.existing.set('class-1', [log]);
        throw new Error('response lost with PII');
      }
    } });
    await expect(execute()).rejects.toThrow('notion-request');
    expect(api.calls.filter(call => call.path === '/pages')).toHaveLength(1);
    expect(await execute()).toMatchObject({ created: 0, existing: 1 });
    expect(api.calls.filter(call => call.path === '/pages')).toHaveLength(1);
  });

  it('일부 생성 후 실패하면 다음 실행에서 완료된 일지를 중복 생성하지 않는다', async () => {
    let failed = false;
    const lessons = [lesson('class-1'), lesson('class-2')];
    const api = mockNotion({ lessons, onRequest: call => {
      if (call.path === '/pages/class-2' && !failed) {
        failed = true;
        return new Response('temporary failure', { status: 503 });
      }
    } });
    await expect(execute()).rejects.toThrow('notion-http-503');
    expect(api.created).toHaveLength(1);
    expect(await execute()).toMatchObject({ created: 1, existing: 1 });
    expect(api.created.map(log => log.properties['수업'].relation[0].id)).toEqual(['class-1', 'class-2']);
  });

  it('진행 중 수업 100개 뒤의 완료 수업도 cursor를 이어 다음 실행에서 생성한다', async () => {
    const running = Array.from({ length: 100 }, (_, i) => lesson(`running-${i}`, { properties: { '수업 일시': { date: { start: new Date(NOW).toISOString() } } } }));
    const api = mockNotion({ lessons: [...running, lesson()], onRequest: call => {
      if (call.path === `/databases/${CLASS_DB}/query`) {
        const offset = Number(call.body.start_cursor || 0);
        const pages = [...running, lesson()];
        return Response.json(list(pages.slice(offset, offset + 25), offset + 25 < pages.length, offset + 25 < pages.length ? String(offset + 25) : null));
      }
    } });
    expect(await execute()).toMatchObject({ scanned: 100, created: 0, deferred: 1 });
    expect(JSON.parse(local.sqlite.prepare('SELECT payload FROM security_challenges WHERE key_hash=?').get(CURSOR_KEY).payload)).toEqual({ cursor: '100', pending: [] });
    expect((await execute()).created).toBe(1);
    expect(api.created).toHaveLength(1);
  });

  it('한 번에 최대 5개만 생성하고 같은 페이지에서 남은 완료 수업을 다음 실행에서 처리한다', async () => {
    const lessons = Array.from({ length: 8 }, (_, i) => lesson(`class-${i}`));
    const api = mockNotion({ lessons });
    expect(await execute()).toMatchObject({ created: 5, deferred: 1 });
    expect((await execute()).created).toBe(3);
    expect(api.created).toHaveLength(8);
    expect(api.calls.length).toBeLessThan(50);
  });

  it('앞의 일지 역relation이 미반영되어도 요청 상한에서 남은 IDs를 이어서 완료 수업에 도달한다', async () => {
    const oldLessons = Array.from({ length: 25 }, (_, i) => lesson(`old-${i}`));
    const lessons = [...oldLessons, lesson('class-1')];
    const existing = new Map(oldLessons.map(item => [item.id, [{ object: 'page', id: `log-${item.id}`, properties: {} }]]));
    const api = mockNotion({ lessons, existing, onRequest: call => {
      if (call.path === `/databases/${CLASS_DB}/query`) {
        const offset = Number(call.body.start_cursor || 0);
        return Response.json(list(lessons.slice(offset, offset + 25), offset + 25 < lessons.length, offset + 25 < lessons.length ? String(offset + 25) : null));
      }
    } });
    expect(await execute()).toMatchObject({ created: 0, deferred: 1 });
    const saved = JSON.parse(local.sqlite.prepare('SELECT payload FROM security_challenges WHERE key_hash=?').get(CURSOR_KEY).payload);
    expect(saved.cursor).toBe('25');
    expect(saved.pending.length).toBeGreaterThan(0);
    let created = 0;
    for (let run = 0; run < 3 && !created; run++) created += (await execute()).created;
    expect(created).toBe(1);
    expect(api.created[0].properties['수업'].relation[0].id).toBe('class-1');
    expect(api.calls.filter(call => call.path === `/databases/${CLASS_DB}/query`)).toHaveLength(2);
  });

  it('생성 직전 lease를 잃으면 쓰지 않고 새 소유자의 lease를 보존한다', async () => {
    const api = mockNotion({ onRequest: call => {
      if (call.path === '/pages/student-1') {
        local.sqlite.prepare('UPDATE security_challenges SET proof_hash=? WHERE key_hash=?').run('new-owner', LEASE_KEY);
      }
    } });
    await expect(execute()).rejects.toThrow('lease-unavailable');
    expect(api.created).toHaveLength(0);
    expect(local.sqlite.prepare('SELECT proof_hash FROM security_challenges WHERE key_hash=?').get(LEASE_KEY).proof_hash).toBe('new-owner');
  });

  it('생성 응답의 수업 relation이 불완전하면 성공으로 세지 않고 다음 실행에서 조회한다', async () => {
    const api = mockNotion({ onRequest: call => call.path === '/pages'
      ? Response.json({ object: 'page', id: 'incomplete-log', properties: {} }) : undefined });
    await expect(execute()).rejects.toThrow('invalid-log-relation');
    expect(api.calls.filter(call => call.path === '/pages')).toHaveLength(1);
  });

  it('D1 binding·쿼리·cursor state 실패는 Notion 요청 전에 실패한다', async () => {
    const api = mockNotion();
    await expect(execute({ NOTION_TOKEN: 'isolated' })).rejects.toThrow('missing-binding');
    local.sqlite.prepare('INSERT INTO security_challenges VALUES(?,?,?,?)').run(CURSOR_KEY, 'cursor', 'invalid JSON', Math.floor(NOW / 1000) + 1000);
    await expect(execute()).rejects.toThrow('cursor-unavailable');
    local.sqlite.exec('DROP TABLE security_challenges');
    await expect(execute()).rejects.toThrow('cooldown-unavailable');
    expect(api.calls).toHaveLength(0);
  });
});

describe('D1 Free per-invocation SQL bounds', () => {
  it('정상 5개 자동 생성은 실제 D1 first/all/run 총합이 50회 미만이다', async () => {
    const counted = countSql();
    const environment = { ...env(), GAME_DB: counted.database };
    const api = mockNotion({ lessons: Array.from({ length: 5 }, (_, index) => lesson(`class-${index}`)) });
    expect(await execute(environment)).toMatchObject({ created: 5 });
    expect(counted.count()).toBeLessThan(50);
    expect(counted.count()).toBeLessThanOrEqual(44);
    expect(api.created).toHaveLength(5);
  });

  it('기존 일지가 많으면 SQL 예산 안에서 IDs를 저장하고 다음 실행에서 실제로 이어간다', async () => {
    const counted = countSql();
    const environment = { ...env(), GAME_DB: counted.database };
    const old = Array.from({ length: 50 }, (_, index) => lesson(`old-${index}`));
    const lessons = [...old, lesson('new-class')];
    const existing = new Map(old.map(item => [item.id, [{ object: 'page', id: `log-${item.id}`, properties: {} }]]));
    const api = mockNotion({ lessons, existing, onRequest: call => {
      if (call.path === `/databases/${CLASS_DB}/query`) {
        const offset = Number(call.body.start_cursor || 0);
        const size = call.body.page_size;
        return Response.json(list(lessons.slice(offset, offset + size), offset + size < lessons.length, offset + size < lessons.length ? String(offset + size) : null));
      }
    } });
    let previous = null;
    let made = 0;
    for (let run = 0; run < 10 && !made; run++) {
      counted.reset();
      const result = await execute(environment);
      expect(counted.count()).toBeLessThanOrEqual(44);
      made += result.created;
      const state = JSON.parse(local.sqlite.prepare('SELECT payload FROM security_challenges WHERE key_hash=?').get(CURSOR_KEY).payload);
      if (result.deferred && state.pending.length) {
        const progress = `${state.cursor}:${state.pending[0]}`;
        expect(progress).not.toBe(previous);
        previous = progress;
      }
    }
    expect(made).toBe(1);
    expect(api.created[0].properties['수업'].relation[0].id).toBe('new-class');
  });

  it('조회 직후 취소된 수업이 많아도 잠금 해제와 커서 진행을 포함해 50회를 넘지 않는다', async () => {
    const counted = countSql();
    const environment = { ...env(), GAME_DB: counted.database };
    const lessons = Array.from({ length: 30 }, (_, index) => lesson(`cancelled-${index}`));
    const pages = new Map(lessons.map(item => [item.id, lesson(item.id, { properties: { '특이사항': { select: { name: '🚫 취소' } } } })]));
    const api = mockNotion({ lessons, pages, onRequest: call => {
      if (call.path === `/databases/${CLASS_DB}/query`) {
        const offset = Number(call.body.start_cursor || 0);
        const size = call.body.page_size;
        return Response.json(list(lessons.slice(offset, offset + size), offset + size < lessons.length, offset + size < lessons.length ? String(offset + size) : null));
      }
    } });
    for (let run = 0; run < 4; run++) {
      counted.reset();
      const result = await execute(environment);
      expect(counted.count()).toBeLessThanOrEqual(44);
      expect(result.created).toBe(0);
      const state = JSON.parse(local.sqlite.prepare('SELECT payload FROM security_challenges WHERE key_hash=?').get(CURSOR_KEY).payload);
      if (!state.pending.length && !state.cursor) break;
    }
    expect(new Set(api.calls.filter(call => call.path.startsWith('/pages/')).map(call => call.path)).size).toBe(30);
    expect(api.created).toHaveLength(0);
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM security_challenges WHERE key_hash LIKE ?').get(`${CLASS_LEASE_PREFIX}%`).n).toBe(0);
  });

  it('25개 연결 수업 삭제도 json_each 일괄 잠금·억제·해제로 SQL 50회 미만이다', async () => {
    const counted = countSql();
    const environment = { ...env(), GAME_DB: counted.database };
    const lessons = Array.from({ length: 25 }, (_, index) => lesson(`class-${index}`));
    const log = { object: 'page', id: 'shared-log', parent: { database_id: LOG_DB }, properties: { '수업': { relation: lessons.map(item => ({ id: item.id })) } } };
    const api = mockNotion({ lessons, pages: new Map([['shared-log', log]]) });
    expect((await manual({ method: 'PATCH', page: log, body: { archived: true } }, environment)).status).toBe(200);
    expect(counted.count()).toBeLessThan(50);
    expect(counted.count()).toBeLessThanOrEqual(12);
    expect(api.calls.filter(call => call.method === 'PATCH')).toHaveLength(1);
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM security_challenges WHERE key_hash LIKE ?').get(`${CLASS_STATE_PREFIX}%`).n).toBe(25);
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM security_challenges WHERE key_hash LIKE ?').get(`${CLASS_LEASE_PREFIX}%`).n).toBe(0);
  });
});

describe('manual lesson log interception and shared safeguards', () => {
  it('수동 생성 본문·children을 보존하고 원래 Notion 페이지를 반환한다', async () => {
    const api = mockNotion();
    const body = { ...createBody(), icon: { type: 'emoji', emoji: '📝' }, children: [{ object: 'block', paragraph: { rich_text: [{ text: { content: '직접 작성한 본문' } }] } }] };
    const result = await manual({ method: 'POST', body });
    expect(result.status).toBe(200);
    expect(result.body.object).toBe('page');
    expect(api.calls.find(call => call.path === '/pages').body).toEqual(body);
    expect(result.body).toEqual(api.created[0]);
  });

  it('자동 생성과 수동 생성이 동시에 요청되어도 한 번만 생성한다', async () => {
    const api = mockNotion();
    const promise = Promise.all([runLessonLogAutomation(env()), handleLessonLogRequest(env(), { method: 'POST', body: createBody() })]);
    await vi.runAllTimersAsync();
    const [automatic, requested] = await promise;
    expect(api.created).toHaveLength(1);
    expect(automatic.created + Number(requested.status === 200)).toBe(1);
    expect(requested.status === 200 || requested.status === 423).toBe(true);
  });

  it('동시 수동 생성은 한 번만 생성하고 나머지는 busy 또는 같은 기존 페이지를 반환한다', async () => {
    const api = mockNotion();
    const promises = Array.from({ length: 4 }, () => handleLessonLogRequest(env(), { method: 'POST', body: createBody() }));
    await vi.runAllTimersAsync();
    const results = await Promise.all(promises);
    expect(api.created).toHaveLength(1);
    expect(results.filter(result => result.status === 200)).toHaveLength(1);
    expect(results.filter(result => result.status === 423)).toHaveLength(3);
    expect(results.find(result => result.status === 423).headers['Retry-After']).toBe('3');
    const repeated = await manual({ method: 'POST', body: createBody() });
    expect(repeated.status).toBe(200);
    expect(repeated.body.id).toBe(api.created[0].id);
    expect(api.created).toHaveLength(1);
  });

  it('진행 중·취소된 수업의 명시적 수동 일지 작성은 보존한다', async () => {
    for (const properties of [
      { '수업 일시': { date: { start: new Date(NOW + 60_000).toISOString() } } },
      { '특이사항': { select: { name: '🚫 취소' } } },
    ]) {
      mockNotion({ lessons: [lesson('class-1', { properties })] });
      const result = await manual({ method: 'POST', body: createBody() });
      expect(result.status).toBe(200);
      local.sqlite.prepare('DELETE FROM security_challenges WHERE key_hash LIKE ?').run('automation/lesson-logs/v2/class-%');
    }
  });

  it('CLASS DB 밖의 페이지 또는 학생 relation 불일치에는 생성하지 않는다', async () => {
    let api = mockNotion({ pages: new Map([['class-1', lesson('class-1', { page: { parent: { database_id: LOG_DB } } })]]) });
    expect((await manual({ method: 'POST', body: createBody() })).status).toBe(403);
    expect(api.created).toHaveLength(0);
    api = mockNotion();
    const mismatch = await manual({ method: 'POST', body: createBody('class-1', ['different-student']) });
    expect(mismatch.status).toBe(400);
    expect(api.created).toHaveLength(0);
  });

  it('비일지 요청·본문 수정·수업 연결이 없는 옛 일지는 인터셉트하지 않는다', async () => {
    const api = mockNotion();
    expect(await manual({ method: 'POST', body: { parent: { database_id: CLASS_DB }, properties: {} } })).toBeNull();
    expect(await manual({ method: 'POST', body: { parent: { database_id: LOG_DB }, properties: { '제목': {} } } })).toBeNull();
    expect(await manual({ method: 'PATCH', body: { properties: { '오늘 내용': {} } } })).toBeNull();
    expect(api.calls).toHaveLength(0);
  });

  it('수업 relation이 여러 개이거나 잘못된 URL ID이면 쓰기를 거부한다', async () => {
    const api = mockNotion();
    const body = createBody();
    body.properties['수업'].relation.push({ id: 'another-class' });
    expect((await manual({ method: 'POST', body })).status).toBe(400);
    expect((await manual({ method: 'POST', body: createBody('../databases') })).status).toBe(400);
    expect(api.calls).toHaveLength(0);
  });

  it('class ID의 대시·대소문자 변형에도 같은 수업 잠금을 사용한다', async () => {
    local.sqlite.prepare('INSERT INTO security_challenges VALUES(?,?,?,?)').run(`${CLASS_LEASE_PREFIX}class1`, 'other-owner', '{}', Math.floor(NOW / 1000) + 180);
    const api = mockNotion();
    expect((await manual({ method: 'POST', body: createBody('CLASS-1') })).status).toBe(423);
    expect(api.calls).toHaveLength(0);
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM security_challenges').get().n).toBe(1);
  });

  it('PWA 삭제는 suppression을 먼저 저장해 자동 생성과 동시에 실행되어도 재생성을 막는다', async () => {
    const api = mockNotion();
    const made = await manual({ method: 'POST', body: createBody() });
    const promise = Promise.all([
      handleLessonLogRequest(env(), { method: 'PATCH', page: made.body, body: { archived: true } }),
      runLessonLogAutomation(env()),
    ]);
    await vi.runAllTimersAsync();
    const [removed] = await promise;
    expect(removed.status).toBe(200);
    expect(removed.body.archived).toBe(true);
    expect(api.created).toHaveLength(1);
    expect(await execute()).toMatchObject({ created: 0, skipped: 1 });
    const state = JSON.parse(local.sqlite.prepare('SELECT payload FROM security_challenges WHERE key_hash=?').get(`${CLASS_STATE_PREFIX}class1`).payload);
    expect(state.suppressed).toBe(true);
  });

  it.each([400, 503])('삭제 HTTP %s 실패에도 suppression을 유지하고 오류를 반환한다', async status => {
    const api = mockNotion({ onRequest: call => call.method === 'PATCH' ? new Response('private failure details', { status }) : undefined });
    const made = await manual({ method: 'POST', body: createBody() });
    const deleted = await manual({ method: 'PATCH', page: made.body, body: { in_trash: true } });
    expect(deleted.status).toBe(status);
    expect(deleted.body.message).not.toContain('private');
    expect((await execute()).created).toBe(0);
    expect(api.created).toHaveLength(1);
    const state = JSON.parse(local.sqlite.prepare('SELECT payload FROM security_challenges WHERE key_hash=?').get(`${CLASS_STATE_PREFIX}class1`).payload);
    expect(state.suppressed).toBe(true);
  });

  it('명시적 수동 재작성은 삭제 suppression을 해제하고 새 일지를 만든다', async () => {
    const api = mockNotion();
    const made = await manual({ method: 'POST', body: createBody() });
    expect((await manual({ method: 'PATCH', page: made.body, body: { archived: true } })).status).toBe(200);
    expect((await execute()).created).toBe(0);
    const replaced = await manual({ method: 'POST', body: createBody() });
    expect(replaced.status).toBe(200);
    expect(replaced.body.id).not.toBe(made.body.id);
    expect(api.created).toHaveLength(2);
    const state = JSON.parse(local.sqlite.prepare('SELECT payload FROM security_challenges WHERE key_hash=?').get(`${CLASS_STATE_PREFIX}class1`).payload);
    expect(state.suppressed).toBe(false);
  });

  it('Notion에서 직접 삭제한 추적 일지도 GET archived를 확인해 억제한다', async () => {
    const api = mockNotion();
    expect((await execute()).created).toBe(1);
    api.created[0].archived = true;
    expect(await execute()).toMatchObject({ created: 0, skipped: 1 });
    expect((await execute()).created).toBe(0);
    expect(api.created).toHaveLength(1);
  });

  it('여러 수업에 연결된 삭제는 모든 수업을 검증하고 각각 억제한다', async () => {
    const log = { object: 'page', id: 'shared-log', parent: { database_id: LOG_DB }, properties: { '수업': { relation: [{ id: 'class-1' }, { id: 'class-2' }] } } };
    const api = mockNotion({ lessons: [lesson('class-1'), lesson('class-2')], pages: new Map([['shared-log', log]]) });
    expect((await manual({ method: 'PATCH', page: log, body: { archived: true } })).status).toBe(200);
    const states = local.sqlite.prepare('SELECT payload FROM security_challenges WHERE key_hash LIKE ?').all(`${CLASS_STATE_PREFIX}%`);
    expect(states).toHaveLength(2);
    expect(states.every(row => JSON.parse(row.payload).suppressed)).toBe(true);
    expect((await execute()).created).toBe(0);
    expect(api.created).toHaveLength(0);
  });

  it('보관된 수업·학생 relation has_more가 있는 과거 일지도 삭제할 수 있다', async () => {
    const log = { object: 'page', id: 'old-log', parent: { database_id: LOG_DB }, properties: { '수업': { relation: [{ id: 'class-1' }] } } };
    const previous = lesson('class-1', { page: { archived: true, in_trash: true }, properties: { '학생': { relation: [{ id: 'student-1' }], has_more: true } } });
    mockNotion({ lessons: [previous], pages: new Map([['old-log', log]]) });
    expect((await manual({ method: 'PATCH', page: log, body: { archived: true } })).status).toBe(200);
  });

  it('삭제 연결 수업 검증 실패 또는 다른 수업 잠금이 바쁘면 PATCH하지 않는다', async () => {
    const log = { object: 'page', id: 'shared-log', parent: { database_id: LOG_DB }, properties: { '수업': { relation: [{ id: 'class-1' }, { id: 'class-2' }] } } };
    let api = mockNotion({ lessons: [lesson('class-1'), lesson('class-2', { page: { parent: { database_id: LOG_DB } } })], pages: new Map([['shared-log', log]]) });
    expect((await manual({ method: 'PATCH', page: log, body: { archived: true } })).status).toBe(403);
    expect(api.calls.filter(call => call.method === 'PATCH')).toHaveLength(0);
    local.sqlite.prepare('INSERT INTO security_challenges VALUES(?,?,?,?)').run(`${CLASS_LEASE_PREFIX}class2`, 'other-owner', '{}', Math.floor(NOW / 1000) + 180);
    api = mockNotion({ pages: new Map([['shared-log', log]]) });
    expect((await manual({ method: 'PATCH', page: log, body: { archived: true } })).status).toBe(423);
    expect(api.calls.filter(call => call.method === 'PATCH')).toHaveLength(0);
    expect(local.sqlite.prepare('SELECT * FROM security_challenges WHERE key_hash=?').get(`${CLASS_LEASE_PREFIX}class1`)).toBeUndefined();
  });

  it('unknown POST 응답 뒤 조회에도 없으면 120초 pending 동안 다시 생성하지 않는다', async () => {
    let first = true;
    const api = mockNotion({ onRequest: call => {
      if (call.path === '/pages' && first) { first = false; throw new Error('private network loss'); }
    } });
    expect((await manual({ method: 'POST', body: createBody() })).status).toBe(503);
    const blocked = await manual({ method: 'POST', body: createBody() });
    expect(blocked.status).toBe(423);
    expect(Number(blocked.headers['Retry-After'])).toBeGreaterThan(100);
    expect(api.calls.filter(call => call.path === '/pages')).toHaveLength(1);
    expect((await execute()).created).toBe(0);
    expect(api.calls.filter(call => call.path === '/pages')).toHaveLength(1);
    vi.advanceTimersByTime(120_000);
    expect((await manual({ method: 'POST', body: createBody() })).status).toBe(200);
    expect(api.calls.filter(call => call.path === '/pages')).toHaveLength(2);
  });

  it('unknown POST timeout 이후 서버가 늦게 저장해도 보수적 pending 대기 후 기존 페이지를 반환한다', async () => {
    let first = true;
    const api = mockNotion({ onRequest: (call, state) => {
      if (call.path === '/pages' && first) {
        first = false;
        return new Promise((_, reject) => {
          call.init.signal.addEventListener('abort', () => reject(new Error('lost timeout')));
          setTimeout(() => {
            const log = { object: 'page', id: 'late-log', parent: { database_id: LOG_DB }, properties: call.body.properties };
            state.created.push(log);
            api.existing.set('class-1', [log]);
          }, 30_000);
        });
      }
    } });
    const firstRequest = handleLessonLogRequest(env(), { method: 'POST', body: createBody() });
    await vi.advanceTimersByTimeAsync(16_000);
    expect((await firstRequest).status).toBe(503);
    const secondRequest = handleLessonLogRequest(env(), { method: 'POST', body: createBody() });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await secondRequest).status).toBe(423);
    expect(api.calls.filter(call => call.path === '/pages')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000);
    const recovered = await manual({ method: 'POST', body: createBody() });
    expect(recovered.status).toBe(200);
    expect(recovered.body.id).toBe('late-log');
    expect(api.created).toHaveLength(1);
  });

  it('503 committed_resource_id를 저장하고 relation 쿼리 전파 전에 GET으로 복구한다', async () => {
    const saved = { object: 'page', id: 'committed-log', parent: { database_id: LOG_DB }, properties: createBody().properties };
    const api = mockNotion({ pages: new Map([['committed-log', saved]]), onRequest: call => call.path === '/pages'
      ? Response.json({ object: 'error', status: 503, message: 'private response', additional_data: { committed_resource_id: 'committed-log' } }, { status: 503 }) : undefined });
    expect((await manual({ method: 'POST', body: createBody() })).status).toBe(503);
    const recovered = await manual({ method: 'POST', body: createBody() });
    expect(recovered.status).toBe(200);
    expect(recovered.body.id).toBe('committed-log');
    expect(api.calls.filter(call => call.path === '/pages')).toHaveLength(1);
    expect(api.calls.filter(call => call.path === `/databases/${LOG_DB}/query`)).toHaveLength(1);
  });

  it('성공한 생성 ID는 relation 쿼리에서 누락되어도 GET으로 중복을 막는다', async () => {
    const api = mockNotion({ onRequest: call => call.path === `/databases/${LOG_DB}/query` ? Response.json(list()) : undefined });
    const first = await manual({ method: 'POST', body: createBody() });
    const again = await manual({ method: 'POST', body: createBody() });
    expect(again.body.id).toBe(first.body.id);
    expect(api.created).toHaveLength(1);
    expect(api.calls.filter(call => call.path === `/databases/${LOG_DB}/query`)).toHaveLength(1);
  });

  it.each([400, 403, 404, 409, 429, 529])('쓰기 HTTP %s 거절은 즉시 재전송하지 않고 pending을 남기지 않는다', async status => {
    const api = mockNotion({ onRequest: call => call.path === '/pages' ? new Response('private response', { status }) : undefined });
    const result = await manual({ method: 'POST', body: createBody() });
    expect(result.status).toBe(status);
    expect(api.calls.filter(call => call.path === '/pages')).toHaveLength(1);
    const state = JSON.parse(local.sqlite.prepare('SELECT payload FROM security_challenges WHERE key_hash=?').get(`${CLASS_STATE_PREFIX}class1`).payload);
    expect(state.pendingUntil).toBe(0);
    expect(result.body.message).not.toContain('private');
  });

  it.each([429, 529])('Notion HTTP %s Retry-After 동안 다음 cron은 조회하지 않는다', async status => {
    const api = mockNotion({ onRequest: () => new Response('PII', { status, headers: { 'Retry-After': '900' } }) });
    await expect(execute()).rejects.toThrow(`notion-http-${status}`);
    expect(await execute()).toMatchObject({ cooldown: true, created: 0 });
    expect(api.calls).toHaveLength(1);
    expect(local.sqlite.prepare('SELECT expires_at FROM security_challenges WHERE key_hash=?').get(COOLDOWN_KEY).expires_at).toBe(Math.floor(NOW / 1000) + 900);
    vi.advanceTimersByTime(900_000);
    mockNotion({ lessons: [] });
    expect(await execute()).toMatchObject({ created: 0 });
  });

  it('Retry-After 7200초를 단축하지 않고 공급자 대기 시간이 지난 뒤 조회한다', async () => {
    const api = mockNotion({ onRequest: () => new Response('rate limited', { status: 429, headers: { 'Retry-After': '7200' } }) });
    await expect(execute()).rejects.toThrow('notion-http-429');
    expect(local.sqlite.prepare('SELECT expires_at FROM security_challenges WHERE key_hash=?').get(COOLDOWN_KEY).expires_at).toBe(Math.floor(NOW / 1000) + 7200);
    vi.advanceTimersByTime(7_199_000);
    expect(await execute()).toMatchObject({ cooldown: true });
    expect(api.calls).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    const retry = mockNotion({ lessons: [] });
    expect(await execute()).toMatchObject({ created: 0 });
    expect(retry.calls).toHaveLength(1);
  });

  it('새 state namespace는 기존 security challenge·global lease·cursor와 충돌하지 않는다', async () => {
    const original = { key: 'old-private-security-hash', proof: 'old-proof', payload: '{"verified":true}', expires: Math.floor(NOW / 1000) + 1800 };
    local.sqlite.prepare('INSERT INTO security_challenges VALUES(?,?,?,?)').run(original.key, original.proof, original.payload, original.expires);
    mockNotion();
    expect((await manual({ method: 'POST', body: createBody() })).status).toBe(200);
    expect(local.sqlite.prepare('SELECT * FROM security_challenges WHERE key_hash=?').get(original.key)).toMatchObject({ proof_hash: original.proof, payload: original.payload });
    expect(local.sqlite.prepare('SELECT * FROM security_challenges WHERE key_hash=?').get(LEASE_KEY)).toBeUndefined();
    expect(local.sqlite.prepare('SELECT * FROM security_challenges WHERE key_hash=?').get(CURSOR_KEY)).toBeUndefined();
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM security_challenges WHERE key_hash LIKE ?').get(`${CLASS_LEASE_PREFIX}%`).n).toBe(0);
  });
});
