import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const scriptCases = [
  { kind: 'student', script: 'notify_student_tomorrow.mjs', workflow: 'notify-student-tomorrow.yml' },
  { kind: 'consult', script: 'notify_consult_tomorrow.mjs', workflow: 'notify-consult-tomorrow.yml' },
];
const prefix = '[notification-ledger:v1] ';
const firstPhone = '01000000001';
const secondPhone = '01000000002';
const fixedNow = '2026-09-09T10:00:00.000Z'; // 19:00 KST, within the D-1 sending window.

// Serialized into a fresh Node process. It has no inherited test state or real fetch fallback.
async function childMain(config) {
  const NativeDate = Date;
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [config.fixedNow])); }
    static now() { return NativeDate.parse(config.fixedNow); }
  };
  const captured = { logs: [], posts: [], sends: [], accepted: [], groupRequests: [], groups: structuredClone(config.groups),
    notionCalls: 0, logDownloads: 0, alerts: 0, unexpected: 0, batchErrors: [], historyRanges: [] };
  let nextGroup = 0;
  const sendAttempts = new Map();
  for (const method of ['log', 'warn', 'error']) {
    console[method] = (...args) => {
      captured.logs.push(args.map(value => typeof value === 'string' ? value : String(value)).join(' '));
      for (const value of args) if (value?.counts) captured.batchErrors.push(value.counts);
    };
  }
  // Script main() is launched asynchronously; beforeExit observes its completed work and exitCode.
  process.once('beforeExit', () => { process.stdout.write(JSON.stringify(captured)); });
  const unexpected = () => {
    captured.unexpected++;
    throw new Error('Unexpected isolated endpoint or request');
  };
  const list = results => Response.json({ results, has_more: false, next_cursor: null });
  const types = [
    ['fixture-regular-type', '정규 수업'],
    ['fixture-consult-type', '무료상담'],
    ['fixture-oneday-type', '원데이클래스'],
  ].map(([id, name]) => ({ id, properties: { '타이틀': { title: [{ plain_text: name }] } } }));
  const students = [1, 2].map(number => ({
    id: `fixture-student-${number}`,
    properties: {
      '이름': { title: [{ plain_text: `가상학생${number}` }] },
      '전화번호': { phone_number: `010-0000-000${number}` },
    },
  }));
  const classes = config.noRecipients ? [] : [1, 2].map(number => ({
    id: `fixture-class-${number}`,
    properties: {
      '수업 일시': { date: { start: `${config.classDay}T${number === 1 ? '14' : '15'}:00:00+09:00` } },
      '수업 유형': { relation: [{ id: config.kind === 'student' ? 'fixture-regular-type'
        : number === 1 ? 'fixture-consult-type' : 'fixture-oneday-type' }] },
      '학생': { relation: [{ id: `fixture-student-${number}` }] },
      '수업 시간(분)': { select: { name: '60' } },
      '제목': { title: [{ plain_text: `가상상담${number}` }] },
      '전화번호': { rich_text: [{ plain_text: `010-0000-000${number}` }] },
    },
  }));
  const githubBase = '/repos/fixture/notification-tests';
  const runPath = `${githubBase}/actions/workflows/${config.workflow}/runs`;
  const history = config.history;
  const pastRuns = history.map(entry => ({
    id: entry.runId, run_attempt: 1, status: 'completed', conclusion: entry.conclusion,
    created_at: entry.createdAt,
  }));
  globalThis.fetch = async (raw, options = {}) => {
    const url = new URL(raw);
    const method = options.method || 'GET';
    if (url.origin === 'https://api.github.com') {
      if (method !== 'GET' || options.headers?.Authorization !== 'Bearer fixture-github-token') return unexpected();
      if (url.pathname === runPath) {
        if (config.successLookupUnavailable && url.searchParams.get('status') === 'success') {
          return Response.json({ message: 'Fixture success lookup unavailable' }, { status: 503 });
        }
        const candidates = url.searchParams.get('status') === 'success'
          ? pastRuns.filter(run => run.conclusion === 'success')
          : [...pastRuns, {
            id: config.runId, run_attempt: 1, status: 'in_progress', conclusion: null,
            created_at: config.fixedNow,
          }];
        const range = url.searchParams.get('created');
        if (!range) return unexpected();
        if (!url.searchParams.has('status')) captured.historyRanges.push(range);
        const [since, until] = range.split('..').map(value => Date.parse(value));
        if (!Number.isFinite(since) || !Number.isFinite(until)) return unexpected();
        const runs = candidates.filter(run => Date.parse(run.created_at) >= since && Date.parse(run.created_at) <= until);
        return Response.json({ total_count: runs.length, workflow_runs: runs });
      }
      const jobs = url.pathname.match(/^\/repos\/fixture\/notification-tests\/actions\/runs\/(\d+)\/attempts\/1\/jobs$/);
      if (jobs) {
        const prior = history.find(entry => entry.runId === Number(jobs[1]));
        if (!prior) return unexpected();
        return Response.json({ total_count: 1, jobs: [{
          id: prior.runId * 10 + 1, run_id: prior.runId, status: 'completed', conclusion: prior.conclusion,
          started_at: prior.createdAt,
        }] });
      }
      const logs = url.pathname.match(/^\/repos\/fixture\/notification-tests\/actions\/jobs\/(\d+)\/logs$/);
      if (logs && history.some(entry => entry.runId * 10 + 1 === Number(logs[1]))) {
        return new Response(null, { status: 302, headers: { Location: `https://logs.fixture.invalid/jobs/${logs[1]}` } });
      }
      return unexpected();
    }
    if (url.origin === 'https://logs.fixture.invalid') {
      if (method !== 'GET' || options.headers?.Authorization) return unexpected();
      const prior = history.find(entry => url.pathname === `/jobs/${entry.runId * 10 + 1}`);
      if (!prior) return unexpected();
      captured.logDownloads++;
      return new Response(prior.logs.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    if (url.origin === 'https://api.notion.com') {
      if (options.headers?.Authorization !== 'Bearer fixture-notion-token') return unexpected();
      captured.notionCalls++;
      if (method === 'POST' && url.pathname === '/v1/databases/314838fa-f2a6-81c3-b4e4-da87c48f9b43/query') return list(types);
      if (method === 'POST' && url.pathname === '/v1/databases/314838fa-f2a6-8143-a6c7-e59c50f3bbdb/query') return list(students);
      if (method === 'POST' && url.pathname === '/v1/databases/314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb/query') {
        const conditions = JSON.parse(options.body).filter.and;
        const since = Date.parse(conditions.find(condition => condition.date?.on_or_after).date.on_or_after);
        const until = Date.parse(conditions.find(condition => condition.date?.before).date.before);
        return list(classes.filter(entry => {
          const start = Date.parse(entry.properties['수업 일시'].date.start);
          return start >= since && start < until;
        }));
      }
      if (method === 'GET') {
        const student = students.find(entry => url.pathname === `/v1/pages/${entry.id}`);
        if (student) return Response.json(student);
      }
      return unexpected();
    }
    if (url.origin === 'https://api.solapi.com') {
      if (!options.headers?.Authorization?.includes('apiKey=fixture-solapi-key')) return unexpected();
      captured.groupRequests.push({ method, path: url.pathname });
      const view = group => ({ groupId: group.groupId, status: group.status, allowDuplicates: false,
        customFields: group.customFields, count: group.count, ...(group.dateSent ? { dateSent: group.dateSent } : {}) });
      if (method === 'POST' && url.pathname === '/messages/v4/groups') {
        const body = JSON.parse(options.body);
        if (body.allowDuplicates !== false || !/^[a-f0-9]{64}$/.test(body.customFields?.notificationKey || '')) return unexpected();
        const group = { groupId: `G4V${String(config.runId).padStart(25, '0')}${String(++nextGroup).padStart(4, '0')}`,
          status: 'PENDING', customFields: body.customFields, message: null,
          count: { registeredSuccess: 0, registeredFailed: 0, sentTotal: 0, sentSuccess: 0, sentFailed: 0,
            sentPending: 0, sentReplacement: 0, total: 0 } };
        captured.groups.push(group);
        return Response.json(view(group));
      }
      const match = url.pathname.match(/^\/messages\/v4\/groups\/(G4V[a-zA-Z0-9]{29})(?:\/(messages|send))?$/);
      const group = match && captured.groups.find(entry => entry.groupId === match[1]);
      if (!group) return unexpected();
      if (method !== 'GET') {
        const persisted = [...history.flatMap(entry => entry.logs), ...captured.logs].some(line => {
          if (!line.startsWith('[notification-ledger:v1] ')) return false;
          const fields = line.slice('[notification-ledger:v1] '.length).split(' ');
          return fields[5] === group.customFields.notificationKey && fields[6] === `solapi-group:${group.groupId}`;
        });
        if (!persisted) return unexpected();
      }
      if (method === 'GET' && !match[2]) {
        if (group.status !== 'PENDING' && config.outcomes[group.message?.to] === 'lost-response-deferred') {
          throw new Error('ECONNRESET fixture-solapi-secret');
        }
        return Response.json(view(group));
      }
      if (method === 'PUT' && match[2] === 'messages') {
        const body = JSON.parse(options.body);
        if (!Array.isArray(body.messages) || body.messages.length !== 1) return unexpected();
        const payload = body.messages[0];
        if (!['01000000001', '01000000002'].includes(payload.to) || payload.kakaoOptions?.pfId !== 'fixture-kakao-profile') return unexpected();
        captured.posts.push({ to: payload.to, templateId: payload.kakaoOptions.templateId, groupId: group.groupId });
        if (config.outcomes[payload.to] === 'failed') {
          return Response.json({ errorCode: 'InvalidParameter', errorMessage: 'private-provider-response' }, { status: 400 });
        }
        // Duplicate registration must never add a second recipient to the same group.
        if (group.message) return Response.json({ errorCode: 'DuplicateMessage' }, { status: 400 });
        group.message = payload;
        group.count.registeredSuccess = 1;
        group.count.total = 1;
        return Response.json({ ...view(group), errorCount: 0, successCount: 1,
          messageList: { 'fixture-message-id': { messageId: 'fixture-message-id', groupId: group.groupId } } });
      }
      if (method === 'POST' && match[2] === 'send' && group.message) {
        if (JSON.stringify(JSON.parse(options.body)) !== '{}') return unexpected();
        const outcome = config.outcomes[group.message.to] || 'accepted';
        const attempt = (sendAttempts.get(group.groupId) || 0) + 1;
        sendAttempts.set(group.groupId, attempt);
        captured.sends.push({ groupId: group.groupId, to: group.message.to });
        if (outcome === 'unknown' || (outcome === 'transient-unknown' && attempt === 1)) {
          throw new Error('ECONNRESET fixture-solapi-secret');
        }
        if (group.status === 'PENDING') {
          group.status = 'SENDING';
          group.count.sentTotal = 1;
          group.count.sentPending = 1;
          group.dateSent = config.fixedNow;
          captured.accepted.push({ groupId: group.groupId, to: group.message.to });
        }
        if (outcome === 'lost-response' || outcome === 'lost-response-deferred') {
          throw new Error('ECONNRESET fixture-solapi-secret');
        }
        return Response.json(view(group));
      }
      return unexpected();
    }
    if (url.origin === 'https://ntfy.sh' && url.pathname === '/') {
      if (method !== 'POST' || options.headers?.Authorization !== 'Bearer fixture-ntfy-token') return unexpected();
      captured.alerts++;
      return Response.json({ id: 'fixture-critical-alert' });
    }
    return unexpected();
  };
  // Keep Vitest's import transform out of the source serialized into plain Node.
  await new Function('url', 'return import(url)')(config.scriptUrl);
}

function runScript(scriptCase, {
  runId = 100, history = [], outcomes = {}, event = 'workflow_dispatch', noRecipients = false,
  clock = fixedNow, classDay = '2026-09-10', successLookupUnavailable = false,
  groups = history.at(-1)?.groups || [],
} = {}) {
  const config = {
    ...scriptCase, runId, history, groups, outcomes, noRecipients, fixedNow: clock, classDay, successLookupUnavailable,
    scriptUrl: new URL(`../../01_automation/${scriptCase.script}`, import.meta.url).href,
  };
  const result = spawnSync(process.execPath, ['--input-type=module'], {
    input: `await (${childMain.toString()})(${JSON.stringify(config)});`,
    encoding: 'utf8', timeout: 25_000, windowsHide: true,
    env: {
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      NOTION_TOKEN: 'fixture-notion-token',
      GITHUB_TOKEN: 'fixture-github-token', GITHUB_REPOSITORY: 'fixture/notification-tests',
      GITHUB_RUN_ID: String(runId), GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_NAME: event,
      SOLAPI_API_KEY: 'fixture-solapi-key', SOLAPI_API_SECRET: 'fixture-solapi-secret',
      KAKAO_PFID: 'fixture-kakao-profile', KAKAO_TPL_STU_TOMORROW: 'fixture-student-template',
      KAKAO_TPL_CONSULT_TOMORROW: 'fixture-consult-template', KAKAO_TPL_ONEDAY_TOMORROW: 'fixture-oneday-template',
      NTFY_TOKEN: 'fixture-ntfy-token', NTFY_TOPIC: 'fixture-notification-topic', NTFY_TOPIC_CRITICAL: 'fixture-critical-topic',
    },
  });
  // Raw script output is retained only in memory, never forwarded to the test console.
  expect(Boolean(result.error)).toBe(false);
  expect(result.stderr.length).toBe(0);
  const captured = JSON.parse(result.stdout);
  expect(captured.unexpected).toBe(0);
  expect(captured.logs.join('\n')).not.toMatch(/fixture-(?:notion-token|github-token|solapi-key|solapi-secret|ntfy-token)|0100000000[12]|가상학생|가상상담|private-provider-response/);
  return { ...captured, status: result.status, runId, createdAt: clock };
}

const asHistory = (run, conclusion = run.status === 0 ? 'success' : 'failure') => ({ runId: run.runId, createdAt: run.createdAt,
  conclusion, logs: run.logs, groups: run.groups });
const checkpoints = run => run.logs.filter(line => line.startsWith(prefix)).map(line => line.slice(prefix.length).split(' '));
const states = run => checkpoints(run).map(fields => fields[6]).filter(state => !state.startsWith('solapi-group:'));
const legacyRecipientHistory = (run, state) => {
  const fields = checkpoints(run).filter(entry => !entry[6].startsWith('solapi-group:'));
  const secondKey = run.groups.find(group => group.message?.to === secondPhone).customFields.notificationKey;
  const logs = fields.map((entry, sequence) => {
    const signed = entry.slice(0, 7);
    signed[4] = String(sequence);
    if (signed[5] === secondKey && signed[6] === 'accepted') signed[6] = state;
    const signature = createHmac('sha256', 'fixture-solapi-secret')
      .update(`notification-ledger/v1\n${JSON.stringify(signed)}`).digest('hex');
    return `${prefix}${signed.join(' ')} ${signature}`;
  });
  return { ...asHistory(run, 'failure'), logs, groups: [] };
};
const legacyHistory = conclusion => ({
  runId: 99,
  createdAt: '2026-09-09T08:00:00.000Z', // 17:00 KST, before signed ledger logs were introduced.
  conclusion,
  logs: ['[2026-09-09T08:00:00.000Z] D-1 알림 시작', `알림 실행 ${conclusion}`],
});

describe.each(scriptCases)('$script recipient retry integration', scriptCase => {
  it('restores signed failed-run logs in a fresh process and only retries the rejected recipient', () => {
    const first = runScript(scriptCase, { outcomes: { [secondPhone]: 'failed' } });
    expect(first.status).toBe(1);
    expect(first.posts.map(post => post.to)).toEqual([firstPhone, secondPhone]);
    expect(first.posts.map(post => post.templateId)).toEqual(scriptCase.kind === 'student'
      ? ['fixture-student-template', 'fixture-student-template'] : ['fixture-consult-template', 'fixture-oneday-template']);
    expect(first.batchErrors).toEqual([{ sent: 1, alreadyAccepted: 0, failed: 1, unknown: 0 }]);
    expect(states(first)).toEqual(['start', 'pending', 'accepted', 'pending', 'failed']);
    expect(first.alerts).toBe(1);

    const retry = runScript(scriptCase, { runId: 101, history: [asHistory(first)] });
    expect(retry.status).toBe(0);
    expect(retry.logDownloads).toBe(1);
    expect(retry.posts.map(post => post.to)).toEqual([secondPhone]);
    expect(states(retry)).toEqual(['start', 'pending', 'accepted']);
    expect(retry.batchErrors).toEqual([]);
    expect(retry.alerts).toBe(0);
  });

  it('skips scheduled delivery after a successful run today without querying Notion', () => {
    const successful = runScript(scriptCase);
    expect(successful.status).toBe(0);
    expect(successful.posts).toHaveLength(2);
    const backup = runScript(scriptCase, { runId: 101, history: [asHistory(successful)], event: 'schedule' });
    expect(backup.status).toBe(0);
    expect(backup.logDownloads).toBe(0);
    expect(backup.posts).toEqual([]);
    expect(backup.notionCalls).toBe(0);
    expect(backup.alerts).toBe(0);
    expect(states(backup)).toEqual(['start']);
  });

  it.each([
    { event: 'schedule', clock: '2026-09-09T10:30:00.000Z' },
    { event: 'repository_dispatch', clock: '2026-09-09T10:30:00.000Z' },
    { event: 'schedule', clock: '2026-09-09T14:43:00.000Z' },
    { event: 'repository_dispatch', clock: '2026-09-09T14:43:00.000Z' },
  ])('skips $event at $clock after a legacy success without restoring old logs', ({ event, clock }) => {
    const backup = runScript(scriptCase, { history: [legacyHistory('success')], event, clock });
    expect(backup.status).toBe(0);
    expect(backup.logDownloads).toBe(0);
    expect(backup.posts).toEqual([]);
    expect(backup.notionCalls).toBe(0);
    expect(backup.alerts).toBe(0);
    expect(states(backup)).toEqual(['start']);
  });

  it.each(['schedule', 'repository_dispatch'])('keeps an unrecognised legacy failure closed for %s', event => {
    const backup = runScript(scriptCase, {
      history: [legacyHistory('failure')], event, clock: '2026-09-09T10:30:00.000Z',
    });
    expect(backup.status).toBe(1);
    expect(backup.logDownloads).toBe(1);
    expect(backup.posts).toEqual([]);
    expect(backup.notionCalls).toBe(0);
    expect(backup.alerts).toBe(1);
    expect(backup.logs.join('\n')).toContain('[unrecognized_log]');
    expect(states(backup)).toEqual(['start']);
  });

  it('still requires recognisable delivery history for manual retries after a legacy success', () => {
    const manual = runScript(scriptCase, { history: [legacyHistory('success')] });
    expect(manual.status).toBe(1);
    expect(manual.logDownloads).toBe(1);
    expect(manual.posts).toEqual([]);
    expect(manual.notionCalls).toBe(0);
    expect(manual.alerts).toBe(1);
    expect(manual.logs.join('\n')).toContain('[unrecognized_log]');
    expect(states(manual)).toEqual(['start']);
  });

  it.each([
    { event: 'schedule', successLookupUnavailable: false },
    { event: 'repository_dispatch', successLookupUnavailable: false },
    { event: 'schedule', successLookupUnavailable: true },
    { event: 'repository_dispatch', successLookupUnavailable: true },
  ])('fails a late $event when success cannot be confirmed (lookup unavailable: $successLookupUnavailable)', ({ event, successLookupUnavailable }) => {
    const late = runScript(scriptCase, {
      event, successLookupUnavailable, clock: '2026-09-09T14:43:00.000Z',
      history: successLookupUnavailable ? [legacyHistory('success')] : [],
    });
    expect(late.status).toBe(1);
    expect(late.logDownloads).toBe(0);
    expect(late.posts).toEqual([]);
    expect(late.notionCalls).toBe(0);
    expect(late.alerts).toBe(1);
    expect(states(late)).toEqual(['start']);
  });

  it('restores a skipped backup log on a later manual retry without resending accepted notifications', () => {
    const successful = runScript(scriptCase, { clock: '2026-09-09T08:00:00.000Z' });
    expect(successful.status).toBe(0);
    expect(successful.posts).toHaveLength(2);
    const backup = runScript(scriptCase, {
      runId: 101, history: [asHistory(successful)], event: 'schedule', clock: '2026-09-09T10:30:00.000Z',
    });
    expect(backup.status).toBe(0);
    expect(backup.logDownloads).toBe(0);
    expect(states(backup)).toEqual(['start']);
    const manual = runScript(scriptCase, {
      runId: 102, history: [asHistory(successful), asHistory(backup)], clock: '2026-09-09T11:00:00.000Z',
    });
    expect(manual.status).toBe(0);
    expect(manual.logDownloads).toBe(2);
    expect(manual.posts).toEqual([]);
    expect(manual.batchErrors).toEqual([]);
    expect(manual.alerts).toBe(0);
    expect(states(manual)).toEqual(['start']);
  });

  it('finishes with no delivery POST when there are no target classes', () => {
    const empty = runScript(scriptCase, { noRecipients: true });
    expect(empty.status).toBe(0);
    expect(empty.notionCalls).toBeGreaterThan(0);
    expect(empty.posts).toEqual([]);
    expect(empty.alerts).toBe(0);
    expect(states(empty)).toEqual(['start']);
  });

  it.each(['accepted', 'lost-response-deferred'])('preserves the prior evening %s history after midnight in a fresh manual run', outcome => {
    const evening = runScript(scriptCase, { outcomes: { [secondPhone]: outcome } });
    expect(evening.status).toBe(outcome === 'accepted' ? 0 : 1);
    expect(evening.posts).toHaveLength(2);

    const midnight = runScript(scriptCase, {
      runId: 101, history: [asHistory(evening)], clock: '2026-09-09T15:05:00.000Z',
    });
    expect(midnight.status).toBe(0);
    expect(midnight.posts).toEqual([]);
    expect(midnight.sends).toEqual([]);
    expect(midnight.accepted).toEqual([]);
    expect(midnight.groups).toHaveLength(evening.groups.length);
    expect(midnight.logDownloads).toBe(1);
    expect(midnight.historyRanges).toEqual(['2026-09-08T15:00:00.000Z..2026-09-10T14:59:59.999Z']);
    expect(midnight.logs.find(line => line.startsWith(prefix)).slice(prefix.length).split(' ')[1]).toBe('2026-09-09');
    expect(midnight.batchErrors).toEqual([]);
  }, 20_000);

  it('restores an acceptance recorded after midnight on the next manual retry', () => {
    const evening = runScript(scriptCase, { outcomes: { [secondPhone]: 'failed' } });
    expect(evening.status).toBe(1);
    const midnight = runScript(scriptCase, {
      runId: 101, history: [asHistory(evening)], clock: '2026-09-09T15:05:00.000Z',
    });
    expect(midnight.status).toBe(0);
    expect(midnight.posts.map(post => post.to)).toEqual([secondPhone]);
    const later = runScript(scriptCase, {
      runId: 102, history: [asHistory(evening), asHistory(midnight)], clock: '2026-09-09T15:30:00.000Z',
    });
    expect(later.status).toBe(0);
    expect(later.posts).toEqual([]);
    expect(later.logDownloads).toBe(2);
    expect(later.batchErrors).toEqual([]);
  });

  it.each(['schedule', 'repository_dispatch'])('fails a delayed overnight %s run without sending recipient notifications', event => {
    const overnight = runScript(scriptCase, { event, clock: '2026-09-09T15:05:00.000Z' });
    expect(overnight.status).toBe(1);
    expect(overnight.posts).toEqual([]);
    expect(overnight.notionCalls).toBe(0);
    expect(overnight.alerts).toBe(1);
    expect(states(overnight)).toEqual(['start']);
  });

  it('does not let a pre-17:00 manual success suppress the new evening batch', () => {
    const afternoon = runScript(scriptCase, { clock: '2026-09-09T06:00:00.000Z', classDay: '2026-09-09' });
    expect(afternoon.status).toBe(0);
    expect(afternoon.posts).toHaveLength(2);
    const evening = runScript(scriptCase, { runId: 101, history: [asHistory(afternoon)], event: 'schedule' });
    expect(evening.status).toBe(0);
    expect(evening.posts.map(post => post.to)).toEqual([firstPhone, secondPhone]);
    expect(evening.alerts).toBe(0);
  });

  it('recovers an accepted group after the send response is lost without a duplicate delivery', () => {
    const first = runScript(scriptCase, { outcomes: { [secondPhone]: 'lost-response' } });
    expect(first.status).toBe(0);
    expect(first.posts.map(post => post.to)).toEqual([firstPhone, secondPhone]);
    expect(first.accepted.map(post => post.to)).toEqual([firstPhone, secondPhone]);
    expect(first.sends.filter(post => post.to === secondPhone)).toHaveLength(1);
    expect(first.batchErrors).toEqual([]);
    expect(first.groups).toHaveLength(2);
    const groupRecords = checkpoints(first).filter(fields => fields[6].startsWith('solapi-group:G4V'));
    expect(groupRecords.map(fields => fields[6].slice('solapi-group:'.length)).sort())
      .toEqual(first.groups.map(group => group.groupId).sort());

    const retry = runScript(scriptCase, { runId: 101, history: [asHistory(first)] });
    expect(retry.status).toBe(0);
    expect(retry.posts).toEqual([]);
    expect(retry.sends).toEqual([]);
    expect(retry.accepted).toEqual([]);
    expect(retry.groups).toHaveLength(2);
  }, 20_000);

  it('resumes the same registered group in a fresh process after a send was never received', () => {
    const first = runScript(scriptCase, { outcomes: { [secondPhone]: 'unknown' } });
    expect(first.status).toBe(1);
    expect(first.posts.map(post => post.to)).toEqual([firstPhone, secondPhone]);
    expect(first.accepted.map(post => post.to)).toEqual([firstPhone]);
    expect(first.batchErrors).toEqual([{ sent: 1, alreadyAccepted: 0, failed: 0, unknown: 1 }]);
    expect(states(first)).toEqual(['start', 'pending', 'accepted', 'pending', 'unknown']);
    const originalGroup = first.groups.find(group => group.message?.to === secondPhone);
    expect(originalGroup.status).toBe('PENDING');

    const retry = runScript(scriptCase, { runId: 101, history: [asHistory(first)] });
    expect(retry.status).toBe(0);
    expect(retry.logDownloads).toBe(1);
    expect(retry.posts).toEqual([]);
    expect(retry.sends).toEqual([{ groupId: originalGroup.groupId, to: secondPhone }]);
    expect(retry.accepted).toEqual([{ groupId: originalGroup.groupId, to: secondPhone }]);
    expect(retry.groups).toHaveLength(2);
    expect(retry.batchErrors).toEqual([]);

    const later = runScript(scriptCase, { runId: 102, history: [asHistory(first), asHistory(retry)] });
    expect(later.status).toBe(0);
    expect(later.posts).toEqual([]);
    expect(later.sends).toEqual([]);
    expect(later.accepted).toEqual([]);
  }, 20_000);

  it('recovers a transient send failure in the same run using one group and one registration', () => {
    const run = runScript(scriptCase, { outcomes: { [secondPhone]: 'transient-unknown' } });
    expect(run.status).toBe(0);
    expect(run.posts.map(post => post.to)).toEqual([firstPhone, secondPhone]);
    expect(run.accepted.map(post => post.to)).toEqual([firstPhone, secondPhone]);
    const attempts = run.sends.filter(post => post.to === secondPhone);
    expect(attempts).toHaveLength(2);
    expect(new Set(attempts.map(post => post.groupId)).size).toBe(1);
    expect(run.groups).toHaveLength(2);
    expect(run.batchErrors).toEqual([]);
  }, 20_000);

  it.each(['pending', 'unknown'])('keeps a legacy signed %s without a group on hold', state => {
    const completed = runScript(scriptCase);
    const history = legacyRecipientHistory(completed, state);
    const retry = runScript(scriptCase, { runId: 101, history: [history] });
    expect(retry.status).toBe(1);
    expect(retry.logDownloads).toBe(1);
    expect(retry.posts).toEqual([]);
    expect(retry.sends).toEqual([]);
    expect(retry.groupRequests).toEqual([]);
    expect(retry.batchErrors).toEqual([{ sent: 0, alreadyAccepted: 1, failed: 0, unknown: 1 }]);
    expect(states(retry)).toEqual(['start']);
  });
});
