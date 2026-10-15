import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/siteRecoveryJobs.js', () => ({ runSiteRecoveryJobs: vi.fn() }));
vi.mock('../lib/lessonLogs.js', () => ({ runLessonLogAutomation: vi.fn(), handleLessonLogRequest: vi.fn() }));
vi.mock('../lib/siteAuth.js', async importOriginal => ({ ...(await importOriginal()), cleanupSiteAuthState: vi.fn() }));
vi.mock('../lib/siteAdminAuth.js', async importOriginal => ({ ...(await importOriginal()), cleanupSiteAdminAuthState: vi.fn() }));
vi.mock('../lib/securityStore.js', async importOriginal => ({ ...(await importOriginal()), cleanupSecurityState: vi.fn() }));
import { runSiteRecoveryJobs } from '../lib/siteRecoveryJobs.js';
import { runLessonLogAutomation } from '../lib/lessonLogs.js';
import { cleanupSiteAuthState } from '../lib/siteAuth.js';
import { cleanupSiteAdminAuthState } from '../lib/siteAdminAuth.js';
import { cleanupSecurityState } from '../lib/securityStore.js';
import worker from '../src/index.js';

const regular = { cron: '*/5 * * * *', scheduledTime: Date.parse('2026-10-15T03:05:00.000Z') };
const onHour = { cron: '*/5 * * * *', scheduledTime: Date.parse('2026-10-15T03:00:00.000Z') };
const hourly = { cron: '0 * * * *', scheduledTime: onHour.scheduledTime };
const baseEnv = () => ({ SITE_SESSION_SECRET: 'synthetic-scheduler-session-secret', LESSON_LOG_AUTOMATION_ENABLED: 'false' });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T03:00:00.000Z')); // KST noon: no unrelated notification dispatch
  runSiteRecoveryJobs.mockReset().mockResolvedValue({ ok: true, jobs: {}, backlog: {}, notified: 0 });
  runLessonLogAutomation.mockReset().mockResolvedValue({ created: 0 });
  cleanupSiteAuthState.mockReset().mockResolvedValue(undefined);
  cleanupSiteAdminAuthState.mockReset().mockResolvedValue(undefined);
  cleanupSecurityState.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('unexpected_external_network'); }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function invoke(event, env = baseEnv()) {
  const pending = [];
  await worker.scheduled(event, env, { waitUntil: promise => pending.push(Promise.resolve(promise)) });
  return { pending, results: await Promise.allSettled(pending) };
}

describe('실제 Worker scheduled 진입점에 연결된 통합웹 복구', () => {
  it.each([undefined, 'false'])('수업 일지 flag가 %s여도 5분 복구를 실행하고 기존 hourly 작업은 실행하지 않는다', async enabled => {
    const env = { ...baseEnv(), LESSON_LOG_AUTOMATION_ENABLED: enabled };
    const { results } = await invoke(regular, env);
    expect(runSiteRecoveryJobs).toHaveBeenCalledExactlyOnceWith(env, { notify: expect.any(Function) });
    expect(results).toHaveLength(1); expect(results[0].status).toBe('fulfilled');
    expect(runLessonLogAutomation).not.toHaveBeenCalled();
    expect(cleanupSecurityState).not.toHaveBeenCalled(); expect(cleanupSiteAuthState).not.toHaveBeenCalled();
    expect(cleanupSiteAdminAuthState).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('정각의 5분 cron은 복구를 hourly에 맡기되 수업 일지 작업은 유지한다', async () => {
    const env = { ...baseEnv(), LESSON_LOG_AUTOMATION_ENABLED: 'true' };
    const { results } = await invoke(onHour, env);
    expect(runSiteRecoveryJobs).not.toHaveBeenCalled();
    expect(runLessonLogAutomation).toHaveBeenCalledExactlyOnceWith(env);
    expect(results).toHaveLength(1); expect(results[0].status).toBe('fulfilled');
    expect(cleanupSecurityState).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it('hourly는 최근 완료 주문 옵션과 기존 보안·회원 정리를 실행한다', async () => {
    const env = baseEnv(), { results } = await invoke(hourly, env);
    expect(runSiteRecoveryJobs).toHaveBeenCalledExactlyOnceWith(env, { includeRecentPaid: true, notify: expect.any(Function) });
    expect(cleanupSecurityState).toHaveBeenCalledExactlyOnceWith(env);
    expect(cleanupSiteAuthState).toHaveBeenCalledExactlyOnceWith(env);
    expect(cleanupSiteAdminAuthState).toHaveBeenCalledExactlyOnceWith(env);
    expect(runLessonLogAutomation).not.toHaveBeenCalled();
    expect(results).toHaveLength(5); expect(results.every(result => result.status === 'fulfilled')).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([regular, hourly])('복구 ok=false를 성공으로 숨기지 않고 waitUntil 거절로 남긴다 ($cron)', async event => {
    runSiteRecoveryJobs.mockResolvedValue({ ok: false, jobs: { shopPayments: { ok: false } }, backlog: null, notified: 1 });
    const { results } = await invoke(event);
    const failed = results.filter(result => result.status === 'rejected');
    expect(failed).toHaveLength(1); expect(failed[0].reason.message).toBe('통합웹 복구 작업 확인이 필요합니다.');
    expect(runSiteRecoveryJobs).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
  });

  it('복구 실패와 수업 일지 성공을 별개 작업 결과로 유지한다', async () => {
    runSiteRecoveryJobs.mockResolvedValue({ ok: false });
    const env = { ...baseEnv(), LESSON_LOG_AUTOMATION_ENABLED: 'true' }, { results } = await invoke(regular, env);
    expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(runLessonLogAutomation).toHaveBeenCalledExactlyOnceWith(env);
  });

  it('수업 일지 실패가 통합웹 복구 실행과 성공을 막지 않는다', async () => {
    runLessonLogAutomation.mockRejectedValue(new Error('synthetic-lesson-failure'));
    const env = { ...baseEnv(), LESSON_LOG_AUTOMATION_ENABLED: 'true' }, { results } = await invoke(regular, env);
    expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(runSiteRecoveryJobs).toHaveBeenCalledTimes(1);
    expect(results.find(result => result.status === 'rejected').reason.message).toBe('synthetic-lesson-failure');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('회원 시크릿이 없는 기존 운영 환경에서는 새 복구·회원 정리를 예약하지 않는다', async () => {
    const env = { LESSON_LOG_AUTOMATION_ENABLED: 'false' };
    await invoke(regular, env); await invoke(hourly, env);
    expect(runSiteRecoveryJobs).not.toHaveBeenCalled(); expect(cleanupSiteAuthState).not.toHaveBeenCalled();
    expect(cleanupSiteAdminAuthState).not.toHaveBeenCalled();
    expect(cleanupSecurityState).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });

  it('복구에 전달한 notify는 실제 외부 요청 없이 기존 발신 설정의 결과를 반환한다', async () => {
    runSiteRecoveryJobs.mockImplementation(async (_env, options) => {
      expect(typeof options.notify).toBe('function');
      const delivery = await options.notify({ level: 'warn', title: '합성 복구 확인', message: '합성 처리 대기 1건', dedupKey: 'synthetic-scheduler' });
      expect(delivery.ok).toBe(false); // no alert topic is configured; never invent a destination
      return { ok: true };
    });
    const { results } = await invoke(regular);
    expect(results[0].status).toBe('fulfilled'); expect(fetch).not.toHaveBeenCalled();
  });
});
