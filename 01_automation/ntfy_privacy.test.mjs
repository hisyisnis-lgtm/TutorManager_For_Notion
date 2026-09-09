import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyPrivateNtfyTopic, publishNtfySafely, publicNtfyPayload, checkNtfyTopicAlias, sendWorkflowNtfy } from './ntfy_privacy.mjs';
import { createNtfyClient, sendAlert } from './notion_utils.mjs';

const topic = 'fixture-private-topic';
const token = 'fixture-secret-token';
const payload = {
  topic, title: 'fixture-student-name', message: '일일 리포트\nfixture-student-phone\n\n수업 · 상담 · 숙제', priority: 3,
  actions: [{ action: 'view', label: 'fixture-student-name', url: 'https://fixture-private.example' }],
  attach: 'https://fixture-private.example/file', click: 'https://fixture-private.example/student',
  filename: 'fixture-student-name.pdf', tags: ['fixture-student-phone'], icon: 'https://fixture-private.example/icon',
};
const secretPattern = /fixture-private-topic|fixture-secret-token|fixture-student-phone|secret-email|another-token/;

function server(reservations, { accountStatus = 200, publishStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, ...options });
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    if (url.endsWith('/v1/account')) {
      assert.equal(options.method, 'GET');
      return Response.json({ username: 'fixture-account', role: 'user', reservations, email: 'secret-email', tokens: ['another-token'] }, { status: accountStatus });
    }
    assert.equal(url, 'https://ntfy.sh');
    assert.equal(options.method, 'POST');
    return Response.json({ topic, message: payload.message, error: token }, { status: publishStatus });
  };
  return { calls, fetchImpl };
}

test('공개·미소유·ACL 누락 토픽도 원문과 줄바꿈을 유지하고 계정을 선행 조회하지 않는다', async () => {
  for (const reservations of [
    [], null, [{ topic: 'someone-else', everyone: 'deny-all' }], [{ topic }],
    [{ topic, everyone: 'deny-all' }, { topic, everyone: 'read-only' }],
    ...['read-write', 'read-only', 'write-only', 'unknown'].map(everyone => [{ topic, everyone }]),
  ]) {
    const fake = server(reservations);
    const result = await publishNtfySafely({ token, payload, ...fake });
    assert.equal(result.ok, true);
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].method, 'POST');
    assert.deepEqual(JSON.parse(fake.calls[0].body), payload);
    assert.equal(JSON.parse(fake.calls[0].body).message, '일일 리포트\nfixture-student-phone\n\n수업 · 상담 · 숙제');
    assert.doesNotMatch(JSON.stringify(result), secretPattern);
  }
});

test('제목·본문의 접근 URL 토큰만 가리고 URL 다음 줄의 이름·시간·금액·줄바꿈을 보존한다', async () => {
  const original = Object.freeze({
    ...payload,
    title: '수업 안내 /personal/ABCD1234EFGH5678\n가상학생 14:00',
    message: 'https://fixture-private.example/personal/ABCD1234EFGH5678?token=fixture-secret-token\n가상학생 14:00 50,000원\n\nhttps://fixture-private.example/view?token=fixture-secret-token&mode=view\r\n상담 15:00',
  });
  const fake = server([]);
  assert.deepEqual(await publishNtfySafely({ token, payload: original, ...fake }), { ok: true });
  assert.equal(fake.calls.length, 1);
  const outgoing = JSON.parse(fake.calls[0].body);
  assert.deepEqual(outgoing, {
    ...original,
    title: '수업 안내 /personal/ABCD...5678\n가상학생 14:00',
    message: 'https://fixture-private.example/personal/ABCD...5678?token=[redacted]\n가상학생 14:00 50,000원\n\nhttps://fixture-private.example/view?token=[redacted]&mode=view\r\n상담 15:00',
  });
  assert.doesNotMatch(outgoing.title + outgoing.message, /ABCD1234EFGH5678|fixture-secret-token/);
  assert.match(original.message, /ABCD1234EFGH5678\?token=fixture-secret-token/);
});

test('명시적 비공개 검사는 ACL 변경을 반영하되 발행은 원문을 유지한다', async () => {
  const reservations = [{ topic, everyone: 'deny-all' }];
  const fake = server(reservations);
  assert.deepEqual(await verifyPrivateNtfyTopic({ topic, token, ...fake }), { ok: true });
  assert.deepEqual(await publishNtfySafely({ token, payload, ...fake }), { ok: true });
  assert.deepEqual(JSON.parse(fake.calls[1].body), payload);
  reservations[0].everyone = 'read-only';
  assert.deepEqual(await verifyPrivateNtfyTopic({ topic, token, ...fake }), { ok: false, reason: 'ntfy_topic_not_private' });
  assert.equal((await publishNtfySafely({ token, payload, ...fake })).ok, true);
  assert.deepEqual(JSON.parse(fake.calls[3].body), payload);
  assert.deepEqual(fake.calls.map(call => call.method), ['GET', 'POST', 'GET', 'POST']);
});

