import test from 'node:test';
import assert from 'node:assert/strict';
import { publishTeacherPush } from './web_push_delivery.mjs';

test('설정 없이는 외부 요청을 보내지 않는다', async () => {
  let called = false;
  const result = await publishTeacherPush({ title: '비공개', message: '상세' }, {
    token: '', fetchImpl: async () => { called = true; return new Response(); },
  });
  assert.deepEqual(result, { ok: false, reason: 'push_not_configured' });
  assert.equal(called, false);
});

test('상세 알림을 공유 시크릿으로 Worker 한 곳에만 전송한다', async () => {
  const calls = [];
  const result = await publishTeacherPush({
    title: '📅 내일 수업 안내', message: '김학생 14:00 수업', priority: 4,
  }, {
    workerUrl: 'https://worker.example.test/',
    token: 'synthetic-push-secret',
    fetchImpl: async (url, options) => {
      calls.push([url, options]);
      return Response.json({ ok: true });
    },
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0][0], 'https://worker.example.test/push/publish');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer synthetic-push-secret');
  assert.equal(JSON.parse(calls[0][1].body).message, '김학생 14:00 수업');
  assert.equal(calls[0][1].body.includes('synthetic-push-secret'), false);
  assert.equal(calls[0][1].redirect, 'error');
});
