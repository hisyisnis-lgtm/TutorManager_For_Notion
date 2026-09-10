import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNotificationLedger, notificationDeliveryKey } from '../../01_automation/notification_ledger.mjs';

const workflow = 'notify-student-tomorrow.yml';
const day = '2026-09-09';
const secret = 'synthetic-ledger-signing-secret';
const env = { GITHUB_TOKEN: 'synthetic-github-token', GITHUB_REPOSITORY: 'fixture/repository', GITHUB_RUN_ID: '900', GITHUB_RUN_ATTEMPT: '1' };
const key = notificationDeliveryKey(['student', 'class-fixture', '01000000000'], secret);
const otherKey = notificationDeliveryKey(['student', 'other-class'], secret);
const deliveryStep = (extra = {}) => ({
  name: '학생 전날 수업 리마인더 발송', status: 'completed', conclusion: 'skipped', started_at: null, ...extra,
});
const run = (id = 100, extra = {}) => ({ id, run_attempt: 1, status: 'completed', conclusion: 'failure', created_at: '2026-09-09T00:00:00Z', ...extra });
const job = (runId = 100, attempt = 1, extra = {}) => ({
  id: Number(runId) * 10 + attempt, run_id: runId, status: 'completed', conclusion: 'failure',
  started_at: `2026-09-09T0${attempt}:00:00Z`, ...extra,
});

function marker({ runId = '100', attempt = 1, seq = 0, markedDay = day, markedWorkflow = workflow, deliveryKey = '-', state = 'start', signingSecret = secret } = {}) {
  const fields = [markedWorkflow, markedDay, String(runId), String(attempt), String(seq), deliveryKey, state];
  const signature = createHmac('sha256', signingSecret).update(`notification-ledger/v1\n${JSON.stringify(fields)}`).digest('hex');
  return `2026-09-09T01:00:00.1234567Z [notification-ledger:v1] ${fields.join(' ')} ${signature}`;
}
const logLines = (states, overrides = {}) => [marker(overrides), ...states.map((state, index) => marker({ ...overrides, seq: index + 1, deliveryKey: key, state }))].join('\n');

