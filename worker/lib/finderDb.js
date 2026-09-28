// 성조우체국 전용 저장소. 다락방 계정과 별도 행·세션을 사용하고 매 저장을 CAS로 보호한다.
import { z } from 'zod';
import { verifyTypedToken } from './auth.js';

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const stamp = z.string().datetime({ offset: true });
const id = z.string().min(1).max(100);
const run = z.object({
  id, mode: z.enum(['normal', 'review']), reason: z.string().max(40),
  completedStages: count.max(16), correct: count, mistakes: count, hints: count,
  elapsedMs: count, completedAt: stamp, xp: count,
}).strict();
const profileSchema = z.object({
  version: z.literal(1), nickname: z.string().trim().min(1).refine(value => [...value].length <= 12), onboarded: z.boolean(),
  xp: count, rank: count.max(2), level: count.min(1), bestStage: count.max(16),
  runs: z.array(run).max(200), processedRunIds: z.array(id).max(200),
  discardedResultThrough: stamp.nullable(), resetAt: stamp.nullable(),
  totals: z.object({ correct: count, mistakes: count, normalRuns: count, reviewRuns: count, graduates: count }).strict(),
  lastPlayedDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), streak: count,
  daily: z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), correct: count, mistakes: count, bestStage: count.max(16) }).strict(),
  mistakes: z.record(z.string().min(1).max(12), z.object({
    remaining: count.min(1).max(3), lastAt: stamp, tones: z.array(count.min(1).max(4)).max(4),
  }).strict()),
  achievements: z.array(z.string().max(60)).max(100),
  settings: z.object({ sfx: z.boolean(), bgm: z.boolean(), haptic: z.boolean(), pinyin: z.boolean(), autoSpeak: z.boolean() }).strict(),
}).strict();

function unsafeKeys(value) {
  const pending = [{ value, depth: 0 }];
  while (pending.length) {
    const next = pending.pop();
    if (!next.value || typeof next.value !== 'object') continue;
    if (next.depth > 16) return true;
    for (const [key, child] of Object.entries(next.value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) return true;
      pending.push({ value: child, depth: next.depth + 1 });
    }
  }
  return false;
}

export function parseFinderProfile(profile) {
  // A shallow/deep schema strip must never silently discard records on save.
  if (unsafeKeys(profile)) return null;
  const parsed = profileSchema.safeParse(profile);
  if (!parsed.success || Object.keys(parsed.data.mistakes).length > 300) return null;
  return parsed.data;
}

function parseRow(row) {
  if (!row) return null;
  let profile = null;
  if (row.profile) {
    try { profile = parseFinderProfile(JSON.parse(row.profile)); } catch { /* fail closed below */ }
    if (!profile) throw Object.assign(new Error('저장된 우체국 기록을 확인할 수 없습니다. 기존 기록은 유지됩니다.'), { status: 409 });
  }
  return { id: row.id, provider: row.provider, nickname: profile?.nickname || null, profile, revision: row.revision };
}

export async function findOrCreateFinderUser(db, provider, socialId) {
  const now = new Date().toISOString();
  const row = await db.prepare(`
    INSERT INTO finder_users (id, provider, social_id, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(provider, social_id) DO UPDATE SET last_seen_at = excluded.last_seen_at
    RETURNING *
  `).bind(`finder:${crypto.randomUUID()}`, provider, socialId, now, now).first();
  return parseRow(row);
}

export async function getFinderUserById(db, id) {
  return parseRow(await db.prepare('SELECT * FROM finder_users WHERE id = ?').bind(id).first());
}

export async function updateFinderProfile(db, id, profile, revision) {
  const row = await db.prepare(`
    UPDATE finder_users SET profile = ?, revision = revision + 1, last_seen_at = ?
    WHERE id = ? AND revision = ? RETURNING *
  `).bind(JSON.stringify(profile), new Date().toISOString(), id, revision).first();
  if (row) return { user: parseRow(row) };
  const user = await getFinderUserById(db, id);
  return user ? { conflict: true, user } : null;
}

export async function handleFinderMe(request, env, headers) {
  const reply = (body, status = 200) => Response.json(body, { status, headers: { ...headers, 'Cache-Control': 'no-store' } });
  if (!['GET', 'PUT'].includes(request.method)) return reply({ error: '지원하지 않는 요청입니다.' }, 405);
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const claim = await verifyTypedToken(env.JWT_SECRET, token, 'finder');
  if (!claim?.sub) return reply({ error: '우체국 로그인이 필요합니다.' }, 401);
  try {
    if (request.method === 'GET') {
      const user = await getFinderUserById(env.GAME_DB, claim.sub);
      return user ? reply({ user }) : reply({ error: '계정을 찾을 수 없습니다.' }, 404);
    }
    const body = await request.json().catch(() => null);
    if (!Number.isSafeInteger(body?.revision) || body.revision < 0) return reply({ error: '기록 버전이 올바르지 않습니다.' }, 400);
    const profile = parseFinderProfile(body.profile);
    if (!profile) return reply({ error: '우체국 기록 형식이 올바르지 않습니다. 기존 기록은 유지됩니다.' }, 400);
    if (new TextEncoder().encode(JSON.stringify(profile)).byteLength > 100000) return reply({ error: '우체국 기록이 너무 큽니다. 기존 기록은 유지됩니다.' }, 413);
    const result = await updateFinderProfile(env.GAME_DB, claim.sub, profile, body.revision);
    if (!result) return reply({ error: '계정을 찾을 수 없습니다.' }, 404);
    if (result.conflict) return reply({ error: '다른 기기의 최신 기록을 불러왔습니다. 저장되지 않은 기록은 이 기기에 보관됩니다.', user: result.user, conflict: true }, 409);
    return reply({ ok: true, user: result.user });
  } catch (error) {
    if (error.status === 409) return reply({ error: error.message }, 409);
    throw error;
  }
}
