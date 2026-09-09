import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = '[notification-ledger:v1]';
const STATES = new Set(['pending', 'accepted', 'failed', 'unknown']);
const QUEUED_RUNS = new Set(['queued', 'requested', 'pending']);
const CONCLUSIONS = new Set(['success', 'failure', 'cancelled', 'timed_out', 'neutral', 'skipped', 'stale', 'action_required', 'startup_failure']);
const DELIVERY_STEPS = {
  'notify-student-tomorrow.yml': '학생 전날 수업 리마인더 발송',
  'notify-consult-tomorrow.yml': '무료상담/원데이클래스 전날 리마인더 발송',
};
const WORKFLOW = /^[A-Za-z0-9_.-]{1,100}\.ya?ml$/;
const KEY = /^[a-f0-9]{64}$/;
const MAX_RUNS = 50;
const MAX_JOBS = 50;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const ERROR_MESSAGE = '알림 발송 이력을 안전하게 확인할 수 없어 발송을 중단했습니다.';
const REASONS = new Set(['configuration', 'history_unavailable', 'history_limit', 'active_run', 'unrecognized_log']);
const fail = (reason = 'history_unavailable') => {
  const safeReason = REASONS.has(reason) ? reason : 'history_unavailable';
  return Object.assign(new Error(`${ERROR_MESSAGE} [${safeReason}]`), { code: 'NOTIFICATION_LEDGER_UNAVAILABLE', reason: safeReason });
};
const validSecret = secret => typeof secret === 'string' && secret.length > 0 && secret.length <= 4096;
const validId = id => (typeof id === 'string' && /^[1-9]\d{0,19}$/.test(id))
  || (Number.isSafeInteger(id) && id > 0);
const validAttempt = attempt => Number.isSafeInteger(attempt) && attempt >= 1 && attempt <= MAX_RUNS;
const timestamp = value => typeof value === 'string' ? Date.parse(value) : NaN;
const dayStart = day => {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return NaN;
  const parsed = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === day
    ? Date.parse(`${day}T00:00:00+09:00`) : NaN;
};

function hmac(secret, domain, value) {
  return createHmac('sha256', secret).update(`${domain}\n${JSON.stringify(value)}`).digest('hex');
}

function deliveryNeverStarted(job, workflow) {
  if (!Array.isArray(job.steps)) return false;
  const skipped = step => step && typeof step.name === 'string' && step.status === 'completed'
    && step.conclusion === 'skipped'
    && (step.started_at === null || Number.isFinite(timestamp(step.started_at)));
  // A queued job cancelled before any step ran cannot have sent a message.
  if (job.started_at === null && ['cancelled', 'skipped'].includes(job.conclusion)
    && job.steps.every(step => skipped(step) && step.started_at === null)) return true;
  // Only these two reviewed workflows have a known, single delivery-code step.
  // Failure in checkout/setup is not sufficient evidence by itself.
  const name = DELIVERY_STEPS[workflow];
  if (!name) return false;
  const targets = job.steps.filter(step => step?.name === name);
  return targets.length === 1 && skipped(targets[0]);
}

/** Opaque delivery identity; never put names, phone numbers or message text in logs. */
export function notificationDeliveryKey(parts, secret) {
  if (!validSecret(secret) || !Array.isArray(parts) || parts.length < 1 || parts.length > 16
    || !parts.every(part => typeof part === 'string' && part.length <= 1024)) throw fail('configuration');
  return hmac(secret, 'notification-delivery/v1', parts);
}

/**
 * Restore signed checkpoints from GitHub's plain-text job logs (no ZIP dependency).
 * Call record(key, 'pending') synchronously BEFORE a provider POST. Recovered
 * pending/unknown must never be automatically resent. This is not a durable DB:
 * missing/expired/legacy logs fail closed, and a lost final log tail cannot prove
 * exactly-once delivery. History uses KST run creation dates: the partition day,
 * optionally through the following day for a post-midnight retry. Earlier
 * attempts of the current run are also included. The workflow must use shared
 * concurrency so a provably queued future attempt cannot start during this run.
 */
