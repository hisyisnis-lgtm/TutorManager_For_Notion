import { z } from 'zod';
import { SERVICES, CHANNELS, EVENTS, FUNNELS } from '../../pwa/src/analytics/catalog.js';

export const BusinessEvent = z.object({
  service: z.enum(Object.keys(SERVICES)), event: z.enum(EVENTS), sid: z.string().uuid(),
  source: z.enum(Object.keys(CHANNELS)), at: z.number().int().positive(), id: z.string().uuid(),
}).strict();
export const SERVICE_EVENTS = {
  site: new Set(['visit', 'lesson_view', 'book_view', 'inquiry_click', 'game_view', 'game_click']),
  tone: new Set(['game_enter', 'run_start', 'run_end', 'business_click']),
  finder: new Set(['game_enter', 'run_start', 'run_end']),
};

export function collectBusinessEvent(env, body, now = Date.now()) {
  const parsed = BusinessEvent.safeParse(body);
  if (!parsed.success) return false;
  const e = parsed.data;
  if (!SERVICE_EVENTS[e.service].has(e.event) || Math.abs(e.at - now) > 300000) return false;
  env.GAME_AE.writeDataPoint({
    // 기존 게임의 blob1과 구분하고 세션별로 샘플링 인덱스를 분산한다.
    indexes: [e.sid], blobs: ['business_v1', e.service, e.event, e.sid, e.source, e.id], doubles: [e.at],
  });
  return true;
}

const DAY = 86400000;
export function summarizeBusiness(rows, { days = 7, source = 'all', now = Date.now() } = {}) {
  const unique = new Map();
  for (const row of rows) {
    const e = { service: row.service, event: row.event, sid: row.sid, source: row.source, at: Number(row.at), id: row.id };
    if (BusinessEvent.safeParse(e).success && SERVICE_EVENTS[e.service].has(e.event)) unique.set(e.id, e);
  }
  const events = [...unique.values()].filter(e => source === 'all' || e.source === source).sort((a, b) => a.at - b.at || EVENTS.indexOf(a.event) - EVENTS.indexOf(b.event));
  function period(start, end) {
    const sessions = new Map();
    for (const e of events) {
      if (e.at < start || e.at >= end) continue;
      if (!sessions.has(e.sid)) sessions.set(e.sid, []);
      sessions.get(e.sid).push(e);
    }
    const funnels = FUNNELS.map(f => {
      const counts = f.steps.map(s => s.connected ? 0 : null);
      for (const list of sessions.values()) {
        let next = 0, began = null;
        for (const e of list) {
          const s = f.steps[next];
          if (!s?.connected) break;
          if (e.event === s.event && e.service === s.service && (began === null || e.at - began <= 1800000)) {
            began ??= e.at;
            counts[next++]++;
          }
        }
      }
      return { ...f, steps: f.steps.map((s, i) => ({ ...s, count: counts[i], rate: counts[i] !== null && counts[i - 1] > 0 ? counts[i] / counts[i - 1] : null, drop: counts[i] !== null && i > 0 ? counts[i - 1] - counts[i] : null })) };
    });
    const services = Object.entries(SERVICES).map(([id, name]) => {
      const matching = [...sessions.values()].filter(list => list.some(e => e.service === id));
      return { id, name, sessions: matching.length, interested: matching.filter(list => list.some(e => e.service === id && ['lesson_view', 'book_view', 'run_start'].includes(e.event))).length };
    });
    const channels = Object.entries(CHANNELS).map(([id, name]) => ({ id, name, sessions: [...sessions.values()].filter(list => list[0].source === id).length }));
    const selected = [...sessions.values()].flat();
    const count = names => new Set(selected.filter(e => names.includes(e.event)).map(e => e.sid)).size;
    return { sessions: sessions.size, interest: count(['lesson_view', 'book_view', 'run_start']), inquiries: count(['inquiry_click']), completed: count(['run_end']), funnels, services, channels };
  }
  const start = now - days * DAY;
  const current = period(start, now);
  return { ...current, previous: period(start - days * DAY, start), days, generatedAt: new Date(now).toISOString(), daily: Array.from({ length: days }, (_, i) => {
    const end = now - (days - 1 - i) * DAY;
    const bucket = events.filter(e => e.at >= end - DAY && e.at < end);
    const count = names => new Set(bucket.filter(e => !names || names.includes(e.event)).map(e => e.sid)).size;
    return { date: new Date(end).toISOString(), sessions: count(), inquiries: count(['inquiry_click']), completed: count(['run_end']) };
  }) };
}

export async function queryBusinessAnalytics(env, { days, source, now = Date.now() }, fetcher = fetch) {
  if (!env.CF_ANALYTICS_TOKEN) throw new Error('통계 조회 연결이 필요합니다.');
  // 조회 상한 또는 샘플링으로 누락된 순서를 완전한 퍼널처럼 표시하지 않는다.
  const limit = 10001;
  const response = await fetcher('https://api.cloudflare.com/client/v4/accounts/6bb3d7a51e3f42a7ba6367187ee8be16/analytics_engine/sql', {
    method: 'POST', headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, 'Content-Type': 'text/plain' },
    body: `SELECT blob2 AS service, blob3 AS event, blob4 AS sid, blob5 AS source, blob6 AS id, double1 AS at, _sample_interval AS weight FROM tone_game_events WHERE blob1 = 'business_v1' AND timestamp > NOW() - INTERVAL '${days * 2 + 1}' DAY LIMIT ${limit}`,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('통계를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  const reader = response.body.getReader();
  let text = '', size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('조회량이 많습니다. 기간을 줄여주세요.'); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  const rows = JSON.parse(text).data;
  if (!Array.isArray(rows)) throw new Error('통계 응답을 확인할 수 없습니다.');
  if (rows.length >= limit || rows.some(r => Number(r.weight) !== 1)) throw new Error('조회량 또는 샘플링 때문에 정확한 퍼널을 계산할 수 없습니다. 기간을 줄이거나 집계 구조를 확장해주세요.');
  return summarizeBusiness(rows, { days, source, now });
}