function fixture({ runs = [], logs = {}, jobs = {}, override } = {}) {
  return vi.fn(async (raw, options) => {
    const url = new URL(raw);
    const overridden = override && await override(url, options);
    if (overridden !== undefined) return overridden;
    if (url.hostname === 'api.github.com' && url.pathname.endsWith('/runs')) {
      const page = Number(url.searchParams.get('page'));
      const start = (page - 1) * 20;
      return Response.json({ total_count: runs.length, workflow_runs: runs.slice(start, start + 20) }, {
        headers: runs.length > start + 20 ? { Link: '<https://api.github.com/ignored-next>; rel="next"' } : {},
      });
    }
    const attemptPath = url.pathname.match(/\/runs\/(\d+)\/attempts\/(\d+)\/jobs$/);
    if (url.hostname === 'api.github.com' && attemptPath) {
      const [, id, attempt] = attemptPath;
      const list = jobs[`${id}/${attempt}`] || [job(Number(id), Number(attempt))];
      return Response.json({ total_count: list.length, jobs: list });
    }
    const logPath = url.pathname.match(/\/jobs\/(\d+)\/logs$/);
    if (url.hostname === 'api.github.com' && logPath) {
      return new Response(null, { status: 302, headers: { Location: `https://logs.fixture.invalid/${logPath[1]}?signed=synthetic` } });
    }
    if (url.hostname === 'logs.fixture.invalid') {
      return new Response(logs[url.pathname.slice(1)] ?? 'legacy unmarked log', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    throw new Error('Unexpected synthetic URL; never access the network');
  });
}
const create = (fetchImpl = fixture(), options = {}) => createNotificationLedger({ workflow, day, secret, env, fetchImpl, log: vi.fn(), ...options });
afterEach(() => { vi.useRealTimers(); });

describe('signed recipient notification checkpoints', () => {
  it('uses deterministic, domain-separated HMAC without delimiter collisions', () => {
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).toBe(notificationDeliveryKey(['student', 'class-fixture', '01000000000'], secret));
    expect(notificationDeliveryKey(['a', 'bc'], secret)).not.toBe(notificationDeliveryKey(['ab', 'c'], secret));
    expect(notificationDeliveryKey(['a'], secret)).not.toBe(notificationDeliveryKey(['a'], 'another-secret'));
  });

  it('records start before any I/O, keeps record synchronous and never logs PII or credentials', async () => {
    const log = vi.fn();
    const fetchImpl = fixture({ override: () => { expect(log).toHaveBeenCalledTimes(1); } });
    const ledger = await create(fetchImpl, { log });
    expect(ledger.get(key)).toBeUndefined();
    expect(ledger.record(key, 'pending')).toBe('pending');
    expect(ledger.get(key)).toBe('pending');
    expect(ledger.record(key, 'accepted')).toBe('accepted');
    expect(ledger.record(key, 'failed')).toBe('accepted');
    expect(log).toHaveBeenCalledTimes(3);
    const output = log.mock.calls.flat().join('\n');
    expect(output).not.toContain('01000000000');
    expect(output).not.toContain('class-fixture');
    expect(output).not.toContain(secret);
    expect(output).not.toContain(env.GITHUB_TOKEN);
    for (const line of log.mock.calls.flat()) {
      const fields = line.slice('[notification-ledger:v1] '.length).split(' ');
      expect(fields.pop()).toBe(createHmac('sha256', secret).update(`notification-ledger/v1\n${JSON.stringify(fields)}`).digest('hex'));
    }
  });

  it.each(['pending', 'accepted', 'failed', 'unknown'])('restores %s from a completed failed run', async state => {
    const ledger = await create(fixture({ runs: [run()], logs: { 1001: logLines([state]) } }));
    expect(ledger.get(key)).toBe(state);
  });

  it('uses latest checkpoints but never regresses accepted to a later failure', async () => {
    const ledger = await create(fixture({
      runs: [run(101, { conclusion: 'cancelled' }), run(100, { conclusion: 'success' })],
      jobs: { '101/1': [job(101, 1, { started_at: '2026-09-09T03:00:00Z' })] },
      logs: {
        1001: logLines(['pending', 'accepted']) + '\n' + marker({ seq: 3, deliveryKey: otherKey, state: 'failed' }),
        1011: logLines(['failed'], { runId: '101' }) + '\n' + marker({ runId: '101', seq: 2, deliveryKey: otherKey, state: 'unknown' }),
      },
    }));
    expect(ledger.get(key)).toBe('accepted');
    expect(ledger.get(otherKey)).toBe('unknown');
  });

  it('restores previous attempts of the current run while excluding its active attempt', async () => {
    const fetchImpl = fixture({
      runs: [run(900, { run_attempt: 3, status: 'in_progress' })],
      logs: { 9001: logLines(['failed'], { runId: '900', attempt: 1 }), 9002: logLines(['unknown'], { runId: '900', attempt: 2 }) },
    });
    const ledger = await create(fetchImpl, { env: { ...env, GITHUB_RUN_ATTEMPT: '3' } });
    expect(ledger.get(key)).toBe('unknown');
    expect(fetchImpl.mock.calls.some(([url]) => url.includes('/attempts/3/'))).toBe(false);
  });

  it('includes current-run earlier attempts even if the original run was created yesterday', async () => {
    const ledger = await create(fixture({
      logs: { 9001: logLines(['accepted'], { runId: '900', markedDay: '2026-09-08' }) },
    }), { env: { ...env, GITHUB_RUN_ATTEMPT: '2' } });
    expect(ledger.get(key)).toBeUndefined();
  });

  it('restores the same intended-day partition across different runs after midnight', async () => {
    const fetchImpl = fixture({
      runs: [run(101, { created_at: '2026-09-09T15:10:00Z', conclusion: 'success' }), run()],
      jobs: { '101/1': [job(101, 1, { started_at: '2026-09-09T15:10:00Z' })] },
      logs: { 1001: logLines(['unknown']), 1011: logLines(['accepted'], { runId: '101' }) },
    });
    const log = vi.fn();
    const ledger = await create(fetchImpl, { historyUntilDay: '2026-09-10', log });
    expect(ledger.get(key)).toBe('accepted');
    expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get('created'))
      .toBe('2026-09-08T15:00:00.000Z..2026-09-10T14:59:59.999Z');
    expect(log.mock.calls[0][0]).toContain(`${workflow} 2026-09-09 `);
  });

  it('widens history lookup without consuming a different signed intended-day partition', async () => {
    const ledger = await create(fixture({
      runs: [run(101, { created_at: '2026-09-09T15:10:00Z' }), run()],
      jobs: { '101/1': [job(101, 1, { started_at: '2026-09-09T15:10:00Z' })] },
      logs: { 1001: logLines(['unknown']), 1011: logLines(['accepted'], { runId: '101', markedDay: '2026-09-10' }) },
    }), { historyUntilDay: '2026-09-10' });
    expect(ledger.get(key)).toBe('unknown');
  });

  it.each(['2026-09-08', '2026-09-11', '2026-9-10', '2026-02-30', null])('rejects invalid or excessively wide historyUntilDay %s before I/O', async historyUntilDay => {
    const fetchImpl = fixture();
    const log = vi.fn();
    await expect(create(fetchImpl, { historyUntilDay, log })).rejects.toMatchObject({ reason: 'configuration' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('accepts a valid signed start-only run as genuinely having no recipient checkpoints', async () => {
    const ledger = await create(fixture({ runs: [run()], logs: { 1001: marker() } }));
    expect(ledger.get(key)).toBeUndefined();
  });

  it('paginates over more than 20 runs and does not trust the next-link destination', async () => {
    const runs = Array.from({ length: 21 }, (_, index) => run(index + 100));
    const logs = Object.fromEntries(runs.map(value => [value.id * 10 + 1, marker({ runId: value.id })]));
    const fetchImpl = fixture({ runs, logs });
    await create(fetchImpl);
    const runCalls = fetchImpl.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/runs'));
    expect(runCalls).toHaveLength(2);
    expect(new URL(runCalls[1][0]).searchParams.get('page')).toBe('2');
    expect(new URL(runCalls[0][0]).searchParams.get('created')).toBe('2026-09-08T15:00:00.000Z..2026-09-09T14:59:59.999Z');
  });

  it('keeps GitHub authorization only on API calls, not redirected plain-text downloads', async () => {
    const fetchImpl = fixture({ runs: [run()], logs: { 1001: marker() } });
    await create(fetchImpl);
    for (const [raw, options] of fetchImpl.mock.calls) {
      expect(options.redirect).toBe('manual');
      expect(options.credentials).toBe('omit');
      expect(options.referrerPolicy).toBe('no-referrer');
      if (new URL(raw).hostname === 'api.github.com') expect(options.headers.Authorization).toBe(`Bearer ${env.GITHUB_TOKEN}`);
      else expect(options.headers).toBeUndefined();
    }
  });

  it.each(['http://logs.fixture.invalid/log', 'https://user:pass@logs.fixture.invalid/log', 'https://logs.fixture.invalid:8443/log', 'https://logs.fixture.invalid/log#fragment'])('rejects an unsafe log redirect %s', async location => {
    const fetchImpl = fixture({ runs: [run()], override: url => url.pathname.endsWith('/logs')
      ? new Response(null, { status: 302, headers: { Location: location } }) : undefined });
    await expect(create(fetchImpl)).rejects.toMatchObject({ code: 'NOTIFICATION_LEDGER_UNAVAILABLE' });
    expect(fetchImpl.mock.calls.every(([url]) => new URL(url).hostname === 'api.github.com')).toBe(true);
  });

  it.each([401, 403, 404, 429, 500])('fails closed on API HTTP %i without leaking response content', async status => {
    const log = vi.fn();
    const fetchImpl = vi.fn(async () => new Response('private-name phone secret-body', { status }));
    const failure = await create(fetchImpl, { log }).catch(error => error);
    expect(failure.code).toBe('NOTIFICATION_LEDGER_UNAVAILABLE');
    expect(failure.message).not.toMatch(/private-name|phone|secret-body/);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it.each(['legacy plain log', '', marker({ signingSecret: 'wrong-secret' }), marker({ runId: '999' }), marker({ markedWorkflow: 'other.yml' }), marker() + '\n' + marker()])('fails closed on missing, tampered or replayed log markers %#', async contents => {
    await expect(create(fixture({ runs: [run()], logs: { 1001: contents } }))).rejects.toMatchObject({ code: 'NOTIFICATION_LEDGER_UNAVAILABLE' });
  });

  it('blocks an earlier in-progress run before reading its incomplete logs', async () => {
    const fetchImpl = fixture({ runs: [run(100, { status: 'in_progress' })] });
    await expect(create(fetchImpl)).rejects.toMatchObject({ reason: 'active_run' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(['queued', 'requested', 'pending'])('ignores a provably unstarted %s attempt but restores its older attempts', async status => {
    const fetchImpl = fixture({
      runs: [run(100, { status, conclusion: null, run_attempt: 2 })],
      jobs: { '100/2': [] },
      logs: { 1001: logLines(['accepted']) },
    });
    const ledger = await create(fetchImpl);
    expect(ledger.get(key)).toBe('accepted');
    expect(fetchImpl.mock.calls.some(([url]) => url.includes('/jobs/1002/logs'))).toBe(false);
    expect(fetchImpl.mock.calls.some(([url]) => url.includes('/attempts/2/jobs'))).toBe(true);
  });

  it('ignores an explicitly queued job with null start and no executed steps', async () => {
    const fetchImpl = fixture({ runs: [run(100, { status: 'pending', conclusion: null })],
      jobs: { '100/1': [job(100, 1, { status: 'queued', conclusion: null, started_at: null, steps: [] })] } });
    const ledger = await create(fetchImpl);
    expect(ledger.get(key)).toBeUndefined();
    expect(fetchImpl.mock.calls.some(([url]) => url.endsWith('/logs'))).toBe(false);
  });

  it.each([
    { status: 'in_progress', started_at: '2026-09-09T01:00:00Z', steps: [] },
    { status: 'queued', started_at: '2026-09-09T01:00:00Z', steps: [] },
    { status: 'queued', started_at: null, steps: undefined },
    { status: 'queued', started_at: null, steps: [deliveryStep({ conclusion: 'success' })] },
  ])('keeps an indeterminate or partly executed queued attempt fail-closed %#', async extra => {
    await expect(create(fixture({ runs: [run(100, { status: 'queued', conclusion: null })],
      jobs: { '100/1': [job(100, 1, extra)] } }))).rejects.toMatchObject({ reason: 'active_run' });
  });

  it('does not ignore waiting runs or an unavailable queued-attempt jobs response', async () => {
    await expect(create(fixture({ runs: [run(100, { status: 'waiting' })] }))).rejects.toMatchObject({ reason: 'active_run' });
    const fetchImpl = fixture({ runs: [run(100, { status: 'queued', conclusion: null })], override: url => url.pathname.endsWith('/jobs')
      ? new Response('unavailable', { status: 503 }) : undefined });
    await expect(create(fetchImpl)).rejects.toMatchObject({ reason: 'history_unavailable' });
  });

  it('rejects gaps in signed checkpoints and mixed-day records inside one job', async () => {
    for (const tail of [marker({ seq: 2, deliveryKey: key, state: 'failed' }), marker({ seq: 1, markedDay: '2026-09-08', deliveryKey: key, state: 'failed' })]) {
      await expect(create(fixture({ runs: [run()], logs: { 1001: marker() + '\n' + tail } }))).rejects.toThrow();
    }
  });

  it('fails closed rather than assuming an incomplete or excessive history is empty', async () => {
    for (const data of [{}, { total_count: 2, workflow_runs: [] }, { total_count: 51, workflow_runs: [] }]) {
      await expect(create(vi.fn(async () => Response.json(data)))).rejects.toMatchObject({ code: 'NOTIFICATION_LEDGER_UNAVAILABLE' });
    }
  });

  it('rejects a truncated job-list page and any unfinished job', async () => {
    await expect(create(fixture({ runs: [run()], jobs: { '100/1': [job(100, 1, { status: 'in_progress' })] } }))).rejects.toThrow();
    await expect(create(fixture({ runs: [run()], override: url => url.pathname.endsWith('/jobs')
      ? Response.json({ total_count: 2, jobs: [job()] }) : undefined }))).rejects.toThrow();
  });

  it.each(['cancelled', 'skipped'])('allows a completed %s run that provably created zero jobs', async conclusion => {
    const fetchImpl = fixture({ runs: [run(100, { conclusion })], jobs: { '100/1': [] } });
    const ledger = await create(fetchImpl);
    expect(ledger.get(key)).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('checks an earlier current-run attempt before treating zero jobs as a pre-start cancellation', async () => {
    const fetchImpl = fixture({ jobs: { '900/1': [] }, override: url => url.pathname.endsWith('/attempts/1')
      ? Response.json(run(900, { conclusion: 'cancelled' })) : undefined });
    const ledger = await create(fetchImpl, { env: { ...env, GITHUB_RUN_ATTEMPT: '2' } });
    expect(ledger.get(key)).toBeUndefined();
    expect(fetchImpl.mock.calls.some(([url]) => url.endsWith('/runs/900/attempts/1'))).toBe(true);
    expect(fetchImpl.mock.calls.some(([url]) => url.endsWith('/logs'))).toBe(false);
  });

  it('allows an async skip before legacy successful history is read while preserving its signed start', async () => {
    const log = vi.fn();
    const fetchImpl = fixture({ runs: [run(100, { conclusion: 'success' })] });
    const shouldSkip = vi.fn(async () => {
      expect(log).toHaveBeenCalledExactlyOnceWith(marker({ runId: env.GITHUB_RUN_ID }).replace(/^\S+ /, ''));
      expect(fetchImpl).not.toHaveBeenCalled();
      return true;
    });
    await expect(create(fetchImpl, { log, shouldSkip })).resolves.toBeNull();
    expect(shouldSkip).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([false, undefined, 'true', 1])('keeps legacy history fail-closed when the skip callback returns %s', async result => {
    const log = vi.fn();
    const fetchImpl = fixture({ runs: [run(100, { conclusion: 'success' })] });
    const shouldSkip = vi.fn(async () => result);
    await expect(create(fetchImpl, { log, shouldSkip })).rejects.toMatchObject({ reason: 'unrecognized_log' });
    expect(shouldSkip).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledExactlyOnceWith(marker({ runId: env.GITHUB_RUN_ID }).replace(/^\S+ /, ''));
    expect(fetchImpl.mock.calls.some(([url]) => url.endsWith('/logs'))).toBe(true);
  });

  it('propagates a skip callback failure after writing start and before restoring history', async () => {
    const log = vi.fn();
    const fetchImpl = fixture();
    const error = new Error('synthetic skip decision failed');
    const shouldSkip = vi.fn(async () => { throw error; });
    await expect(create(fetchImpl, { log, shouldSkip })).rejects.toBe(error);
    expect(shouldSkip).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledExactlyOnceWith(marker({ runId: env.GITHUB_RUN_ID }).replace(/^\S+ /, ''));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([null, true, 'true', 1, {}])('rejects a non-function skip callback before any output or I/O %#', async shouldSkip => {
    const log = vi.fn();
    const fetchImpl = fixture();
    await expect(create(fetchImpl, { log, shouldSkip })).rejects.toMatchObject({ reason: 'configuration' });
    expect(log).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('validates existing configuration before running a skip callback', async () => {
    const log = vi.fn();
    const fetchImpl = fixture();
    const shouldSkip = vi.fn(async () => true);
    await expect(create(fetchImpl, { secret: '', log, shouldSkip })).rejects.toMatchObject({ reason: 'configuration' });
    expect(shouldSkip).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure', null])('does not infer no delivery from zero jobs with conclusion %s', async conclusion => {
    await expect(create(fixture({ runs: [run(100, { conclusion })], jobs: { '100/1': [] } }))).rejects.toThrow();
  });

  it('rejects missing or inconsistent prior-attempt metadata for zero-job results', async () => {
    for (const result of [new Response('denied', { status: 403 }), Response.json(run(999, { conclusion: 'cancelled' })), Response.json(run(900, { run_attempt: 2, conclusion: 'cancelled' }))]) {
      const fetchImpl = fixture({ jobs: { '900/1': [] }, override: url => url.pathname.endsWith('/attempts/1') ? result : undefined });
      await expect(create(fetchImpl, { env: { ...env, GITHUB_RUN_ATTEMPT: '2' } })).rejects.toThrow();
    }
  });

  it.each(['cancelled', 'skipped'])('allows a %s job with explicit null start and no executed steps', async conclusion => {
    for (const steps of [[], [deliveryStep()]]) {
      const fetchImpl = fixture({ runs: [run()], jobs: { '100/1': [job(100, 1, { conclusion, started_at: null, steps })] } });
      const ledger = await create(fetchImpl);
      expect(ledger.get(key)).toBeUndefined();
      expect(fetchImpl.mock.calls.some(([url]) => url.endsWith('/logs'))).toBe(false);
    }
  });

  it.each([
    ['notify-student-tomorrow.yml', '학생 전날 수업 리마인더 발송'],
    ['notify-consult-tomorrow.yml', '무료상담/원데이클래스 전날 리마인더 발송'],
  ])('allows checkout failure only when the exact %s delivery step is explicitly skipped', async (selectedWorkflow, stepName) => {
    const fetchImpl = fixture({ runs: [run()], jobs: { '100/1': [job(100, 1, { steps: [
      { name: 'Checkout', status: 'completed', conclusion: 'failure', started_at: '2026-09-09T01:00:00Z' },
      deliveryStep({ name: stepName, started_at: '2026-09-09T01:00:01Z' }),
    ] })] } });
    const ledger = await create(fetchImpl, { workflow: selectedWorkflow });
    expect(ledger.get(key)).toBeUndefined();
    expect(fetchImpl.mock.calls.some(([url]) => url.endsWith('/logs'))).toBe(false);
  });

  it.each([
    [deliveryStep({ name: 'Different delivery step' })],
    [deliveryStep(), deliveryStep()],
    [deliveryStep({ conclusion: 'cancelled' })],
    [deliveryStep({ conclusion: 'failure' })],
    [deliveryStep({ status: 'in_progress' })],
    [deliveryStep({ started_at: 'invalid-date' })],
    [],
    undefined,
  ])('keeps executed or indeterminate jobs without signed start fail-closed %#', async steps => {
    await expect(create(fixture({ runs: [run()], jobs: { '100/1': [job(100, 1, { steps })] } })))
      .rejects.toMatchObject({ reason: 'unrecognized_log' });
  });

  it('does not apply the known-step exemption to an unrelated workflow', async () => {
    await expect(create(fixture({ runs: [run()], jobs: { '100/1': [job(100, 1, { steps: [deliveryStep()] })] } }), { workflow: 'other.yml' }))
      .rejects.toMatchObject({ reason: 'unrecognized_log' });
  });

  it('releases response body readers after normal reads and size-limit cancellation', async () => {
    const success = Response.json({ total_count: 0, workflow_runs: [] });
    await create(vi.fn(async () => success));
    expect(success.body.locked).toBe(false);
    const excessive = new Response('x'.repeat(2 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } });
    await expect(create(vi.fn(async () => excessive))).rejects.toMatchObject({ reason: 'history_limit' });
    expect(excessive.body.locked).toBe(false);
  });

  it('rejects ZIP, HTML and another redirect instead of pretending they contain empty plain logs', async () => {
    for (const [body, contentType, status] of [['PK\u0003\u0004zip', 'application/octet-stream', 200], ['<html>private</html>', 'text/html', 200], ['redirect', 'text/plain', 302]]) {
      const fetchImpl = fixture({ runs: [run()], override: url => url.hostname === 'logs.fixture.invalid'
        ? new Response(body, { status, headers: { 'Content-Type': contentType } }) : undefined });
      await expect(create(fetchImpl)).rejects.toThrow();
    }
  });

  it('bounds declared and streamed log size at 2 MiB', async () => {
    for (const declared of [true, false]) {
      const fetchImpl = fixture({ runs: [run()], override: url => url.hostname === 'logs.fixture.invalid'
        ? new Response('x'.repeat(2 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'text/plain', ...(declared ? { 'Content-Length': String(2 * 1024 * 1024 + 1) } : {}) } }) : undefined });
      await expect(create(fetchImpl)).rejects.toMatchObject({ reason: 'history_limit' });
    }
  });

  it('times out even when a synthetic fetch ignores AbortSignal', async () => {
    vi.useFakeTimers();
    const promise = create(vi.fn(() => new Promise(() => {})));
    const assertion = expect(promise).rejects.toMatchObject({ code: 'NOTIFICATION_LEDGER_UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it('includes a hanging log body in the per-request timeout', async () => {
    vi.useFakeTimers();
    const fetchImpl = fixture({ runs: [run()], override: url => url.hostname === 'logs.fixture.invalid'
      ? new Response(new ReadableStream({ pull: () => new Promise(() => {}) }), { headers: { 'Content-Type': 'text/plain' } }) : undefined });
    const promise = create(fetchImpl);
    const assertion = expect(promise).rejects.toMatchObject({ code: 'NOTIFICATION_LEDGER_UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it('caps the entire restoration even when individual API calls finish within their timeout', async () => {
    vi.useFakeTimers();
    const runs = Array.from({ length: 8 }, (_, index) => run(index + 100));
    const normal = fixture({ runs });
    const fetchImpl = vi.fn(async (url, options) => {
      await new Promise(resolve => setTimeout(resolve, 9_000));
      return normal(url, options);
    });
    const promise = create(fetchImpl);
    const assertion = expect(promise).rejects.toMatchObject({ code: 'NOTIFICATION_LEDGER_UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(fetchImpl).toHaveBeenCalledTimes(7);
  });

  it('rejects missing configuration, malformed keys and unsupported states without outputting inputs', async () => {
    for (const options of [{ secret: '' }, { workflow: '../bad.yml' }, { day: '2026-99-99' }, { env: { ...env, GITHUB_TOKEN: '' } }]) {
      const log = vi.fn();
      const fetchImpl = fixture();
      await expect(create(fetchImpl, { ...options, log })).rejects.toMatchObject({ reason: 'configuration' });
      expect(log).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
    }
    const ledger = await create();
    expect(() => ledger.record('phone-number', 'accepted')).toThrow();
    expect(() => ledger.record(key, 'invalid')).toThrow();
    expect(() => notificationDeliveryKey(['a'], '')).toThrow();
  });

  it('does not update the local state if synchronous checkpoint logging throws', async () => {
    const log = vi.fn();
    const ledger = await create(fixture(), { log });
    log.mockImplementation(() => { throw new Error('private logger details'); });
    expect(() => ledger.record(key, 'pending')).toThrow('알림 발송 이력');
    expect(ledger.get(key)).toBeUndefined();
  });
});
