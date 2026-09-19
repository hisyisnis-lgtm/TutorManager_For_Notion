import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it.each([
  ['2026-09-18T00:10:00+09:00', true],
  ['2026-09-18T16:59:59+09:00', true],
  ['2026-09-18T17:00:00+09:00', false],
  ['2026-09-18T23:30:00+09:00', false],
])('morning briefing checks the prior evening, not a skipped backup at %s', (createdAt, shouldWarn) => {
  const scriptUrl = new URL('../../01_automation/notify_daily_brief.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module'], {
    windowsHide: true, encoding: 'utf8', timeout: 10000,
    env: {
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      NOTION_TOKEN: 'fixture-notion', GITHUB_TOKEN: 'fixture-github',
      GITHUB_REPOSITORY: 'fixture/repo', GITHUB_EVENT_NAME: 'workflow_dispatch',
      NTFY_TOPIC: 'fixture-topic', NTFY_TOKEN: 'fixture-ntfy',
    },
    input: `
      const NativeDate = Date;
      globalThis.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : ['2026-09-19T08:00:00+09:00'])); }
        static now() { return NativeDate.parse('2026-09-19T08:00:00+09:00'); }
      };
      const captured = { messages: [], ranges: [], unexpected: 0 };
      console.log = console.warn = console.error = () => {};
      globalThis.fetch = async (raw, options = {}) => {
        const url = new URL(raw);
        if (url.origin === 'https://api.notion.com' && options.method === 'POST' && url.pathname.endsWith('/query')) {
          return Response.json({ results: [], has_more: false });
        }
        if (url.origin === 'https://api.github.com' && url.pathname.endsWith('/runs')) {
          captured.ranges.push(url.searchParams.get('created'));
          // Deliberately ignore API date filtering to exercise client-side boundaries.
          return Response.json({ workflow_runs: [{ created_at: ${JSON.stringify(createdAt)} }] });
        }
        if (url.origin === 'https://ntfy.sh' && options.method === 'POST') {
          captured.messages.push(JSON.parse(options.body).message);
          return Response.json({ id: 'fixture-message' });
        }
        captured.unexpected++;
        throw new Error('Unexpected isolated request');
      };
      process.once('beforeExit', () => process.stdout.write(JSON.stringify(captured)));
      await import(${JSON.stringify(scriptUrl)});
    `,
  });
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(0);
  const captured = JSON.parse(child.stdout);
  expect(captured.unexpected).toBe(0);
  expect(captured.ranges).toEqual(Array(2).fill('2026-09-18T17:00:00+09:00..2026-09-19T00:00:00+09:00'));
  expect(captured.messages.some(message => message.includes('어제 수업 안내 미발송'))).toBe(shouldWarn);
});
