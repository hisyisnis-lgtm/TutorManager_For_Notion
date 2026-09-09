import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import worker from '../src/index.js';
import { signTypedToken } from '../lib/auth.js';
import { localD1 } from './helpers/localD1.js';
const DB = '5ce7d5ef-7b80-4795-843f-325f4ca868e2';
const STUDENT = '11111111-1111-1111-1111-111111111111';
const HOMEWORK = '22222222-2222-2222-2222-222222222222';
const UPLOAD = '33333333-3333-3333-3333-333333333333';
const CODE = 'ABCDEF123456';
const SECRET = 'isolated-security-test-secret';
let database, env, studentToken, teacherToken, page, calls;
const ctx = { waitUntil: promise => promise.catch(() => {}) };
const send = (path, { token = studentToken, method = 'GET', body, headers = {} } = {}) => worker.fetch(new Request('https://audit.invalid' + path, {
  method, headers: { Origin: 'http://localhost:5173', Authorization: `Bearer ${token}`, ...headers }, ...(body ? { body } : {}),
}), env, ctx);
const submit = files => send(`/homework/student/${CODE}/${HOMEWORK}/submit`, { method: 'POST', body: JSON.stringify({ files }) });
beforeEach(async () => {
  database = localD1(); calls = [];
  env = { GAME_DB: database.db, JWT_SECRET: SECRET, NOTION_TOKEN: 'synthetic-notion' };
  studentToken = await signTypedToken(SECRET, 'student', `personal:${CODE}`, 600);
  teacherToken = await signTypedToken(SECRET, 'teacher', 'teacher', 600, { role: 'teacher' });
  page = { id: HOMEWORK, parent: { database_id: DB }, properties: { '학생': { relation: [{ id: STUDENT }] }, '제출 상태': { select: { name: '미제출' } } } };
  vi.stubGlobal('fetch', vi.fn(async (raw, init = {}) => {
    const url = new URL(raw); calls.push({ url: url.pathname, method: init.method || 'GET', body: init.body });
    if (url.hostname !== 'api.notion.com') throw new Error('Non-mocked network denied');
    if (url.pathname.includes('/databases/') && url.pathname.endsWith('/query')) return Response.json({ results: url.pathname.includes(DB) ? [page] : [{ id: STUDENT }], has_more: false });
    if (url.pathname === '/v1/file_uploads') return Response.json({ id: UPLOAD, upload_url: `https://api.notion.com/v1/file_uploads/${UPLOAD}/send` });
    if (url.pathname.endsWith('/send')) return Response.json({ id: UPLOAD });
    if (url.pathname === `/v1/pages/${HOMEWORK}`) return Response.json(page);
    throw new Error('Unexpected mock URL');
  }));
});
afterEach(() => { database.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('production data handlers with isolated Notion and SQLite', () => {
  it.each([
    ['/notice/', 'f93b423b-8ab0-493b-bdf3-78fde6ec430f'],
    ['/booking/blocked/', '31e838fa-f2a6-81d3-b034-c47a4f0e5f3e'],
  ])('%s deletion enforces its own database, including with a teacher token', async (route, ownDb) => {
    expect((await send(`${route}${HOMEWORK}`, { token: teacherToken, method: 'DELETE' })).status).toBe(403);
    expect(calls.some(call => call.method === 'PATCH')).toBe(false);
    page.parent.database_id = ownDb;
    expect((await send(`${route}${HOMEWORK}`, { token: teacherToken, method: 'DELETE' })).status).toBe(200);
    expect(calls.some(call => call.method === 'PATCH')).toBe(true);
  });
  it('blocks out-of-scope page read and write before modifying Notion', async () => {
    page.parent.database_id = STUDENT;
    for (const method of ['GET', 'PATCH']) {
      expect((await send(`/v1/pages/${HOMEWORK}`, { token: teacherToken, method, ...(method === 'PATCH' ? { body: JSON.stringify({ archived: true }) } : {}) })).status).toBe(403);
    }
    expect(calls.every(call => call.method === 'GET')).toBe(true);
  });
  it('blocks page-parent creation bypass without calling Notion', async () => {
    expect((await send('/v1/pages', { token: teacherToken, method: 'POST', body: JSON.stringify({ parent: { page_id: HOMEWORK } }) })).status).toBe(403);
    expect(calls).toHaveLength(0);
  });
  it('accepts a valid student file, issues an owner receipt, and submits it', async () => {
    const form = new FormData(); form.append('file', new File(['%PDF-1.7 synthetic'], 'lesson.pdf', { type: 'application/pdf' }));
    const upload = await send(`/homework/student-upload/${CODE}`, { method: 'POST', body: form });
    expect(upload.status).toBe(200);
    const data = await upload.json();
    expect(data.uploadReceipt).toBeTypeOf('string');
    expect((await submit([data])).status).toBe(200);
    expect(calls.some(call => call.method === 'PATCH')).toBe(true);
  });
  it.each(['other-student', 'different-upload', 'renamed-file', 'expired'])('rejects an upload receipt with %s', async variant => {
    const file = { fileUploadId: UPLOAD, fileName: 'lesson.pdf' };
    file.uploadReceipt = await signTypedToken(SECRET, 'homework-upload', variant === 'other-student' ? HOMEWORK : STUDENT, variant === 'expired' ? -1 : 600, { uploadId: variant === 'different-upload' ? HOMEWORK : UPLOAD, fileName: variant === 'renamed-file' ? 'other.pdf' : file.fileName });
    expect((await submit([file])).status).toBe(403);
    expect(calls.some(call => call.method === 'PATCH')).toBe(false);
  });
  it('rejects disguised HTML upload before file storage', async () => {
    const form = new FormData(); form.append('file', new File(['<html>synthetic</html>'], 'photo.png', { type: 'image/png' }));
    expect((await send('/homework/upload', { token: teacherToken, method: 'POST', body: form })).status).toBe(415);
    expect(calls).toHaveLength(0);
  });
  it('student download and submit reject pages outside the homework DB', async () => {
    page.parent.database_id = STUDENT;
    expect((await submit([])).status).toBe(403);
    expect((await send(`/homework/student/${CODE}/${HOMEWORK}/file?name=test.pdf&kind=submit`)).status).toBe(403);
    expect(calls.some(call => call.method === 'PATCH')).toBe(false);
  });
  it('student responses do not disclose workspace metadata or direct file URLs', async () => {
    page.created_by = { id: 'private-workspace-user' };
    page.properties['학생 제출 파일'] = { files: [{ name: 'lesson.pdf', file: { url: 'https://private.invalid/signed' } }] };
    const response = await send(`/homework/student/${CODE}`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('lesson.pdf');
    expect(text).not.toContain('private');
    expect(text).not.toContain(STUDENT);
  });
  it('notification history requires a teacher token and stays inside D1', async () => {
    expect((await send('/notifications')).status).toBe(401);
    expect((await send('/notifications', { token: teacherToken })).status).toBe(200);
    expect(calls).toHaveLength(0);
  });
  it('oversized public events are rejected before processing', async () => {
    const response = await send('/game/event', { method: 'POST', body: 'x'.repeat(9000) });
    expect(response.status).toBe(413);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(calls).toHaveLength(0);
  });
});
