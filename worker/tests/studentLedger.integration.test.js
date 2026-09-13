import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import worker from '../src/index.js';
import { signTypedToken } from '../lib/auth.js';
import { localD1 } from './helpers/localD1.js';

const CODE = 'QAABCD123456', STUDENT = '11111111-1111-4111-8111-111111111111';
const STUDENT_DB = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb', PAY_DB = '314838fa-f2a6-8154-935b-edd3d2fbea83';
const CLASS_DB = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb', SECRET = 'isolated-ledger-test-secret';
let database, env, token, calls, payments, classes, invalid;
const ctx = { waitUntil: promise => promise.catch(() => {}) };
const send = (auth = token, code = CODE) => worker.fetch(new Request(`https://audit.invalid/booking/student/${code}`, {
  headers: { Origin: 'http://localhost:5173', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
}), env, ctx);
beforeEach(async () => {
  database = localD1(); calls = []; invalid = false;
  env = { GAME_DB: database.db, JWT_SECRET: SECRET, NOTION_TOKEN: 'fixture-only' };
  token = await signTypedToken(SECRET, 'student', `personal:${CODE}`, 600);
  payments = [{ id: 'payment', properties: { '시간 회차': { number: 3 }, '유효 시간 회차': { formula: { number: 3 } },
    '결제 상태': { formula: { string: '🟢완료' } }, '결제일': { date: { start: '2026-01-01' } }, '메모': { rich_text: [{ plain_text: 'private-note' }] } } }];
  classes = [
    ['before-share', '2025-12-01', 1, '60', null, 1], ['after-share', '2026-01-02', 1, '60', null, 1],
    ['future', '2099-01-01', 2, '120', null, 1], ['cancel', '2026-01-03', 0, '60', '🚫 취소', 1],
    ['makeup', '2026-01-03', 0, '60', '🟠 보강', 1], ['free', '2026-01-03', 0, '60', null, 0],
  ].map(([id, date, hours, min, special, paid]) => ({ id, properties: {
    '시간 회차': { formula: { number: hours } }, '수업 일시': { date: { start: date } }, '수업 시간(분)': { select: { name: min } },
    '무료 수업': { rollup: { number: paid } }, '특이사항': { select: special ? { name: special } : null },
  } }));
  vi.stubGlobal('fetch', vi.fn(async (raw, init = {}) => {
    const url = new URL(raw), body = JSON.parse(init.body || '{}');
    if (url.origin !== 'https://api.notion.com' || !url.pathname.endsWith('/query')) throw new Error('Non-mocked network denied');
    calls.push({ path: url.pathname, body });
    if (url.pathname.includes(STUDENT_DB) && invalid === 'student') return Response.json({ object: 'error' }, { status: 400 });
    if (url.pathname.includes(STUDENT_DB)) return Response.json({ results: [{ id: STUDENT, properties: {
      '이름': { title: [{ plain_text: '격리 학생' }] }, '전화번호': { phone_number: '010-0000-0000' },
      '사용 시간 회차': { rollup: { number: 4 } }, '공유일': { date: { start: '2026-01-01' } },
    } }], has_more: false });
    expect(body.filter).toEqual({ property: '학생', relation: { contains: STUDENT } });
    if (invalid) return Response.json({ object: 'error', message: 'private-upstream' }, { status: 400 });
    const rows = url.pathname.includes(PAY_DB) ? payments : url.pathname.includes(CLASS_DB) ? classes : null;
    if (!rows) throw new Error('Unexpected database');
    const start = body.start_cursor ? Number(body.start_cursor) : 0;
    return Response.json({ results: rows.slice(start, start + 100), has_more: start + 100 < rows.length,
      next_cursor: start + 100 < rows.length ? String(start + 100) : null });
  }));
});
afterEach(() => { database.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('학생 시간 명세 본인 인증 경계', () => {
  it('실제 route가 같은 자료로 명세와 잔여를 만들고 판다의 공유일 이후 분량은 보존한다', async () => {
    const response = await send();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const data = await response.json();
    expect(data).toMatchObject({ paidHours: 3, remainingSessions: -1, remainingHours: 1, completedMinutes: 60 });
    expect(data).not.toHaveProperty('timeLedger');
    expect(JSON.stringify(data)).not.toMatch(/phone|010-0000|private-note|actualAmount|refundAmount/);
    expect(calls).toHaveLength(3);
  });
  it('비로그인·다른 학생·게임 세션은 Notion을 읽기 전에 차단한다', async () => {
    const game = await signTypedToken(SECRET, 'game', 'game-fixture', 600);
    for (const [auth, code] of [['', CODE], [token, 'OTHER1234567'], [game, CODE]]) {
      expect((await send(auth, code)).status).toBe(401);
    }
    expect(calls).toHaveLength(0);
  });
  it('강사 미리보기는 기존 인증으로 동일한 학생 명세를 읽을 수 있다', async () => {
    const teacher = await signTypedToken(SECRET, 'teacher', 'teacher', 600, { role: 'teacher' });
    expect((await send(teacher)).status).toBe(200);
  });
  it('결제·수업 각각 100건 이후 기록까지 포함한다', async () => {
    payments = Array.from({ length: 101 }, (_, i) => ({ ...payments[0], id: `p${i}` }));
    classes = Array.from({ length: 101 }, (_, i) => ({ ...classes[0], id: `c${i}` }));
    const data = await (await send()).json();
    expect(data.paidHours).toBe(303);
    expect(data.remainingHours).toBe(299);
    expect(data).not.toHaveProperty('timeLedger');
    expect(calls.filter(call => call.body.start_cursor === '100')).toHaveLength(2);
  });
  it('하위 조회 4xx가 빈 내역이나 0시간 성공으로 보이지 않는다', async () => {
    invalid = true;
    const response = await send();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.json()).not.toHaveProperty('timeLedger');
  });
  it('학생 조회 실패를 코드 없음 404로 바꿔 기존 학생 캐시를 지우지 않는다', async () => {
    invalid = 'student';
    const response = await send();
    expect(response.status).toBe(502);
    expect(calls).toHaveLength(1);
  });
});