test('명시적 계정 조회 실패·잘못된 JSON·네트워크 오류는 비공개로 판정하지 않으며 원문을 반환하지 않는다', async () => {
  const failingFetches = [
    server([], { accountStatus: 401 }).fetchImpl,
    server([], { accountStatus: 503 }).fetchImpl,
    async () => new Response(token),
    async () => { throw new Error(`${topic}/${token}/${payload.message}`); },
  ];
  for (const fetchImpl of failingFetches) {
    const result = await verifyPrivateNtfyTopic({ topic, token, fetchImpl });
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), secretPattern);
  }
});

test('계정 조회 권한과 무관하게 인증된 POST 한 번으로 전체 알림을 발행한다', async () => {
  const fake = server([], { accountStatus: 401 });
  assert.deepEqual(await publishNtfySafely({ token, payload, ...fake }), { ok: true });
  assert.deepEqual(fake.calls.map(call => call.method), ['POST']);
  assert.deepEqual(JSON.parse(fake.calls[0].body), payload);
});

test('명시적 비공개 검사는 공개·미소유·중복 예약을 읽기 전용으로 거절한다', async () => {
  for (const reservations of [
    [], null, [{ topic: 'someone-else', everyone: 'deny-all' }], [{ topic }],
    [{ topic, everyone: 'deny-all' }, { topic, everyone: 'read-only' }],
    ...['read-write', 'read-only', 'write-only', 'unknown'].map(everyone => [{ topic, everyone }]),
  ]) {
    const fake = server(reservations);
    assert.deepEqual(await verifyPrivateNtfyTopic({ topic, token, ...fake }), { ok: false, reason: 'ntfy_topic_not_private' });
    assert.deepEqual(fake.calls.map(call => call.method), ['GET']);
  }
});

test('발송 API 오류 응답의 토픽·토큰·메시지도 반환하지 않는다', async () => {
  const result = await publishNtfySafely({ token, payload, ...server([{ topic, everyone: 'deny-all' }], { publishStatus: 500 }) });
  assert.deepEqual(result, { ok: false, reason: 'ntfy_publish_failed' });
  assert.doesNotMatch(JSON.stringify(result), secretPattern);
});

test('발행의 15초 제한·리다이렉트 거절·네트워크 실패 처리와 비밀정보 없는 반환을 유지한다', async (t) => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, 'timeout', (delay) => {
    assert.equal(delay, 15_000);
    return controller.signal;
  });
  for (const name of ['Error', 'TimeoutError', 'TypeError']) {
    let requests = 0;
    const result = await publishNtfySafely({ token, payload, fetchImpl: async (url, options) => {
      requests += 1;
      assert.equal(url, 'https://ntfy.sh');
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      assert.equal(options.signal, controller.signal);
      assert.equal(options.headers.Authorization, `Bearer ${token}`);
      assert.equal(options.headers['Content-Type'], 'application/json');
      throw Object.assign(new Error(`${topic}/${token}/${payload.message}`), { name });
    } });
    assert.equal(requests, 1);
    assert.deepEqual(result, { ok: false, reason: 'ntfy_publish_failed' });
    assert.doesNotMatch(JSON.stringify(result), secretPattern);
  }
});

test('CLI 사전검사는 허용된 토픽 환경변수 별칭만 받고 실제 토픽은 인자로 받지 않는다', async () => {
  const fake = server([{ topic, everyone: 'deny-all' }]);
  const env = { NTFY_TOKEN: token, NTFY_TOPIC_OPS: topic };
  assert.deepEqual(await checkNtfyTopicAlias('NTFY_TOPIC_OPS', { env, ...fake }), { ok: true });
  assert.equal((await checkNtfyTopicAlias(topic, { env, ...fake })).ok, false);
  assert.equal((await checkNtfyTopicAlias('NTFY_TOKEN', { env, ...fake })).ok, false);
  assert.equal(fake.calls.length, 1);
});

test('인증·토픽 설정이 없거나 경로가 잘못되면 네트워크 요청도 하지 않는다', async () => {
  let requests = 0;
  const fetchImpl = async () => { requests += 1; throw new Error('must not fetch'); };
  for (const options of [{ topic }, { token }, { token, topic: '../private' }, { topic, token: '  ' }, { token, topic: 'a'.repeat(65) }]) {
    assert.equal((await verifyPrivateNtfyTopic({ ...options, fetchImpl })).ok, false);
    const result = await publishNtfySafely({ token: options.token, payload: { ...payload, topic: options.topic }, fetchImpl });
    assert.deepEqual(result, { ok: false, reason: 'ntfy_not_configured' });
    assert.doesNotMatch(JSON.stringify(result), secretPattern);
  }
  assert.equal(requests, 0);
});

