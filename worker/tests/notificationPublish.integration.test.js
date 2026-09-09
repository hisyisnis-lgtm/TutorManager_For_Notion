import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNtfyClient, sendAlert } from '../../01_automation/notion_utils.mjs';
import worker from '../src/index.js';
import { localD1 } from './helpers/localD1.js';
import { signTypedToken } from '../lib/auth.js';

let local;
const fakeKey = 'fake-notification-key';
function guardWorkerFetch() {
  const implementation = fetch.getMockImplementation();
  fetch.mockImplementation((url, init = {}) => {
    if (init.redirect === 'error') throw new TypeError('Unsupported redirect mode: error');
    return implementation(url, init);
  });
}
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
    guardWorkerFetch();
    const env = { GAME_DB: local.db, JWT_SECRET: 'test-store-key', NTFY_TOPIC: 'private-general', NTFY_TOPIC_WARN: 'private-warn', NTFY_TOKEN: fakeKey };
    const invoke = () => worker.fetch(new Request('https://worker.test/error-log', {
      method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'isolated error', url: 'https://app.test/game' }),
    }), env, { waitUntil: promise => promise.catch(() => {}) });
    expect((await invoke()).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://ntfy.sh');
    expect(JSON.parse(fetch.mock.calls[0][1].body).topic).toBe('private-warn');
    expect(JSON.parse(fetch.mock.calls[0][1].body).message).toContain('isolated error');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${fakeKey}`);
    expect(fetch.mock.calls[0][1].redirect).toBe('manual');
    fetch.mockClear();
    delete env.NTFY_TOKEN;
    expect((await invoke()).status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([302, 307])('Worker alert HTTP %s is logged as failure and never forwards the credential to Location', async status => {
    local = localD1();
    const env = { GAME_DB: local.db, JWT_SECRET: 'test-store-key', NTFY_TOPIC_WARN: 'public-fixture', NTFY_TOKEN: fakeKey };
    const upstream = new Response('private-redirect-body', { status, headers: { Location: 'https://redirect.fixture.invalid/credential-trap' } });
    const cancel = vi.spyOn(upstream.body, 'cancel');
    fetch.mockImplementation(async () => upstream);
    guardWorkerFetch();
    const response = await worker.fetch(new Request('https://worker.test/error-log', {
      method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'isolated error', url: 'https://app.test/game' }),
    }), env, { waitUntil: promise => promise.catch(() => {}) });
    // 오류 접수 응답은 유지하되, 그 뒤의 ntfy 발행 실패를 성공으로 기록하지 않는다.
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://ntfy.sh');
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'manual', headers: { Authorization: `Bearer ${fakeKey}` } });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(`[ntfy] 발송 실패 HTTP ${status}`);
    expect(console.log).not.toHaveBeenCalledWith('[ntfy] 발송 성공');
    expect(JSON.stringify([...console.error.mock.calls, ...console.log.mock.calls])).not.toMatch(/private-redirect-body|redirect.fixture|fake-notification-key/);
  });
  it('Worker restores detailed alerts to public topics while retaining student token masking and log privacy', async () => {
    local = localD1();
    const env = { GAME_DB: local.db, JWT_SECRET: 'test-store-key', NTFY_TOPIC_WARN: 'public-fixture', NTFY_TOKEN: fakeKey };
    fetch.mockImplementation(async url => url === 'https://ntfy.sh/v1/account'
      ? Response.json({ username: 'test', role: 'user', reservations: [], tokens: [{ token: 'never-log-secret' }] })
      : Response.json({ id: 'notification-id' }));
    guardWorkerFetch();
    const response = await worker.fetch(new Request('https://worker.test/error-log', {
      method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'private-client-diagnostic 김학생 01012345678 50000원 /personal/SECRETCODE', source: 'https://attacker.invalid/leak', url: 'https://app.test/personal/SECRETCODE' }),
    }), env, { waitUntil: promise => promise.catch(() => {}) });
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://ntfy.sh');
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload).toEqual({
      topic: 'public-fixture', title: '⚠️ PWA 클라이언트 에러',
      message: '📍 https://app.test/personal/SECR...CODE\n💬 private-client-diagnostic 김학생 01012345678 50000원 /personal/SECR...CODE\n📄 https://attacker.invalid/leak\n🌐 ',
      priority: 3, tags: ['warning', 'client'],
    });
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${fakeKey}`);
    expect(fetch.mock.calls[0][1].redirect).toBe('manual');
    expect(payload.message).not.toMatch(/SECRETCODE|never-log-secret/);
    expect(await response.text()).not.toMatch(/public-fixture|private-client-diagnostic|fake-notification-key/);
    expect(JSON.stringify([...console.error.mock.calls, ...console.log.mock.calls])).not.toMatch(/public-fixture|private-client-diagnostic|김학생|01012345678|SECRETCODE|never-log-secret/);
  });
  it('public-topic GitHub relays preserve the original detailed consultation message', async () => {
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
      body: JSON.stringify({ name: '김개인정보', phone: '01012345678', kakaoId: 'private-contact', message: 'private-consult-content',
        level: '완전 처음이에요', concerns: ['발음이 이상한 것 같아요'], reasons: ['기타 (직접 입력)'], reasonOther: '업무 회화', preferredDays: ['월', '수'], preferredTime: '오후 (12-18시)' }),
    }), env, { waitUntil: promise => promise.catch(() => {}) });
    expect(response.status).toBe(200);
    const relay = fetch.mock.calls.find(([url]) => url.endsWith('/dispatches'));
    expect(relay).toBeTruthy();
    expect(JSON.parse(relay[1].body).client_payload).toEqual({
      title: '📩 무료상담 신청',
      message: '이름: 김**\n전화: ***-****-5678\n카카오톡 ID: pr***\n수준: 완전 처음이에요\n고민: 발음이 이상한 것 같아요\n이유: 기타: 업무 회화\n희망 요일: 월, 수\n희망 시간대: 오후 (12-18시)\n※ 자세한 내용은 Notion 무료상담 DB에서 확인하세요.',
      level: 'info',
    });
    expect(relay[1].body).not.toMatch(/01012345678|private-contact|public-general|fake-notification-key|fake-github-key/);
    expect(fetch.mock.calls.some(([url]) => url === 'https://ntfy.sh/v1/account')).toBe(false);
  });
  it('public-topic history still requires the teacher JWT and allowed Origin without exposing the topic or key', async () => {
    local = localD1();
    const env = { GAME_DB: local.db, JWT_SECRET: 'test-store-key', NTFY_TOPIC: 'public-general', NTFY_TOKEN: fakeKey };
    const invoke = (token, origin = 'http://localhost:5173') => worker.fetch(new Request('https://worker.test/notifications?topic=attacker', {
      headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }), env, { waitUntil: promise => promise.catch(() => {}) });
    expect((await invoke()).status).toBe(401);
    const student = await signTypedToken(env.JWT_SECRET, 'student', 'personal:STUDENTCODE', 3600);
    expect((await invoke(student)).status).toBe(401);
    const teacher = await signTypedToken(env.JWT_SECRET, 'teacher', 'teacher', 3600, { role: 'teacher' });
    expect((await invoke(teacher, 'https://untrusted.invalid')).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockResolvedValueOnce(new Response(`${JSON.stringify({ event: 'message', title: '일일 리포트', message: '김학생 10:00\n숙제 확인', topic: env.NTFY_TOPIC, token: fakeKey })}\n`));
    const response = await invoke(teacher);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text).message).toBe('김학생 10:00\n숙제 확인');
    expect(text).not.toMatch(/public-general|fake-notification-key/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://ntfy.sh/public-general/json?poll=1&since=24h');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${fakeKey}`);
    expect(fetch.mock.calls[0][1].redirect).toBe('manual');
  });
});
