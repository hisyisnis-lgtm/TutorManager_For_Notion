const encoder = new TextEncoder();
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const KINDS = new Set(['consult-kakao', 'consult-relay', 'homework-assign', 'homework-feedback', 'homework-submit', 'student-tomorrow', 'consult-tomorrow']);
const BATCHES = new Set(['student-tomorrow', 'consult-tomorrow']);
const RELAYS = new Set(['consult-relay', 'homework-submit']);
const STATES = new Set(['queued', 'accepted', 'failed', 'unknown']);
const REASONS = new Set(['solapi_accepted', 'solapi_rejected', 'solapi_http_error', 'solapi_response_unknown', 'solapi_not_configured',
  'ntfy_queued', 'ntfy_not_configured', 'ntfy_relay_failed', 'ntfy_accepted', 'ntfy_publish_failed', 'ntfy_publish_unknown',
  'batch_result', 'delivery_unknown', 'no_phone', 'no_token']);
const RESOLUTIONS = new Set(['provider_checked', 'contacted', 'no_action_needed']);
const FIELDS = 'id, kind, reference_id, delivery_state, reason_code, counts_json, created_at, updated_at, resolved_at, resolution_kind, resolved_by';
const SIGNING_DOMAIN = 'tutor-notification-followup/v1';
const validId = id => typeof id === 'string' && (UUID.test(id) || HASH.test(id));
const nowSeconds = () => Math.floor(Date.now() / 1000);
const RELAY_TIMEOUT_SECONDS = 15 * 60;

function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)
    || Object.keys(event).some(key => !['id', 'kind', 'referenceId', 'state', 'reason', 'counts'].includes(key))
    || !validId(event.id) || !KINDS.has(event.kind) || !STATES.has(event.state) || !REASONS.has(event.reason)) throw new Error('Invalid notification event');
  const batch = BATCHES.has(event.kind);
  if (batch ? !/^\d{1,20}$/.test(event.referenceId || '') || !HASH.test(event.id)
    : !UUID.test(event.id) || (event.referenceId != null && !UUID.test(event.referenceId))) throw new Error('Invalid notification reference');
  if (event.state === 'queued' && !RELAYS.has(event.kind)) throw new Error('Invalid queued event');
  if (event.counts !== undefined) {
    const keys = ['sent', 'alreadyAccepted', 'failed', 'unknown'];
    if (!batch || !event.counts || typeof event.counts !== 'object' || Array.isArray(event.counts)
      || Object.keys(event.counts).length !== keys.length
      || !keys.every(key => Number.isSafeInteger(event.counts[key]) && event.counts[key] >= 0 && event.counts[key] <= 100000)) throw new Error('Invalid notification counts');
    const expected = event.counts.unknown > 0 ? 'unknown' : event.counts.failed > 0 ? 'failed' : 'accepted';
    if (event.state !== expected) throw new Error('Inconsistent notification counts');
  } else if (batch) throw new Error('Missing notification counts');
  return event;
}

function publicRow(row) {
  return { id: row.id, kind: row.kind, referenceId: row.reference_id, state: row.delivery_state, reason: row.reason_code,
    counts: row.counts_json ? JSON.parse(row.counts_json) : null, createdAt: row.created_at, updatedAt: row.updated_at,
    resolvedAt: row.resolved_at, resolutionKind: row.resolution_kind,
    needsAttention: ['failed', 'unknown'].includes(row.delivery_state)
      || (row.delivery_state === 'queued' && row.created_at <= nowSeconds() - RELAY_TIMEOUT_SECONDS) };
}

export async function recordNotificationEvent(env, input) {
  const event = validateEvent(input);
  const now = nowSeconds();
  // Only queued -> final may update an existing outcome. A late dispatch reply
  // cannot overwrite the relay's completed result or reopen a resolved item.
  const row = await env.GAME_DB.prepare(`
    INSERT INTO notification_followups (id, kind, reference_id, delivery_state, reason_code, counts_json, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
    ON CONFLICT(id) DO UPDATE SET
      delivery_state=CASE WHEN delivery_state='queued' AND excluded.delivery_state!='queued' THEN excluded.delivery_state ELSE delivery_state END,
      reason_code=CASE WHEN delivery_state='queued' AND excluded.delivery_state!='queued' THEN excluded.reason_code ELSE reason_code END,
      updated_at=CASE WHEN delivery_state='queued' AND excluded.delivery_state!='queued' THEN excluded.updated_at ELSE updated_at END
    WHERE kind=excluded.kind AND reference_id IS excluded.reference_id
    RETURNING ${FIELDS}
  `).bind(event.id, event.kind, event.referenceId ?? null, event.state, event.reason,
    event.counts ? JSON.stringify(event.counts) : null, now).first();
  if (!row) throw new Error('Notification event identity mismatch');
  return publicRow(row);
}

// Records are ancillary: never change an already-saved business response or
// replay a provider request when D1/logging fails. Only fixed text is logged.
export function queueNotificationRecord(env, ctx, metadata, delivery) {
  const task = recordNotificationEvent(env, {
    id: metadata.id || crypto.randomUUID(), kind: metadata.kind, referenceId: UUID.test(metadata.referenceId || '') ? metadata.referenceId : null,
    state: STATES.has(delivery?.state) ? delivery.state : 'unknown',
    reason: REASONS.has(delivery?.reason) ? delivery.reason : delivery?.state === 'queued' ? 'ntfy_queued' : 'delivery_unknown',
  }).catch(() => { console.error('[notification-followups] record unavailable; inspect provider/Actions history'); });
  if (typeof ctx?.waitUntil === 'function') {
    try { ctx.waitUntil(task); } catch { console.error('[notification-followups] background scheduling unavailable'); }
  }
  return task;
}

