import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { localD1 } from './helpers/localD1.js';

const JOBS = [
  ['daily-brief', 'notify-daily-brief.yml', 8, 9],
  ['student-tomorrow', 'notify-student-tomorrow.yml', 17, 18],
  ['consult-tomorrow', 'notify-consult-tomorrow.yml', 17, 18],
  ['upcoming-classes', 'notify-upcoming-classes.yml', 21, 22],
];
const atHour = hour => `2026-09-09T${String(hour).padStart(2, '0')}:00:00+09:00`;
let local;
beforeEach(() => {
  local = localD1();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { local.close(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function invoke() {
  const pending = [];
  const ctx = { waitUntil: promise => pending.push(promise) };
  await worker.scheduled({}, { GAME_DB: local.db, GITHUB_PAT: 'isolated-scheduler-key' }, ctx);
  await Promise.all(pending);
}

function fakeHistory(targetWorkflow, createdAt) {
  vi.stubGlobal('fetch', vi.fn(async (raw, init = {}) => {
    const url = new URL(raw);
    expect(url.origin).toBe('https://api.github.com');
    if (url.pathname.endsWith('/dispatches')) {
      expect(init.redirect).toBe('manual');
      return new Response(null, { status: 204 });
    }
    const match = url.pathname.match(/\/actions\/workflows\/([^/]+)\/runs$/);
    if (!match) throw new Error('Non-mocked endpoint denied');
    // Return old entries even outside the requested API filter to verify the
    // production client-side time boundary, not only its query string.
    return Response.json({ workflow_runs: [{ created_at: match[1] === targetWorkflow ? createdAt : new Date().toISOString() }] });
  }));
}

describe('Worker scheduler recognizes success only in the current notification window', () => {
  it.each(JOBS)('%s ignores an earlier same-day success and dispatches the current target', async (event, workflow, from, now) => {
    vi.setSystemTime(new Date(atHour(now)));
    fakeHistory(workflow, '2026-09-09T00:30:00+09:00');
    await invoke();
    const query = fetch.mock.calls.map(([raw]) => new URL(raw)).find(url => url.pathname.endsWith(`/${workflow}/runs`));
    expect(query.searchParams.get('created')).toBe(`${atHour(from)}..2026-09-10T00:00:00+09:00`);
    const dispatched = fetch.mock.calls.filter(([url]) => url.endsWith('/dispatches'));
    expect(dispatched).toHaveLength(1);
    expect(JSON.parse(dispatched[0][1].body)).toMatchObject({ event_type: event, client_payload: { source: 'worker-cron', kstHour: now } });
  });
  it.each(JOBS)('%s still skips a successful execution exactly at its window start', async (_event, workflow, from, now) => {
    vi.setSystemTime(new Date(atHour(now)));
    fakeHistory(workflow, atHour(from));
    await invoke();
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/dispatches'))).toHaveLength(0);
  });
  it('does not count success one millisecond before the student window', async () => {
    vi.setSystemTime(new Date(atHour(18)));
    fakeHistory('notify-student-tomorrow.yml', new Date(new Date(atHour(17)).getTime() - 1).toISOString());
    await invoke();
    const dispatched = fetch.mock.calls.filter(([url]) => url.endsWith('/dispatches'));
    expect(dispatched).toHaveLength(1);
    expect(JSON.parse(dispatched[0][1].body).event_type).toBe('student-tomorrow');
  });
  it.each([0, 7, 12, 16])('keeps the existing schedule: KST %s does not query or dispatch notification jobs', async hour => {
    vi.setSystemTime(new Date(atHour(hour)));
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network must not be called outside the window'); }));
    await invoke();
    expect(fetch).not.toHaveBeenCalled();
  });
});
