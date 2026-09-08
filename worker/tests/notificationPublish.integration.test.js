import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNtfyClient, sendAlert } from '../../01_automation/notion_utils.mjs';
import worker from '../src/index.js';
import { localD1 } from './helpers/localD1.js';

let local;
const fakeKey = 'fake-notification-key';
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async url => url === 'https://ntfy.sh/v1/account'
    ? Response.json({ username: 'test', role: 'user', reservations: ['private-general', 'private-critical', 'private-warn', 'private-digest'].map(topic => ({ topic, everyone: 'deny-all' })) })
    : Response.json({ id: 'test-notification' })));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('NTFY_TOKEN', fakeKey);
  vi.stubEnv('NTFY_TOPIC', 'private-general');
  vi.stubEnv('NTFY_TOPIC_CRITICAL', 'private-critical');
  vi.stubEnv('NTFY_TOPIC_WARN', 'private-warn');
  vi.stubEnv('NTFY_TOPIC_DIGEST', 'private-digest');
  vi.stubGlobal('caches', { default: { match: async () => undefined, put: async () => {} } });
});
afterEach(() => { local?.close(); local = null; vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('all ntfy publishing requires credentials', () => {
  it('legacy automation client and every alert level attach authentication', async () => {
    await createNtfyClient('private-general', fakeKey)('test', 'isolated message');
    for (const level of ['info', 'warn', 'critical', 'digest']) await sendAlert({ level, title: 'test', message: 'isolated message' });
    const publishes = fetch.mock.calls.filter(([url]) => url !== 'https://ntfy.sh/v1/account');
    expect(publishes).toHaveLength(5);
    for (const [url, options] of publishes) {
      expect(url).toBe('https://ntfy.sh');
      expect(options.headers.Authorization).toBe(`Bearer ${fakeKey}`);
      expect(options.redirect).toBe('error');
    }
  });
  it('missing token never falls back to anonymous publishing or logs message contents', async () => {
    vi.stubEnv('NTFY_TOKEN', '');
    await createNtfyClient('private-general', '')('private-title', 'private-message');
    for (const level of ['info', 'warn', 'critical', 'digest']) {
      expect(await sendAlert({ level, title: 'private-title', message: 'private-message' })).toEqual({ ok: false, reason: 'ntfy_not_configured' });
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(console.error.mock.calls)).not.toMatch(/private-title|private-message|private-general/);
  });
  it('Worker warn alerts authenticate the new topic; missing token suppresses publishing', async () => {
    local = localD1();
    const env = { GAME_DB: local.db, JWT_SECRET: 'test-store-key', NTFY_TOPIC: 'private-general', NTFY_TOPIC_WARN: 'private-warn', NTFY_TOKEN: fakeKey };
    const invoke = () => worker.fetch(new Request('https://worker.test/error-log', {
      method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'isolated error', url: 'https://app.test/game' }),
    }), env, { waitUntil: promise => promise.catch(() => {}) });
    expect((await invoke()).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe('https://ntfy.sh/v1/account');
    expect(JSON.parse(fetch.mock.calls[1][1].body).topic).toBe('private-warn');
    expect(JSON.parse(fetch.mock.calls[1][1].body).message).toContain('isolated error');
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${fakeKey}`);
    fetch.mockClear();
    delete env.NTFY_TOKEN;
    expect((await invoke()).status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('Worker sends only trusted static guidance to an unreserved public topic', async () => {
    local = localD1();
    const env = { GAME_DB: local.db, JWT_SECRET: 'test-store-key', NTFY_TOPIC_WARN: 'public-fixture', NTFY_TOKEN: fakeKey };
    fetch.mockImplementation(async url => url === 'https://ntfy.sh/v1/account'
      ? Response.json({ username: 'test', role: 'user', reservations: [], tokens: [{ token: 'never-log-secret' }] })
      : Response.json({ id: 'notification-id' }));
    const response = await worker.fetch(new Request('https://worker.test/error-log', {
      method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'private-client-diagnostic 김학생 01012345678 50000원', source: 'https://attacker.invalid/leak', url: 'https://app.test/personal/SECRETCODE' }),
    }), env, { waitUntil: promise => promise.catch(() => {}) });
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe('https://ntfy.sh/v1/account');
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      topic: 'public-fixture', title: '앱 오류 확인 알림',
      message: '강사앱의 수업·상담 등 관련 항목을 확인해주세요.\nhttps://tiantian-chinese.pages.dev/',
      priority: 3, tags: ['warning'],
    });
    expect(fetch.mock.calls[1][1].body).not.toMatch(/김학생|01012345678|50000|SECRETCODE|attacker|private-client-diagnostic|never-log-secret/);
    expect(JSON.stringify(console.error.mock.calls)).not.toMatch(/public-fixture|private-client-diagnostic|never-log-secret/);
  });
  it('public-topic GitHub relays contain only static guidance before leaving the Worker', async () => {
    local = localD1();
    const env = { GAME_DB: local.db, JWT_SECRET: 'test-store-key', NTFY_TOPIC: 'public-general', NTFY_TOKEN: fakeKey, NOTION_TOKEN: 'test-notion-key', GITHUB_PAT: 'fake-github-key' };
    fetch.mockImplementation(async url => {
      if (url === 'https://ntfy.sh/v1/account') return Response.json({ username: 'test', role: 'user', reservations: [] });
      if (url.endsWith('/query')) return Response.json({ results: [] });
      if (url === 'https://api.notion.com/v1/pages') return Response.json({ id: 'fake-page' });
      if (url.endsWith('/dispatches')) return new Response(null, { status: 204 });
      throw new Error('Unexpected isolated endpoint');
    });
    const response = await worker.fetch(new Request('https://worker.test/consult', {
      method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '김개인정보', phone: '01012345678', kakaoId: 'private-contact', message: 'private-consult-content' }),
    }), env, { waitUntil: promise => promise.catch(() => {}) });
    expect(response.status).toBe(200);
    const relay = fetch.mock.calls.find(([url]) => url.endsWith('/dispatches'));
    expect(relay).toBeTruthy();
    expect(JSON.parse(relay[1].body).client_payload).toEqual({
      title: '새 상담 신청 알림', message: '강사앱의 수업·상담 등 관련 항목을 확인해주세요.\nhttps://tiantian-chinese.pages.dev/', level: 'info',
    });
    expect(relay[1].body).not.toMatch(/김|5678|private-contact|private-consult-content|public-general/);
  });
});