export async function listNotificationFollowups(env, { filter = 'open', before } = {}) {
  if (!['open', 'resolved', 'all'].includes(filter)) throw new Error('Invalid notification filter');
  let timestamp = Number.MAX_SAFE_INTEGER, id = 'z';
  if (before) {
    const split = before.indexOf(':');
    timestamp = Number(before.slice(0, split)); id = before.slice(split + 1);
    if (split < 1 || !Number.isSafeInteger(timestamp) || timestamp < 0 || !validId(id)) throw new Error('Invalid notification cursor');
  }
  const condition = filter === 'open' ? "resolved_at IS NULL AND (delivery_state IN ('failed','unknown') OR (delivery_state='queued' AND created_at <= ?3))"
    : filter === 'resolved' ? 'resolved_at IS NOT NULL' : '1=1';
  const rows = await env.GAME_DB.prepare(`SELECT ${FIELDS} FROM notification_followups WHERE ${condition}
    AND (created_at < ?1 OR (created_at = ?1 AND id < ?2)) ORDER BY created_at DESC, id DESC LIMIT 51`)
    .bind(...(filter === 'open' ? [timestamp, id, nowSeconds() - RELAY_TIMEOUT_SECONDS] : [timestamp, id])).all();
  const items = rows.results.slice(0, 50).map(publicRow);
  const last = items.at(-1);
  return { items, nextCursor: rows.results.length > 50 ? `${last.createdAt}:${last.id}` : null };
}

export async function resolveNotificationFollowup(env, id, resolutionKind) {
  if (!validId(id) || !RESOLUTIONS.has(resolutionKind)) throw new Error('Invalid notification resolution');
  const row = await env.GAME_DB.prepare(`UPDATE notification_followups SET
    resolved_at=COALESCE(resolved_at, ?2), resolution_kind=COALESCE(resolution_kind, ?3), resolved_by=COALESCE(resolved_by, 'teacher')
    WHERE id=?1 AND (delivery_state IN ('failed','unknown') OR (delivery_state='queued' AND created_at <= ?4))
    RETURNING ${FIELDS}`).bind(id, nowSeconds(), resolutionKind, nowSeconds() - RELAY_TIMEOUT_SECONDS).first();
  return row ? publicRow(row) : null;
}

async function boundedBody(request) {
  if (!request.body) throw new Error('Missing body');
  const reader = request.body.getReader();
  let size = 0, text = '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > 4096) throw new Error('Body too large');
      text += decoder.decode(value, { stream: true });
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function ingestNotificationFollowup(request, env) {
  const respond = (status, data) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  const timestamp = request.headers.get('X-Notification-Timestamp') || '';
  const signature = request.headers.get('X-Notification-Signature') || '';
  if (!/^\d{10}$/.test(timestamp) || Math.abs(nowSeconds() - Number(timestamp)) > 300 || !HASH.test(signature)) return respond(401, { error: '인증이 필요합니다.' });
  let raw, event;
  try {
    raw = await boundedBody(request);
    event = validateEvent(JSON.parse(raw));
  } catch { return respond(400, { error: '잘못된 발송 결과입니다.' }); }
  const secret = BATCHES.has(event.kind) ? env.SOLAPI_API_SECRET : RELAYS.has(event.kind) ? env.NTFY_TOKEN : null;
  if (!secret || event.state === 'queued') return respond(401, { error: '인증이 필요합니다.' });
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const bytes = Uint8Array.from(signature.match(/../g), byte => parseInt(byte, 16));
  const verified = await crypto.subtle.verify('HMAC', key, bytes, encoder.encode(`${SIGNING_DOMAIN}\n${timestamp}\n${raw}`));
  if (!verified) return respond(401, { error: '인증이 필요합니다.' });
  try { await recordNotificationEvent(env, event); return respond(200, { ok: true }); }
  catch { return respond(503, { error: '발송 결과를 보관하지 못했습니다.' }); }
}

export async function handleNotificationFollowups(request, env, corsHeaders) {
  const respond = (status, data) => Response.json(data, { status, headers: { ...corsHeaders, 'Cache-Control': 'private, no-store' } });
  const url = new URL(request.url);
  try {
    if (request.method === 'GET' && url.pathname === '/notification-followups') {
      const filter = url.searchParams.get('filter') || 'open';
      if (!['open', 'resolved', 'all'].includes(filter)) return respond(400, { error: '잘못된 조회 조건입니다.' });
      return respond(200, await listNotificationFollowups(env, { filter, before: url.searchParams.get('before') }));
    }
    if (request.method === 'PATCH') {
      const id = url.pathname.slice('/notification-followups/'.length);
      const body = JSON.parse(await boundedBody(request));
      if (!validId(id) || !body || Object.keys(body).length !== 1 || !RESOLUTIONS.has(body.resolutionKind)) return respond(400, { error: '처리 방법을 확인해 주세요.' });
      const item = await resolveNotificationFollowup(env, id, body.resolutionKind);
      return item ? respond(200, { item }) : respond(404, { error: '처리할 발송 기록을 찾지 못했습니다.' });
    }
    return respond(405, { error: '지원하지 않는 요청입니다.' });
  } catch { return respond(503, { error: '발송 후속 기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }); }
}
