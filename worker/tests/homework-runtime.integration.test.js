import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import * as miniflare from 'miniflare';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { signTypedToken, verifyTypedToken } from '../lib/auth.js';

// Exercise the actual Worker in workerd, not a Node fetch stub: workerd validates
// RequestInit before the fail-closed outboundService supplies synthetic responses.
// No Wrangler config, production bindings, persisted database or network is used.
const SECRET = 'runtime-homework-synthetic-secret';
const CODE = 'ABCDEF123456';
const STUDENT = '11111111-1111-1111-1111-111111111111';
const HOMEWORK = '22222222-2222-2222-2222-222222222222';
const UPLOAD = '33333333-3333-3333-3333-333333333333';
const HOMEWORK_DB = '5ce7d5ef-7b80-4795-843f-325f4ca868e2';
const NTFY_TOPIC = 'runtime-homework-synthetic-topic';
const REDIRECT_URL = 'https://blocked.fixture.invalid/do-not-send-files';
const UPLOAD_PATH = `/v1/file_uploads/${UPLOAD}/send`;
const RUNTIME_ERROR = 'Invalid redirect value, must be one of "follow" or "manual"';
let script, formerBugScript, migration, tokens;
let runtime;

async function bundle(source) {
  const result = await build({
    stdin: {
      contents: source,
      sourcefile: 'index.js',
      resolveDir: fileURLToPath(new URL('../src/', import.meta.url)),
    },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

beforeAll(async () => {
  const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
  // Negative control reintroduces only the original upload option in memory.
  // This survives shallow CI checkouts and never modifies the production source.
  const uploadOption = /(const uploadRes = await fetch\(upload_url, \{[\s\S]*?redirect: )'(?:manual|error)'/g;
  expect([...source.matchAll(uploadOption)]).toHaveLength(1);
  [script, formerBugScript] = await Promise.all([
    bundle(source),
    bundle(source.replace(uploadOption, "$1'error'")),
  ]);
  migration = await readFile(new URL('../migrations/0002_security_state.sql', import.meta.url), 'utf8');
  tokens = {
    student: await signTypedToken(SECRET, 'student', `personal:${CODE}`, 600),
    teacher: await signTypedToken(SECRET, 'teacher', 'teacher', 600, { role: 'teacher' }),
  };
}, 30_000);

afterEach(async () => {
  if (runtime) await runtime.dispose();
  runtime = undefined;
}, 30_000);

async function start({ negativeControl = false, uploadStatus = 200 } = {}) {
  const calls = [];
  const page = {
    id: HOMEWORK,
    parent: { database_id: HOMEWORK_DB },
    properties: {
      '학생': { relation: [{ id: STUDENT }] },
      '제출 상태': { select: { name: '미제출' } },
    },
  };
  const options = {
    modules: true,
    script: negativeControl ? formerBugScript : script,
    compatibilityDate: '2026-04-27',
    cf: false,
    log: new miniflare.Log(miniflare.LogLevel.NONE),
    bindings: {
      JWT_SECRET: SECRET,
      NOTION_TOKEN: 'synthetic-notion',
      NTFY_TOPIC,
      NTFY_TOKEN: 'synthetic-ntfy',
      GITHUB_PAT: 'synthetic-dispatch',
    },
    d1Databases: { GAME_DB: 'runtime-homework-isolated' },
    outboundService: async request => {
      const url = new URL(request.url);
      const call = { origin: url.origin, path: url.pathname, method: request.method };
      calls.push(call);
      // Never fall back to real fetch, including for Location targets.
      if (url.origin === 'https://ntfy.sh' && ['/', `/${NTFY_TOPIC}`].includes(url.pathname) && request.method === 'POST') {
        await request.arrayBuffer();
        return Response.json({ id: 'synthetic-notification' });
      }
      if (url.origin === 'https://api.github.com' && url.pathname === '/repos/hisyisnis-lgtm/TutorManager_For_Notion/dispatches' && request.method === 'POST') {
        call.body = await request.json();
        return new Response(null, { status: 204 });
      }
      if (url.origin !== 'https://api.notion.com') return new Response('Network denied by runtime fixture', { status: 599 });
      if (url.pathname.includes('/databases/') && url.pathname.endsWith('/query')) {
        return Response.json({ results: [{ id: STUDENT }], has_more: false });
      }
      if (url.pathname === '/v1/file_uploads') {
        return Response.json({ id: UPLOAD, upload_url: `https://api.notion.com${UPLOAD_PATH}` });
      }
      if (url.pathname === UPLOAD_PATH) {
        call.authorization = request.headers.get('Authorization');
        const file = (await request.formData()).get('file');
        call.file = { name: file.name, type: file.type, text: await file.text() };
        return uploadStatus === 200
          ? Response.json({ id: UPLOAD })
          : new Response('do-not-expose-redirect-body', { status: uploadStatus, headers: { Location: REDIRECT_URL } });
      }
      if (url.pathname === `/v1/pages/${HOMEWORK}`) {
        if (request.method === 'PATCH') {
          call.body = await request.json();
          Object.assign(page.properties, call.body.properties);
        }
        return Response.json(page);
      }
      return new Response('Unexpected URL denied by runtime fixture', { status: 599 });
    },
  };
  // Wrangler 4 and its locally installed next Miniflare use the same workerd
  // engine; Miniflare 5 exposes an explicit converter for this public v4 shape.
  runtime = new miniflare.Miniflare(miniflare.convertV4MiniflareOptions
    ? miniflare.convertV4MiniflareOptions(options)
    : options);
  const database = await runtime.getD1Database('GAME_DB');
  await database.batch(migration.split(';').map(sql => sql.trim()).filter(Boolean).map(sql => database.prepare(sql)));
  return { calls, database };
}

function send(path, role, body, contentType = 'application/json') {
  return runtime.dispatchFetch(`https://audit.fixture.invalid${path}`, {
    method: 'POST',
    headers: { Origin: 'http://localhost:5173', Authorization: `Bearer ${tokens[role]}`, 'Content-Type': contentType },
    body,
  });
}

function upload(role, audio = false) {
  // Raw multipart crosses Node/Miniflare's distinct FormData implementations;
  // parsing and construction of the outgoing file still happen inside workerd.
  const boundary = 'runtime-homework-multipart';
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${audio ? 'voice.mp3' : 'lesson.pdf'}"\r\nContent-Type: ${audio ? 'audio/mpeg' : 'application/pdf'}\r\n\r\n${audio ? 'ID3synthetic' : '%PDF-1.7 synthetic'}\r\n--${boundary}--\r\n`;
  return send(role === 'student' ? `/homework/student-upload/${CODE}` : '/homework/upload', role, body, `multipart/form-data; boundary=${boundary}`);
}

describe('homework uploads in real workerd with isolated D1 and fail-closed outbound mocks', () => {
  it('reproduces the former redirect:error runtime failure before sending the student file', async () => {
    const { calls } = await start({ negativeControl: true });
    const response = await upload('student');
    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain(RUNTIME_ERROR);
    expect(calls.some(call => call.path === '/v1/file_uploads')).toBe(true);
    expect(calls.some(call => call.path === UPLOAD_PATH)).toBe(false);
  }, 30_000);

  it('authenticates a student, uploads audio, and submits the signed owner receipt', async () => {
    const { calls, database } = await start();
    const response = await upload('student', true);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ fileUploadId: UPLOAD, fileName: 'voice.mp3' });
    expect(await verifyTypedToken(SECRET, result.uploadReceipt, 'homework-upload')).toMatchObject({
      sub: STUDENT, uploadId: UPLOAD, fileName: 'voice.mp3',
    });
    expect(calls.find(call => call.path === UPLOAD_PATH)).toMatchObject({
      method: 'POST', authorization: 'Bearer synthetic-notion',
      file: { name: 'voice.mp3', type: 'audio/mpeg', text: 'ID3synthetic' },
    });
    const submission = await send(`/homework/student/${CODE}/${HOMEWORK}/submit`, 'student', JSON.stringify({ files: [result] }));
    expect(submission.status).toBe(200);
    await submission.text();
    expect(calls.find(call => call.method === 'PATCH')?.body.properties).toMatchObject({
      '제출 상태': { select: { name: '제출완료' } },
      '학생 제출 파일': { files: [{ name: 'voice.mp3', type: 'file_upload', file_upload: { id: UPLOAD } }] },
    });
    expect(calls.filter(call => call.origin === 'https://api.github.com')).toEqual([
      expect.objectContaining({ method: 'POST', body: expect.objectContaining({ event_type: 'ntfy-relay' }) }),
    ]);
    expect(await database.prepare('SELECT COUNT(*) AS count FROM security_rate_limits').first('count')).toBeGreaterThan(0);
    expect(calls.every(call => ['https://api.notion.com', 'https://api.github.com'].includes(call.origin))).toBe(true);
  }, 30_000);

  it('authenticates a teacher and uploads PDF through the same real runtime helper', async () => {
    const { calls } = await start();
    const response = await upload('teacher');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ fileUploadId: UPLOAD, fileName: 'lesson.pdf' });
    expect(calls.find(call => call.path === UPLOAD_PATH)).toMatchObject({
      method: 'POST', authorization: 'Bearer synthetic-notion',
      file: { name: 'lesson.pdf', type: 'application/pdf', text: '%PDF-1.7 synthetic' },
    });
  }, 30_000);

  it.each([['student', 302], ['student', 307], ['teacher', 302], ['teacher', 307]])(
    '%s rejects a %i upload redirect without following its external Location', async (role, uploadStatus) => {
      const { calls } = await start({ uploadStatus });
      const response = await upload(role);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: '파일 업로드 중 허용되지 않은 주소 이동이 감지되었습니다.' });
      expect(calls.filter(call => call.path === UPLOAD_PATH)).toHaveLength(1);
      expect(calls.some(call => call.origin === new URL(REDIRECT_URL).origin)).toBe(false);
      expect(calls.some(call => call.method === 'PATCH')).toBe(false);
    }, 30_000,
  );
});
