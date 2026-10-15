import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { allowSyntheticStudentApps } from './helpers/studentAppFixture.js';
import { signTypedToken } from '../lib/auth.js';
import { localD1 } from './helpers/localD1.js';
import { readFileSync } from 'node:fs';

const STUDENT = '11111111-1111-1111-1111-111111111111';
const HOMEWORK = '22222222-2222-2222-2222-222222222222';
const HOMEWORK_DB = '5ce7d5ef-7b80-4795-843f-325f4ca868e2';
const CODE = 'ABCDEF123456';
const SOLAPI = 'https://api.solapi.com/messages/v4/send';
let local, env, teacher, responseFactory, executionContext, background;
const call = (path, body, token) => worker.fetch(new Request(`https://worker.test${path}`, {
  method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
}), env, executionContext);
const requestOtp = () => call('/personal/auth/request-otp', { token: CODE });
const solapiCalls = () => fetch.mock.calls.filter(([url]) => url === SOLAPI);

beforeEach(async () => {
  local = localD1(); allowSyntheticStudentApps(local, [STUDENT]);
  background = [];
  executionContext = { waitUntil: vi.fn(function (promise) { expect(this).toBe(executionContext); background.push(promise); }) };
  env = { GAME_DB: local.db, JWT_SECRET: 'isolated-secret', NOTION_TOKEN: 'isolated-notion',
    SOLAPI_API_KEY: 'isolated-api-key', SOLAPI_API_SECRET: 'isolated-api-secret', SOLAPI_SENDER: '0212345678',
    KAKAO_PFID: 'isolated-profile', KAKAO_TPL_PERSONAL_OTP: 'isolated-otp', KAKAO_TPL_HW_ASSIGN: 'isolated-assign', KAKAO_TPL_HW_FEEDBACK: 'isolated-feedback',
    KAKAO_TPL_HW_ASSIGN_MEMBER: 'isolated-member-assign', KAKAO_TPL_HW_FEEDBACK_MEMBER: 'isolated-member-feedback' };
  teacher = await signTypedToken(env.JWT_SECRET, 'teacher', 'teacher', 600, { role: 'teacher' });
  responseFactory = () => Response.json({ statusCode: '2000', statusMessage: 'private-response', to: '01012345678' });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    if (url === SOLAPI) {
      expect(init.redirect).toBe('manual');
      return responseFactory();
    }
    const student = { id: STUDENT, properties: { '이름': { title: [{ plain_text: '가상학생' }] }, '전화번호': { phone_number: '01012345678' }, '예약 코드': { rich_text: [{ plain_text: CODE }] } } };
    if (url.startsWith('https://api.notion.com/v1/databases/') && url.endsWith('/query')) return Response.json({ results: [student], has_more: false });
    if (url === `https://api.notion.com/v1/pages/${STUDENT}`) return Response.json(student);
    if (url === `https://api.notion.com/v1/pages/${HOMEWORK}`) return Response.json({ id: HOMEWORK, parent: { database_id: HOMEWORK_DB }, properties: { '제목': { title: [{ plain_text: '가상숙제' }] }, '학생': { relation: [{ id: STUDENT }] } } });
    throw new Error('Non-mocked network denied');
  }));
});
afterEach(async () => { await Promise.allSettled(background); local.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Worker Solapi callers distinguish acceptance from failure', () => {
  it('OTP SMS accepted: one request and no automatic Kakao fallback', async () => {
    const response = await requestOtp();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, phoneTail: '5678' });
    expect(solapiCalls()).toHaveLength(1);
    const message = JSON.parse(solapiCalls()[0][1].body).message;
    expect(message.text).toMatch(/\d{6}/);
    expect(message.kakaoOptions).toBeUndefined();
  });
  it.each(['personal', 'legacy'])('OTP preserves %s Kakao template fallback only when SMS sender is absent', async kind => {
    delete env.SOLAPI_SENDER;
    if (kind === 'legacy') { delete env.KAKAO_TPL_PERSONAL_OTP; env.KAKAO_TPL_GAME_OTP = 'legacy-otp'; }
    expect((await requestOtp()).status).toBe(200);
    expect(solapiCalls()).toHaveLength(1);
    expect(JSON.parse(solapiCalls()[0][1].body).message.kakaoOptions.templateId).toBe(kind === 'personal' ? 'isolated-otp' : 'legacy-otp');
  });
  it.each([
    ['http rejection', () => Response.json({ errorMessage: 'private-response' }, { status: 400 }), 'failed'],
    ['2xx body rejection', () => Response.json({ statusCode: '3040', statusMessage: 'private-response' }), 'failed'],
    ['network uncertainty', () => { throw new Error('private-network-secret'); }, 'unknown'],
    ['malformed reply', () => new Response('private-invalid-body'), 'unknown'],
    ['server uncertainty', () => new Response('private-invalid-body', { status: 503 }), 'unknown'],
  ])('OTP %s does not claim success or retry', async (_label, factory, state) => {
    responseFactory = factory;
    const response = await requestOtp();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ ok: false, sent: false, delivery: state });
    expect(solapiCalls()).toHaveLength(1);
    expect(JSON.stringify([...console.log.mock.calls, ...console.error.mock.calls])).not.toMatch(/private-|01012345678|isolated-api/);
  });
  it('OTP missing credentials is an explicit configuration failure without a chargeable request', async () => {
    delete env.SOLAPI_API_KEY;
    const response = await requestOtp();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, sent: false, reason: 'solapi_not_configured' });
    expect(solapiCalls()).toHaveLength(0);
  });
  it.each(['assign', 'feedback'])('homework %s reports accepted only after Solapi acceptance', async kind => {
    const response = await call(`/homework/notify-${kind}`, { homeworkId: HOMEWORK }, teacher);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, sent: true, delivery: 'accepted' });
    expect(solapiCalls()).toHaveLength(1);
    const message = JSON.parse(solapiCalls()[0][1].body).message;
    expect(message.kakaoOptions.templateId).toBe(kind === 'assign' ? 'isolated-member-assign' : 'isolated-member-feedback');
    expect(message.kakaoOptions.variables['#{학생앱주소}']).toBe('https://tiantianchinese.com/personal/');
    expect(JSON.stringify(message)).not.toContain(CODE);
  });
  it.each([
    ['rejected', () => Response.json({ statusCode: '3101' }), 'failed'],
    ['unknown', () => { throw new Error('private-network-secret'); }, 'unknown'],
  ])('homework %s never fabricates sent:true or writes business data', async (_label, factory, state) => {
    responseFactory = factory;
    const response = await call('/homework/notify-assign', { homeworkId: HOMEWORK }, teacher);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ ok: false, sent: false, delivery: state });
    expect(solapiCalls()).toHaveLength(1);
    expect(fetch.mock.calls.some(([url, init]) => url.startsWith('https://api.notion.com') && init?.method === 'PATCH')).toBe(false);
  });
  it('homework missing template is not sent:true', async () => {
    delete env.KAKAO_TPL_HW_ASSIGN_MEMBER; // The old token template must never be a fallback.
    const response = await call('/homework/notify-assign', { homeworkId: HOMEWORK }, teacher);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, sent: false, reason: 'solapi_not_configured' });
    expect(solapiCalls()).toHaveLength(0);
  });
  function legacyRollout(linked = false) {
    env.SITE_LEGACY_STUDENT_APP_ENABLED = 'true';
    env.SITE_LEGACY_STUDENT_APP_ORIGIN = 'https://tiantian-chinese.pages.dev';
    for (const name of ['0007_reviews.sql', '0008_site_auth.sql', '0009_site_commerce.sql']) {
      local.sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
    }
    if (linked) {
      local.sqlite.prepare(`INSERT INTO site_members(id,status,name,member_code,customer_key,provider,
        terms_accepted_at,privacy_accepted_at,created_at,updated_at) VALUES('linked-member','active','합성','synthetic-code',
        'synthetic-customer','google','2026-10-15','2026-10-15','2026-10-15','2026-10-15')`).run();
      local.sqlite.prepare(`INSERT INTO site_student_links(member_id,student_id,verified_at,verified_by)
        VALUES('linked-member',?,'2026-10-15T00:00:00Z','teacher')`).run(STUDENT);
    }
  }
  it.each(['assign','feedback'])('preserves the legacy %s template and token for a reviewed unlinked student', async kind => {
    legacyRollout();
    expect((await call(`/homework/notify-${kind}`, { homeworkId: HOMEWORK }, teacher)).status).toBe(200);
    const message = JSON.parse(solapiCalls()[0][1].body).message;
    expect(message.kakaoOptions.templateId).toBe(`isolated-${kind}`);
    expect(message.kakaoOptions.variables).toEqual({ '#{이름}': '가상학생', '#{숙제제목}': '가상숙제', '#{token}': CODE });
  });
  it('never sends a reservation code for a verified member during rollout', async () => {
    legacyRollout(true);
    expect((await call('/homework/notify-assign', { homeworkId: HOMEWORK }, teacher)).status).toBe(200);
    const message = JSON.parse(solapiCalls()[0][1].body).message;
    expect(message.kakaoOptions.templateId).toBe('isolated-member-assign');
    expect(JSON.stringify(message)).not.toContain(CODE);
  });
  it('does not send when rollout link lookup fails', async () => {
    env.SITE_LEGACY_STUDENT_APP_ENABLED = 'true';
    expect((await call('/homework/notify-assign', { homeworkId: HOMEWORK }, teacher)).status).toBe(503);
    expect(solapiCalls()).toHaveLength(0);
  });
  it.each(['consult-kakao', 'homework-kakao', 'consult-relay'])('%s failure schedules a private-safe critical warning without awaiting it', async kind => {
    const isConsult = kind.startsWith('consult');
    Object.assign(env, { NTFY_TOPIC: 'isolated-topic', NTFY_TOKEN: 'isolated-ntfy', GITHUB_PAT: 'isolated-github',
      KAKAO_TPL_CONSULT: 'isolated-consult', MY_PHONE: '01012345678' });
    vi.stubGlobal('caches', { default: { match: async () => undefined, put: async () => {} } });
    responseFactory = () => Response.json({ statusCode: kind === 'consult-relay' ? '2000' : '3040', statusMessage: 'private-solapi-rejection' });
    let failWarning;
    let warningPending = true;
    const upstreamWarning = new Promise((_resolve, reject) => { failWarning = () => { warningPending = false; reject(new Error('private-warning-error')); }; });
    const existingFetch = fetch.getMockImplementation();
    fetch.mockImplementation(async (url, init) => {
      if (url === 'https://ntfy.sh') return upstreamWarning;
      if (url.endsWith('/dispatches')) return new Response(null, { status: kind === 'consult-relay' ? 403 : 204 });
      if (isConsult && url.endsWith('/query')) return Response.json({ results: [] });
      if (url === 'https://api.notion.com/v1/pages') return Response.json({ id: 'saved-consult' });
      return existingFetch(url, init);
    });
    let timeout;
    try {
      const response = await Promise.race([
        isConsult
          ? call('/consult', { name: '김가상', phone: '01012345678', message: 'private-consult-body',
            level: '완전 처음이에요', concerns: ['발음이 이상한 것 같아요'], reasons: ['기타 (직접 입력)'], reasonOther: '업무 회화', preferredDays: ['월'], preferredTime: '오후 (12-18시)' })
          : call('/homework/notify-assign', { homeworkId: HOMEWORK }, teacher),
        new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Response waited for the operational warning')), 1500); }),
      ]);
      expect(warningPending).toBe(true);
      expect(executionContext.waitUntil).toHaveBeenCalled();
      expect(response.status).toBe(isConsult ? 200 : 502);
      expect(await response.json()).toMatchObject(isConsult
        ? { ok: true, notificationWarning: expect.stringContaining('저장') }
        : { ok: false, sent: false, delivery: 'failed' });
      const warnings = fetch.mock.calls.filter(([url]) => url === 'https://ntfy.sh');
      expect(warnings).toHaveLength(1);
      const payload = JSON.parse(warnings[0][1].body);
      const title = kind === 'consult-relay' ? '⚠️ 상담·숙제 알림 릴레이 오류'
        : isConsult ? '⚠️ 상담 접수 카카오 알림 오류' : '⚠️ 숙제 카카오 알림 오류';
      expect(payload).toMatchObject({ priority: 5, title });
      expect(JSON.stringify(payload)).not.toMatch(/01012345678|김가상|가상숙제|private-|ABCDEF123456/);
      expect(solapiCalls()).toHaveLength(1);
      failWarning();
      await expect(Promise.all(background)).resolves.toBeDefined();
      expect(response.status).toBe(isConsult ? 200 : 502);
      expect(JSON.stringify([...console.log.mock.calls, ...console.error.mock.calls])).not.toMatch(/private-|01012345678|isolated-api/);
    } finally {
      clearTimeout(timeout);
      failWarning();
    }
  });
  it('retains teacher authentication before attempting a paid notification', async () => {
    const student = await signTypedToken(env.JWT_SECRET, 'student', `personal:${CODE}`, 600);
    expect((await call('/homework/notify-feedback', { homeworkId: HOMEWORK }, student)).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
});
