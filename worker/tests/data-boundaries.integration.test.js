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
const FILE_URL = 'https://files.fixture.invalid/lesson.pdf';
const REDIRECT_URL = 'https://redirect.fixture.invalid/credential-trap';
let database, env, studentToken, teacherToken, page, calls, uploadResponse, downloadResponse;
const pdfForm = () => {
  const form = new FormData();
  form.append('file', new File(['%PDF-1.7 synthetic'], 'lesson.pdf', { type: 'application/pdf' }));
  return form;
};
// Node fetch와 달리 workerd에서 거부하는 설정을 permissive stub이 놓치지 않게 한다.
function assertWorkerRedirectMode(init) {
  if (init.redirect === 'error') throw new TypeError('Unsupported redirect mode: error');
}
const ctx = { waitUntil: promise => promise.catch(() => {}) };
const send = (path, { token = studentToken, method = 'GET', body, headers = {} } = {}) => worker.fetch(new Request('https://audit.invalid' + path, {
  method, headers: { Origin: 'http://localhost:5173', Authorization: `Bearer ${token}`, ...headers }, ...(body ? { body } : {}),
}), env, ctx);
const submit = files => send(`/homework/student/${CODE}/${HOMEWORK}/submit`, { method: 'POST', body: JSON.stringify({ files }) });
beforeEach(async () => {
  database = localD1(); calls = [];
  uploadResponse = undefined; downloadResponse = undefined;
  env = { GAME_DB: database.db, JWT_SECRET: SECRET, NOTION_TOKEN: 'synthetic-notion' };
  studentToken = await signTypedToken(SECRET, 'student', `personal:${CODE}`, 600);
  teacherToken = await signTypedToken(SECRET, 'teacher', 'teacher', 600, { role: 'teacher' });
  page = { id: HOMEWORK, parent: { database_id: DB }, properties: { '학생': { relation: [{ id: STUDENT }] }, '제출 상태': { select: { name: '미제출' } } } };
  vi.stubGlobal('fetch', vi.fn(async (raw, init = {}) => {
    assertWorkerRedirectMode(init);
    const url = new URL(raw); calls.push({ url: url.pathname, origin: url.origin, method: init.method || 'GET', body: init.body,
      redirect: init.redirect, headers: init.headers });
    if (url.href === FILE_URL) return downloadResponse || new Response('%PDF-1.7 synthetic', { headers: { 'Content-Type': 'application/pdf' } });
    if (url.hostname !== 'api.notion.com') throw new Error('Non-mocked network denied');
    if (url.pathname.includes('/databases/') && url.pathname.endsWith('/query')) return Response.json({ results: url.pathname.includes(DB) ? [page] : [{ id: STUDENT }], has_more: false });
    if (url.pathname === '/v1/file_uploads') return Response.json({ id: UPLOAD, upload_url: `https://api.notion.com/v1/file_uploads/${UPLOAD}/send` });
    if (url.pathname.endsWith('/send')) return uploadResponse || Response.json({ id: UPLOAD });
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
    const upload = await send(`/homework/student-upload/${CODE}`, { method: 'POST', body: pdfForm() });
    expect(upload.status).toBe(200);
    const data = await upload.json();
    expect(data.uploadReceipt).toBeTypeOf('string');
    expect(calls.find(call => call.url.endsWith('/send'))).toMatchObject({ redirect: 'manual',
      headers: { Authorization: 'Bearer synthetic-notion' } });
    expect((await submit([data])).status).toBe(200);
    expect(calls.some(call => call.method === 'PATCH')).toBe(true);
  });
  it('accepts a teacher PDF upload with manual redirects and the upstream credential', async () => {
    const response = await send('/homework/upload', { token: teacherToken, method: 'POST', body: pdfForm() });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ fileUploadId: UPLOAD, fileName: 'lesson.pdf' });
    expect(calls.filter(call => call.url.endsWith('/send'))).toHaveLength(1);
    expect(calls.find(call => call.url.endsWith('/send'))).toMatchObject({ method: 'POST', redirect: 'manual',
      headers: { Authorization: 'Bearer synthetic-notion' } });
  });
  it('keeps a completed student submission successful when its notification relay fails', async () => {
    Object.assign(env, { GITHUB_PAT: 'isolated-github', NTFY_TOKEN: 'isolated-ntfy', NTFY_TOPIC: 'isolated-topic' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('caches', { default: { match: async () => undefined, put: async () => {} } });
    const background = [];
    vi.spyOn(ctx, 'waitUntil').mockImplementation(promise => background.push(promise));
    let failWarning;
    const upstreamWarning = new Promise((_resolve, reject) => { failWarning = () => reject(new Error('private-warning-error')); });
    const notionFetch = fetch.getMockImplementation();
    fetch.mockImplementation(async (url, init) => {
      if (url.endsWith('/dispatches')) return new Response('private-upstream-error', { status: 403 });
      if (url === 'https://ntfy.sh') return upstreamWarning;
      return notionFetch(url, init);
    });
    const upload = await send(`/homework/student-upload/${CODE}`, { method: 'POST', body: pdfForm() });
    expect(upload.status).toBe(200);
    let timeout;
    try {
      const response = await Promise.race([
        submit([await upload.json()]),
        new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Submission waited for the operational warning')), 1500); }),
      ]);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id: HOMEWORK, notificationWarning: expect.stringContaining('저장') });
      expect(ctx.waitUntil).toHaveBeenCalledOnce();
      expect(calls.filter(call => call.url === `/v1/pages/${HOMEWORK}` && call.method === 'PATCH')).toHaveLength(1);
      expect(fetch.mock.calls.filter(([url]) => url.endsWith('/dispatches'))).toHaveLength(1);
      const warnings = fetch.mock.calls.filter(([url]) => url === 'https://ntfy.sh');
      expect(warnings).toHaveLength(1);
      expect(warnings[0][1].body).not.toMatch(/ABCDEF123456|lesson.pdf|private-upstream-error/);
      failWarning();
      await expect(Promise.all(background)).resolves.toBeDefined();
      expect(response.status).toBe(200);
    } finally {
      clearTimeout(timeout);
      failWarning();
      await Promise.allSettled(background);
    }
  });
  it.each([['student', 302], ['student', 307], ['teacher', 302], ['teacher', 307]])('%s upload rejects upstream %s without forwarding files or credentials', async (role, status) => {
    uploadResponse = new Response('private-redirect-body', { status, headers: { Location: REDIRECT_URL } });
    const cancel = vi.spyOn(uploadResponse.body, 'cancel');
    const response = await send(role === 'student' ? `/homework/student-upload/${CODE}` : '/homework/upload', {
      token: role === 'student' ? studentToken : teacherToken, method: 'POST', body: pdfForm(),
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: '파일 업로드 중 허용되지 않은 주소 이동이 감지되었습니다.' });
    expect(calls.filter(call => call.url.endsWith('/send'))).toHaveLength(1);
    expect(calls.find(call => call.url.endsWith('/send')).redirect).toBe('manual');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(calls.some(call => call.origin === new URL(REDIRECT_URL).origin || call.method === 'PATCH')).toBe(false);
  });
  it.each(['student', 'teacher'])('%s downloads stream an owned file with manual redirects', async role => {
    page.properties['학생 제출 파일'] = { files: [{ name: 'lesson.pdf', file: { url: FILE_URL } }] };
    const path = role === 'student' ? `/homework/student/${CODE}/${HOMEWORK}/file` : `/homework/${HOMEWORK}/file`;
    const response = await send(`${path}?name=lesson.pdf&kind=submit`, { token: role === 'student' ? studentToken : teacherToken });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toContain('attachment;');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.text()).toBe('%PDF-1.7 synthetic');
    const downloads = calls.filter(call => call.origin === new URL(FILE_URL).origin);
    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toMatchObject({ method: 'GET', redirect: 'manual' });
    expect(downloads[0].headers).toBeUndefined();
  });
  it.each([['student', 302], ['student', 307], ['teacher', 302], ['teacher', 307]])('%s download rejects upstream %s without fetching its Location', async (role, status) => {
    page.properties['학생 제출 파일'] = { files: [{ name: 'lesson.pdf', file: { url: FILE_URL } }] };
    downloadResponse = new Response('private-redirect-body', { status, headers: { Location: REDIRECT_URL } });
    const cancel = vi.spyOn(downloadResponse.body, 'cancel');
    const path = role === 'student' ? `/homework/student/${CODE}/${HOMEWORK}/file` : `/homework/${HOMEWORK}/file`;
    const response = await send(`${path}?name=lesson.pdf&kind=submit`, { token: role === 'student' ? studentToken : teacherToken });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: '파일을 가져올 수 없습니다.' });
    expect(calls.filter(call => call.origin === new URL(FILE_URL).origin)).toHaveLength(1);
    expect(calls.find(call => call.origin === new URL(FILE_URL).origin).redirect).toBe('manual');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(calls.some(call => call.origin === new URL(REDIRECT_URL).origin)).toBe(false);
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
  it('notification data requires a teacher token and configured private account', async () => {
    expect((await send('/notifications')).status).toBe(401);
    expect((await send('/notifications', { token: teacherToken })).status).toBe(503);
    expect(calls).toHaveLength(0);
  });
  it('oversized public events are rejected before processing', async () => {
    const response = await send('/game/event', { method: 'POST', body: 'x'.repeat(9000) });
    expect(response.status).toBe(413);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(calls).toHaveLength(0);
  });
});
