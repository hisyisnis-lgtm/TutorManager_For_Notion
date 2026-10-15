import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/lessonLogs.js', () => ({ runLessonLogAutomation: vi.fn(), handleLessonLogRequest: vi.fn() }));
import { runLessonLogAutomation } from '../lib/lessonLogs.js';
import worker from '../src/index.js';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-07T12:00:00+09:00'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unmocked network denied'); }));
  runLessonLogAutomation.mockReset();
  runLessonLogAutomation.mockResolvedValue({ created: 1 });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function invoke(cron, env) {
  const pending = [];
  await worker.scheduled({ cron }, env, { waitUntil: promise => pending.push(promise) });
  return Promise.allSettled(pending);
}

describe('수업 일지 cron은 기존 정시 작업과 독립적으로 실행한다', () => {
  it.each(['2026-10-07T12:05:00+09:00', '2026-10-07T12:00:00+09:00'])('5분 cron은 정시 알림과 정리를 실행하지 않는다 (%s)', async now => {
    vi.setSystemTime(new Date(now));
    const env = { LESSON_LOG_AUTOMATION_ENABLED: 'true', GAME_DB: { prepare: vi.fn(), batch: vi.fn() } };
    const results = await invoke('*/5 * * * *', env);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('fulfilled');
    expect(runLessonLogAutomation).toHaveBeenCalledExactlyOnceWith(env);
    expect(env.GAME_DB.prepare).not.toHaveBeenCalled();
    expect(env.GAME_DB.batch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([undefined, 'false'])('자동 생성 비활성 상태에서는 쓰기 작업을 예약하지 않는다 (%s)', async enabled => {
    const results = await invoke('*/5 * * * *', { LESSON_LOG_AUTOMATION_ENABLED: enabled });
    expect(results).toEqual([]);
    expect(runLessonLogAutomation).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('기존 정각 cron은 보안 정리를 유지하고 수업 일지 생성은 별도 cron에 맡긴다', async () => {
    const statement = { bind: vi.fn().mockReturnThis() };
    const env = { LESSON_LOG_AUTOMATION_ENABLED: 'true', GAME_DB: { prepare: vi.fn(() => statement), batch: vi.fn().mockResolvedValue([]) } };
    const results = await invoke('0 * * * *', env);
    expect(results.every(result => result.status === 'fulfilled')).toBe(true);
    expect(env.GAME_DB.batch).toHaveBeenCalledOnce();
    expect(runLessonLogAutomation).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('자동 생성 실패를 성공으로 숨기지 않고 cron 실패 상태로 남긴다', async () => {
    runLessonLogAutomation.mockRejectedValue(new Error('Synthetic Notion failure'));
    const results = await invoke('*/5 * * * *', { LESSON_LOG_AUTOMATION_ENABLED: 'true' });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('rejected');
    expect(results[0].reason.message).toBe('Synthetic Notion failure');
    expect(fetch).not.toHaveBeenCalled();
  });
});