export async function createNotificationLedger({ workflow, day, historyUntilDay = day, secret, env = process.env, fetchImpl = fetch, log = console.log }) {
  const since = dayStart(day);
  const historyEnd = dayStart(historyUntilDay);
  const oneDay = 24 * 60 * 60 * 1000;
  const until = historyEnd + oneDay;
  const runId = String(env.GITHUB_RUN_ID || '');
  const attempt = Number(env.GITHUB_RUN_ATTEMPT);
  const repository = env.GITHUB_REPOSITORY;
  if (!WORKFLOW.test(workflow || '') || !Number.isFinite(since) || !Number.isFinite(historyEnd)
    || ![0, oneDay].includes(historyEnd - since) || !validSecret(secret)
    || !validId(runId) || !validAttempt(attempt) || typeof repository !== 'string'
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
    || typeof env.GITHUB_TOKEN !== 'string' || !env.GITHUB_TOKEN || typeof log !== 'function') throw fail('configuration');

  const states = new Map();
  let sequence = 0;
  const write = (key, state) => {
    const fields = [workflow, day, runId, String(attempt), String(sequence++), key, state];
    try { log(`${PREFIX} ${fields.join(' ')} ${hmac(secret, 'notification-ledger/v1', fields)}`); }
    catch { throw fail(); }
  };
  // A failed restoration sends nothing, but its log remains recognisable on retry.
  write('-', 'start');

  const deadline = Date.now() + 60_000;
  let totalBytes = 0;
  const base = `https://api.github.com/repos/${repository}`;
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'tutor-manager-notification-ledger',
  };
  async function request(url, api, consume) {
    const remaining = Math.min(10_000, deadline - Date.now());
    if (remaining <= 0) throw fail();
    const controller = new AbortController();
    let response;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        response?.body?.cancel().catch(() => {});
        reject(fail());
      }, remaining);
    });
    try {
      return await Promise.race([(async () => {
        response = await fetchImpl(url, {
          method: 'GET', redirect: 'manual', signal: controller.signal,
          credentials: 'omit', referrerPolicy: 'no-referrer',
          ...(api ? { headers } : {}),
        });
        if (controller.signal.aborted) throw fail();
        return await consume(response);
      })(), timeout]);
    } catch (error) { throw fail(error?.reason); }
    finally { clearTimeout(timer); }
  }
  async function text(response) {
    const length = response.headers.get('Content-Length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) throw fail('history_limit');
    if (!response.body) throw fail();
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0;
    let output = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        totalBytes += value.byteLength;
        if (bytes > MAX_BYTES || totalBytes > MAX_TOTAL_BYTES) throw fail('history_limit');
        output += decoder.decode(value, { stream: true });
      }
      return output + decoder.decode();
    } finally {
      try { await reader.cancel().catch(() => {}); }
      finally { reader.releaseLock(); }
    }
  }
  async function json(path) {
    return request(`${base}${path}`, true, async response => {
      if (response.status !== 200 || !/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type') || '')) throw fail();
      return { data: JSON.parse(await text(response)), hasNext: /rel="next"/.test(response.headers.get('Link') || '') };
    });
  }
  async function jobLog(jobId) {
    const location = await request(`${base}/actions/jobs/${jobId}/logs`, true, async response => {
      if (response.status !== 302) throw fail();
      const target = new URL(response.headers.get('Location'));
      if (target.protocol !== 'https:' || target.username || target.password || target.hash
        || (target.port && target.port !== '443')) throw fail();
      await response.body?.cancel().catch(() => {});
      return target.href;
    });
    // Only a Location provided by the authenticated GitHub API is accepted.
    // Never forward its Authorization header or follow another redirect.
    return request(location, false, async response => {
      if (response.status !== 200 || !/^(?:text\/plain|application\/octet-stream)(?:;|$)/i.test(response.headers.get('Content-Type') || '')) throw fail();
      const result = await text(response);
      if (result.startsWith('PK\u0003\u0004')) throw fail();
      return result;
    });
  }

  const runs = new Map();
  let seenRuns = 0;
  for (let page = 1; page <= 3; page++) {
    const created = `${new Date(since).toISOString()}..${new Date(until - 1).toISOString()}`;
    const { data, hasNext } = await json(`/actions/workflows/${encodeURIComponent(workflow)}/runs?created=${encodeURIComponent(created)}&per_page=20&page=${page}`);
    if (!Array.isArray(data.workflow_runs) || !Number.isSafeInteger(data.total_count) || data.total_count < 0
      || data.workflow_runs.length > 20) throw fail();
    if (data.total_count > MAX_RUNS) throw fail('history_limit');
    for (const run of data.workflow_runs) {
      if (!validId(run.id) || !validAttempt(run.run_attempt) || !Number.isFinite(timestamp(run.created_at))) throw fail();
      seenRuns++;
      if (seenRuns > MAX_RUNS) throw fail('history_limit');
      if (runs.has(String(run.id))) throw fail();
      if (timestamp(run.created_at) < since || timestamp(run.created_at) >= until) throw fail();
      if (String(run.id) !== runId && run.status !== 'completed' && !QUEUED_RUNS.has(run.status)) throw fail('active_run');
      if (String(run.id) !== runId && run.status === 'completed' && !CONCLUSIONS.has(run.conclusion)) throw fail();
      if (String(run.id) === runId && run.run_attempt !== attempt) throw fail();
      runs.set(String(run.id), run);
    }
    if (!hasNext) {
      if (seenRuns !== data.total_count) throw fail();
      break;
    }
    if (!data.workflow_runs.length) throw fail();
    if (page === 3) throw fail('history_limit');
  }
  // Rerunning yesterday's run must still recover its previous attempts.
  if (!runs.has(runId)) runs.set(runId, { id: runId, run_attempt: attempt });
  const jobs = [];
  const seenJobs = new Set();
  let attempts = 0;
  for (const [id, run] of runs) {
    const lastAttempt = id === runId ? attempt - 1 : run.run_attempt;
    for (let number = 1; number <= lastAttempt; number++) {
      if (++attempts > MAX_RUNS) throw fail('history_limit');
      const { data, hasNext } = await json(`/actions/runs/${id}/attempts/${number}/jobs?per_page=50`);
      if (!Array.isArray(data.jobs) || data.total_count !== data.jobs.length || hasNext) throw fail();
      const queuedAttempt = id !== runId && QUEUED_RUNS.has(run.status) && number === run.run_attempt;
      if (data.jobs.length === 0) {
        if (queuedAttempt) continue;
        // Concurrency may cancel a queued run without ever creating a job.
        // For an earlier attempt, latest-run metadata cannot prove its outcome.
        const info = number === run.run_attempt && run.status === 'completed'
          ? run : (await json(`/actions/runs/${id}/attempts/${number}`)).data;
        if (String(info?.id) !== id || info.run_attempt !== number || info.status !== 'completed'
          || !['cancelled', 'skipped'].includes(info.conclusion)) throw fail();
        continue;
      }
      for (const job of data.jobs) {
        if (!validId(job.id) || String(job.run_id) !== id || seenJobs.has(String(job.id))) throw fail();
        seenJobs.add(String(job.id));
        if (seenJobs.size > MAX_JOBS) throw fail('history_limit');
        if (queuedAttempt) {
          const noStepRan = Array.isArray(job.steps) && job.steps.every(step => step && typeof step.name === 'string' && step.started_at === null
            && ((step.status === 'completed' && step.conclusion === 'skipped')
              || (QUEUED_RUNS.has(step.status) && step.conclusion === null)));
          const notStarted = job.started_at === null && noStepRan
            && ((QUEUED_RUNS.has(job.status) && job.conclusion === null)
              || (job.status === 'completed' && ['cancelled', 'skipped'].includes(job.conclusion)));
          if (!notStarted) throw fail('active_run');
          continue;
        }
        if (job.status !== 'completed' || !CONCLUSIONS.has(job.conclusion)) throw fail();
        if (deliveryNeverStarted(job, workflow)) continue;
        if (!Number.isFinite(timestamp(job.started_at))) throw fail();
        jobs.push({ ...job, ledgerRunId: id, ledgerAttempt: number });
      }
    }
  }
  jobs.sort((a, b) => timestamp(a.started_at) - timestamp(b.started_at) || a.ledgerAttempt - b.ledgerAttempt);
  for (const job of jobs) {
    const contents = await jobLog(job.id);
    let started = false;
    let markedJobDay;
    let previousSequence = -1;
    for (const line of contents.split(/\r?\n/)) {
      const clean = line.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z /, '');
      if (!clean.startsWith(`${PREFIX} `)) continue;
      const fields = clean.slice(PREFIX.length + 1).split(' ');
      if (fields.length !== 8) throw fail();
      const [markedWorkflow, markedDay, markedRun, markedAttempt, seq, key, state, signature] = fields;
      if (!KEY.test(signature) || !Number.isFinite(dayStart(markedDay))) throw fail();
      const expected = hmac(secret, 'notification-ledger/v1', fields.slice(0, 7));
      if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))
        || markedWorkflow !== workflow || markedRun !== job.ledgerRunId || Number(markedAttempt) !== job.ledgerAttempt
        || !/^(?:0|[1-9]\d{0,8})$/.test(seq) || Number(seq) !== previousSequence + 1) throw fail();
      previousSequence = Number(seq);
      if (state === 'start' && key === '-' && Number(seq) === 0 && !started) { started = true; markedJobDay = markedDay; continue; }
      if (!started || markedDay !== markedJobDay || !KEY.test(key) || !STATES.has(state)) throw fail();
      if (markedDay === day && states.get(key) !== 'accepted') states.set(key, state);
    }
    // No signed start means legacy, truncated or otherwise indeterminate logs.
    if (!started) throw fail('unrecognized_log');
  }

  return {
    get(key) {
      if (!KEY.test(key || '')) throw fail();
      return states.get(key);
    },
    record(key, state) {
      if (!KEY.test(key || '') || !STATES.has(state)) throw fail();
      if (states.get(key) === 'accepted') return 'accepted';
      write(key, state);
      states.set(key, state);
      return state;
    },
  };
}
