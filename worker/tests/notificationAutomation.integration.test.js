import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNtfyClient, createSolapiClient, runWithAlert, sendAlert } from '../../01_automation/notion_utils.mjs';

const ntfyToken = 'fixture-ntfy-secret-token';
const topic = 'fixture-notification-topic';
const title = '가상학생 수업 안내';
const message = '가상학생 14:00\n\n수업 · 상담 · 숙제\r\n준비물: 교재  2권';
const solapiConfig = {
  apiKey: 'fixture-solapi-api-key',
  apiSecret: 'fixture-solapi-api-secret',
  pfId: 'fixture-kakao-profile',
};
const recipient = '01000000000';
let previousExitCode;

function logText() {
  return ['log', 'warn', 'error'].flatMap(method => console[method].mock.calls)
    .map(args => args.map(String).join(' ')).join('\n');
}

function expectPrivateLogs() {
  const logs = logText();
  for (const secret of [ntfyToken, solapiConfig.apiKey, solapiConfig.apiSecret, recipient, title, message]) {
    expect(logs).not.toContain(secret);
  }
}

function respondAt(endpoint, response) {
  fetch.mockImplementation(async (url, options) => {
    if (url !== endpoint || options?.method !== 'POST') throw new Error('Unexpected isolated request');
    return response;
  });
}

beforeEach(() => {
  // Unknown endpoints also fail locally: these tests must never reach an external service.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected isolated request'); }));
  for (const method of ['log', 'warn', 'error']) vi.spyOn(console, method).mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('Use process.exitCode instead of terminating the test process'); });
  previousExitCode = process.exitCode;
  process.exitCode = 0;
  vi.stubEnv('NTFY_TOKEN', ntfyToken);
  for (const key of ['NTFY_TOPIC', 'NTFY_TOPIC_CRITICAL', 'NTFY_TOPIC_WARN', 'NTFY_TOPIC_DIGEST', 'NTFY_TOPIC_OPS']) {
    vi.stubEnv(key, topic);
  }
});