test('단일 클라이언트와 모든 수준의 sendAlert가 원문을 보내되 로그에 원문은 없다', async (t) => {
  const fake = server([]);
  const logs = [];
  t.mock.method(globalThis, 'fetch', fake.fetchImpl);
  t.mock.method(console, 'warn', (...args) => logs.push(args.join(' ')));
  t.mock.method(console, 'log', (...args) => logs.push(args.join(' ')));
  const keys = ['NTFY_TOKEN', 'NTFY_TOPIC', 'NTFY_TOPIC_CRITICAL', 'NTFY_TOPIC_WARN', 'NTFY_TOPIC_DIGEST'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.NTFY_TOKEN = token;
    for (const key of keys.slice(1)) process.env[key] = topic;
    assert.equal((await createNtfyClient(topic, token)(payload.title, payload.message)).ok, true);
    for (const level of ['info', 'critical', 'warn', 'digest']) {
      assert.equal((await sendAlert({ ...payload, level })).ok, true);
    }
    assert.equal(fake.calls.length, 5);
    const outgoing = fake.calls.filter(call => call.method === 'POST').map(call => JSON.parse(call.body));
    assert.deepEqual(outgoing, [
      { topic, title: payload.title, message: payload.message, priority: 3 },
      ...[4, 5, 3, 2].map(priority => ({ topic, title: payload.title, message: payload.message, priority, tags: payload.tags })),
    ]);
    assert.doesNotMatch(logs.join('\n'), secretPattern);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('공개 알림 수준과 알 수 없는 입력은 고정 allowlist 값만 출력한다', () => {
  for (const level of ['info', 'critical', 'warn', 'digest', 'constructor', 'fixture-student-phone']) {
    const outgoing = publicNtfyPayload(topic, level, 'fixture-student-name');
    assert.deepEqual(Object.keys(outgoing).sort(), ['message', 'priority', 'tags', 'title', 'topic']);
    assert.equal(outgoing.message, '강사앱의 수업·상담 등 관련 항목을 확인해주세요.\nhttps://tiantian-chinese.pages.dev/');
    assert.doesNotMatch(JSON.stringify(outgoing), /fixture-student/);
    assert.ok([2, 3, 4, 5].includes(outgoing.priority));
  }
});

test('수업·상담·숙제 제목과 본문도 고정 분류로 대체하지 않는다', async () => {
  for (const title of [
    '📅 내일 수업 안내 — fixture-student-name',
    '새 상담 신청 알림: fixture-student-phone',
    '새 숙제 제출 알림: fixture-student-name',
  ]) {
    const fake = server([]);
    await publishNtfySafely({ token, payload: { ...payload, title }, ...fake });
    const outgoing = JSON.parse(fake.calls[0].body);
    assert.deepEqual(outgoing, { ...payload, title });
  }
});

test('워크플로 CLI는 동적 본문을 받지 않고 8개 고정 종류로만 발송한다', async () => {
  const kinds = ['pwa-build-failed', 'worker-build-failed', 'archive-complete', 'archive-failed', 'payments-backup-complete', 'payments-backup-failed', 'weekly-backup-complete', 'weekly-backup-failed'];
  const fake = server([]);
  const env = { NTFY_TOKEN: token, NTFY_TOPIC_OPS: topic };
  for (const kind of kinds) {
    assert.deepEqual(await sendWorkflowNtfy('NTFY_TOPIC_OPS', kind, { env, ...fake }), { ok: true });
  }
  assert.equal((await sendWorkflowNtfy('NTFY_TOPIC_OPS', 'constructor', { env, ...fake })).ok, false);
  assert.equal((await sendWorkflowNtfy(topic, kinds[0], { env, ...fake })).ok, false);
  assert.equal(fake.calls.length, 8);
  for (const call of fake.calls.filter(call => call.method === 'POST')) {
    const outgoing = JSON.parse(call.body);
    assert.deepEqual(Object.keys(outgoing).sort(), ['message', 'priority', 'tags', 'title', 'topic']);
    assert.doesNotMatch(outgoing.message, /fixture-student|fixture-private/);
  }
});

test('워크플로의 발송 8곳은 안전 CLI만 호출하고 curl과 동적 메시지를 만들지 않는다', () => {
  let total = 0;
  for (const name of ['ci-pwa-build.yml', 'ci-worker-build.yml', 'monthly-archive.yml', 'monthly-payments-backup.yml', 'weekly-backup.yml']) {
    const source = readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
    const publishers = source.match(/node 01_automation\/ntfy_privacy\.mjs NTFY_TOPIC_(?:OPS|CRITICAL) [a-z-]+/g) || [];
    assert.doesNotMatch(source, /curl[^\n]+https:\/\/ntfy\.sh|\bMSG=/);
    assert.ok(publishers.every(line => !line.includes('$')));
    total += publishers.length;
  }
  assert.equal(total, 8);
});
