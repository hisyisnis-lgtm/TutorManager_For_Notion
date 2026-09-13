import { describe, it, expect, vi } from 'vitest';
import { collectBusinessEvent, summarizeBusiness, queryBusinessAnalytics } from './businessAnalytics.js';

const now = Date.now(), sid = crypto.randomUUID();
const row = (event, service = 'site', at = now - 1000, session = sid, source = 'direct') => ({ event, service, at, sid: session, source, id: crypto.randomUUID(), weight: 1 });
describe('business funnels', () => {
  it('counts ordered unique sessions, not raw event totals; keeps disconnected outcomes null', () => {
    const visit = row('visit');
    const data = summarizeBusiness([visit, visit, row('inquiry_click', 'site', now - 2000), row('lesson_view', 'site', now - 900), row('inquiry_click', 'site', now - 800), row('inquiry_click', 'site', now - 700), row('inquiry_click', 'site', now - 500, crypto.randomUUID())], { now });
    expect(data.sessions).toBe(2);
    expect(data.funnels[0].steps.map(s => s.count)).toEqual([1, 1, 1, null, null]);
    expect(data.funnels[0].steps[2].rate).toBe(1);
  });
  it('does not merge different sessions or accept a step before its predecessor', () => {
    const data = summarizeBusiness([row('visit'), row('lesson_view', 'site', now - 2000), row('inquiry_click', 'site', now - 500, crypto.randomUUID())], { now });
    expect(data.funnels[0].steps.map(s => s.count)).toEqual([1, 0, 0, null, null]);
  });
  it('links site and game by session, but separates two games', () => {
    const data = summarizeBusiness([row('visit', 'site', now - 6000), row('game_view', 'site', now - 5000), row('game_click', 'site', now - 4000), row('game_enter', 'tone', now - 3000), row('run_start', 'finder', now - 2000), row('run_end', 'tone')], { now });
    expect(data.funnels.find(f => f.id === 'journey').steps.map(s => s.count)).toEqual([1, 1, 1, 1, 0, 0]);
  });
  it('enforces the 30 minute window and current/previous/channel filters', () => {
    const data = summarizeBusiness([row('visit', 'site', now - 2000000), row('lesson_view', 'site'), row('visit', 'site', now - 8 * 86400000, crypto.randomUUID()), row('visit', 'site', now - 500, crypto.randomUUID(), 'youtube')], { now, days: 7, source: 'direct' });
    expect(data.sessions).toBe(1);
    expect(data.previous.sessions).toBe(1);
    expect(data.funnels[0].steps[1].count).toBe(0);
  });
  it('does not accept arbitrary fields, fake purchase events, or stale timestamps', () => {
    const env = { GAME_AE: { writeDataPoint: vi.fn() } };
    const { weight, ...valid } = row('visit');
    expect(weight).toBe(1);
    expect(collectBusinessEvent(env, valid, now)).toBe(true);
    for (const body of [{ ...valid, email: 'test@example.test' }, { ...valid, event: 'purchase' }, { ...valid, service: 'tone' }, { ...valid, at: now - 3600000 }]) expect(collectBusinessEvent(env, body, now)).toBe(false);
    expect(env.GAME_AE.writeDataPoint).toHaveBeenCalledTimes(1);
  });
  it('fails closed on sampling, query caps, missing setup and upstream errors', async () => {
    const env = { CF_ANALYTICS_TOKEN: 'test' };
    const query = data => queryBusinessAnalytics(env, { days: 7, source: 'all', now }, async () => Response.json({ data }));
    await expect(query([{ ...row('visit'), weight: 2 }])).rejects.toThrow('샘플링');
    await expect(query(Array(10001).fill(row('visit')))).rejects.toThrow('조회량');
    await expect(queryBusinessAnalytics({}, { days: 7 })).rejects.toThrow('연결');
    await expect(queryBusinessAnalytics(env, { days: 7 }, async () => new Response('', { status: 403 }))).rejects.toThrow('불러오지');
    expect((await query([])).sessions).toBe(0);
  });
});