afterEach(() => {
  process.exitCode = previousExitCode;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe.each([
  ['legacy ntfy client', () => createNtfyClient(process.env.NTFY_TOPIC, process.env.NTFY_TOKEN)(title, message)],
  ['sendAlert', () => sendAlert({ level: 'warn', title, message })],
])('%s delivery contract', (_name, send) => {
  it.each(['token', 'topic'])('rejects missing %s without a network request', async missing => {
    if (missing === 'token') vi.stubEnv('NTFY_TOKEN', '');
    else {
      for (const key of ['NTFY_TOPIC', 'NTFY_TOPIC_CRITICAL', 'NTFY_TOPIC_WARN', 'NTFY_TOPIC_DIGEST']) vi.stubEnv(key, '');
    }
    await expect(send()).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expectPrivateLogs();
  });

  it('rejects HTTP 503 without logging upstream secrets or reporting success', async () => {
    respondAt('https://ntfy.sh', Response.json({ error: `${ntfyToken} ${message}` }, { status: 503 }));
    const failure = await send().then(() => null, error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain(ntfyToken);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(logText()).not.toMatch(/전송 완료|발송 완료|접수 완료/);
    expectPrivateLogs();
  });

  it('rejects a disconnected request without exposing its raw exception', async () => {
    fetch.mockRejectedValue(new Error(`ECONNRESET ${ntfyToken} ${title} ${message}`));
    const failure = await send().then(() => null, error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain(ntfyToken);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(logText()).not.toMatch(/전송 완료|발송 완료|접수 완료/);
    expectPrivateLogs();
  });

  it('returns explicit success and preserves original spacing and line endings', async () => {
    respondAt('https://ntfy.sh', Response.json({ id: 'fixture-notification' }));
    await expect(send()).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://ntfy.sh');
    expect(options).toMatchObject({ method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${ntfyToken}` } });
    expect(JSON.parse(options.body)).toMatchObject({ topic, title, message, priority: 3 });
    expectPrivateLogs();
  });
});

describe('runWithAlert keeps the main failure observable', () => {
  it('does not send an alert or alter exit status when main succeeds', async () => {
    const main = vi.fn(async () => {});
    await expect(runWithAlert('fixture-script.mjs', main)).resolves.toBeUndefined();
    expect(main).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('keeps exit code 1 after successfully reporting the original failure', async () => {
    const original = new Error('fixture-main-failed');
    respondAt('https://ntfy.sh', Response.json({ id: 'fixture-critical-alert' }));
    await expect(runWithAlert('fixture-script.mjs', async () => { throw original; })).resolves.toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(process.exit).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('[fixture-script.mjs] 실패:', original);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      topic, priority: 5, tags: ['rotating_light', 'github-actions'],
    });
    expect(JSON.parse(fetch.mock.calls[0][1].body).message).toContain('fixture-main-failed');
  });

  it.each(['unconfigured', 'HTTP 503', 'disconnected'])('catches a %s critical alert failure without losing the main failure', async failureKind => {
    const original = new Error('fixture-main-failed');
    if (failureKind === 'unconfigured') vi.stubEnv('NTFY_TOKEN', '');
    else if (failureKind === 'HTTP 503') respondAt('https://ntfy.sh', new Response(null, { status: 503 }));
    else fetch.mockRejectedValue(new Error(`ECONNRESET ${ntfyToken}`));
    await expect(runWithAlert('fixture-script.mjs', async () => { throw original; })).resolves.toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(process.exit).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('[fixture-script.mjs] 실패:', original);
    expect(fetch).toHaveBeenCalledTimes(failureKind === 'unconfigured' ? 0 : 1);
    expect(logText()).not.toContain(ntfyToken);
  });

  it('turns a failed notification in main into a failed automation run', async () => {
    vi.stubEnv('NTFY_TOPIC_CRITICAL', 'fixture-critical-topic');
    fetch.mockImplementation(async (url, options) => {
      if (url !== 'https://ntfy.sh' || options?.method !== 'POST') throw new Error('Unexpected isolated request');
      return new Response(null, { status: 503 });
    });
    await expect(runWithAlert('fixture-notification.mjs', () => sendAlert({ level: 'warn', title, message }))).resolves.toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([, options]) => JSON.parse(options.body).topic)).toEqual([topic, 'fixture-critical-topic']);
    expectPrivateLogs();
  });
});

describe('automation Solapi delivery contract', () => {
  const send = (config = solapiConfig, to = recipient, templateId = 'fixture-template', buttons) =>
    createSolapiClient(config)(to, templateId, { '#{수업시간}': '14:00' }, buttons);

  it.each(['apiKey', 'apiSecret', 'pfId', 'to', 'templateId'])('rejects a missing %s instead of silently succeeding', async field => {
    const config = { ...solapiConfig, ...(['apiKey', 'apiSecret', 'pfId'].includes(field) ? { [field]: '' } : {}) };
    await expect(send(config, field === 'to' ? '' : recipient, field === 'templateId' ? '' : 'fixture-template')).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expectPrivateLogs();
  });

  it.each([
    ['failed status code', { statusCode: '3040', statusMessage: `rejected ${solapiConfig.apiSecret} ${recipient}` }],
    ['API error code', { errorCode: 'InvalidParameter', errorMessage: `rejected ${solapiConfig.apiKey}` }],
  ])('rejects a 2xx response containing a %s', async (_label, body) => {
    respondAt('https://api.solapi.com/messages/v4/send', Response.json(body));
    const failure = await send().then(() => null, error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.result).toMatchObject({ ok: false, state: 'failed' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(logText()).not.toMatch(/발송 완료|접수 완료/);
    expectPrivateLogs();
    expect(String(failure)).not.toContain(solapiConfig.apiSecret);
  });

  it.each([
    [400, 'failed'],
    [503, 'unknown'],
  ])('reports HTTP %s as %s without retrying or logging response contents', async (status, state) => {
    respondAt('https://api.solapi.com/messages/v4/send', Response.json({ errorMessage: `${solapiConfig.apiKey} ${recipient}` }, { status }));
    const failure = await send().then(() => null, error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.result).toMatchObject({ ok: false, state });
    expect(fetch).toHaveBeenCalledTimes(1);
    expectPrivateLogs();
  });

  it('treats a disconnected request as unknown and does not retry automatically', async () => {
    fetch.mockRejectedValue(new Error(`ECONNRESET ${solapiConfig.apiSecret} ${recipient}`));
    const failure = await send().then(() => null, error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.result).toMatchObject({ ok: false, state: 'unknown' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expectPrivateLogs();
    expect(String(failure)).not.toContain(solapiConfig.apiSecret);
  });

  it.each(['', '{}', 'not-json', '{"messageId":"fixture-id-without-status"}'])('does not mark an inconclusive 2xx body as accepted: %s', async body => {
    respondAt('https://api.solapi.com/messages/v4/send', new Response(body, { status: 200 }));
    const failure = await send().then(() => null, error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.result).toMatchObject({ ok: false, state: 'unknown' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expectPrivateLogs();
  });

  it('returns acceptance explicitly and preserves template variables without adding absent buttons', async () => {
    respondAt('https://api.solapi.com/messages/v4/send', Response.json({ statusCode: '2000', messageId: 'fixture-message-id' }));
    await expect(send()).resolves.toMatchObject({ ok: true, state: 'accepted' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://api.solapi.com/messages/v4/send');
    expect(options.headers.Authorization).toMatch(/^HMAC-SHA256 /);
    expect(options.headers.Authorization).toContain(`apiKey=${solapiConfig.apiKey}`);
    expect(JSON.parse(options.body)).toEqual({ message: {
      to: recipient,
      kakaoOptions: { pfId: solapiConfig.pfId, templateId: 'fixture-template', variables: { '#{수업시간}': '14:00' } },
    } });
    expectPrivateLogs();
  });
});

describe('ntfy workflow CLI exit status', () => {
  it.each([
    ['unconfigured', 1],
    ['HTTP 503', 1],
    ['disconnected', 1],
    ['accepted', 0],
  ])('exits with the correct status for %s', (scenario, expectedStatus) => {
    const cliUrl = new URL('../../01_automation/ntfy_privacy.mjs', import.meta.url);
    // The child inherits no credentials. Its only fetch implementation is this local fixture.
    const script = `
      const scenario = ${JSON.stringify(scenario)};
      globalThis.fetch = async (url, options) => {
        if (url !== 'https://ntfy.sh' || options?.method !== 'POST') throw new Error('Unexpected isolated request');
        if (scenario === 'disconnected') throw new Error('ECONNRESET fixture-ntfy-secret-token');
        return new Response(null, { status: scenario === 'HTTP 503' ? 503 : 200 });
      };
      process.argv = [process.execPath, ${JSON.stringify(fileURLToPath(cliUrl))}, 'NTFY_TOPIC_OPS', 'archive-complete'];
      await import(${JSON.stringify(cliUrl.href)});
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8', timeout: 10_000, windowsHide: true,
      env: {
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        NTFY_TOPIC_OPS: topic,
        NTFY_TOKEN: scenario === 'unconfigured' ? '' : ntfyToken,
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(expectedStatus);
    expect(result.stdout + result.stderr).not.toContain(ntfyToken);
    expect(result.stdout + result.stderr).not.toContain(topic);
  });
});
