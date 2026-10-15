// Persistent website payment outbox. External creation is sent at most once;
// an uncertain response requires reconciliation, never blind POST retry.
const PAYMENT_DB = '314838fa-f2a6-8154-935b-edd3d2fbea83';
const STUDENT_DB = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';
const CLASS_TYPE_DB = '314838fa-f2a6-81c3-b4e4-da87c48f9b43';
const DISCOUNT_DB = '314838fa-f2a6-81d3-9cec-4c628edab065';
const compact = id => String(id || '').replace(/-/g, '').toLowerCase();
const now = () => new Date().toISOString();
const timestamp = () => Math.floor(Date.now() / 1000);
const rich = value => [{ text: { content: String(value) } }];
const richValue = property => (property?.rich_text || []).map(part => part.plain_text || part.text?.content || '').join('');

class NotionSyncError extends Error {
  constructor(code, { ambiguous = false, setup = false, retryAfter = 60 } = {}) {
    super(code); this.code = code; this.ambiguous = ambiguous; this.setup = setup; this.retryAfter = retryAfter;
  }
}
async function boundedJson(response) {
  if (!response.body) throw new NotionSyncError('notion_invalid_response');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 512 * 1024) { await reader.cancel(); throw new NotionSyncError('notion_response_too_large'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new NotionSyncError('notion_invalid_response'); }
}
export async function siteNotionOnce(env, method, path, body) {
  const isWrite = method === 'PATCH' || (method === 'POST' && path === '/pages');
  if (!env.NOTION_TOKEN) throw new NotionSyncError('notion_not_configured', { setup: true });
  let response;
  try {
    response = await fetch(`https://api.notion.com/v1${path}`, { method, redirect: 'manual', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch { throw new NotionSyncError('notion_network_unknown', { ambiguous: isWrite }); }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    const retryAfter = Math.min(3600, Math.max(1, Number(response.headers.get('Retry-After')) || 60));
    if (response.status === 429) throw new NotionSyncError('notion_rate_limited', { retryAfter });
    if ([400, 401, 403, 404].includes(response.status)) throw new NotionSyncError('notion_schema_or_access', { setup: true });
    throw new NotionSyncError('notion_upstream_unknown', { ambiguous: isWrite, retryAfter });
  }
  try { return await boundedJson(response); }
  catch { throw new NotionSyncError('notion_invalid_response', { ambiguous: isWrite }); }
}
export async function verifySiteNotionPage(env, id, expectedDb) {
  const page = await siteNotionOnce(env, 'GET', `/pages/${encodeURIComponent(id)}`);
  if (page.object !== 'page' || page.archived || page.in_trash || compact(page.parent?.database_id) !== compact(expectedDb)) {
    throw new NotionSyncError('notion_relation_out_of_scope', { setup: true });
  }
  return page;
}
export async function validateSiteLedgerReferences(env, snapshot) {
  await verifySiteNotionPage(env, snapshot.classTypeId, CLASS_TYPE_DB);
  if (snapshot.studentId) await verifySiteNotionPage(env, snapshot.studentId, STUDENT_DB);
  if (snapshot.discountEventId) await verifySiteNotionPage(env, snapshot.discountEventId, DISCOUNT_DB);
  if (snapshot.studentRequired && !snapshot.studentId) throw new NotionSyncError('student_link_missing', { setup: true });
}
async function schemaReady(env) {
  const db = await siteNotionOnce(env, 'GET', `/databases/${PAYMENT_DB}`);
  const properties = db.properties || {};
  const required = { '타이틀': 'title', '수업 종류': 'relation', '학생': 'relation', '시간 회차': 'number',
    '실제 결제 금액': 'number', '환불 금액': 'number', '웹 주문 항목 ID': 'rich_text',
    '결제 당시 단가': 'number', '결제 당시 할인율': 'number', '결제수단': 'select', '결제일': 'date',
    '환불일': 'date', '환불 사유': 'rich_text' };
  if (Object.entries(required).some(([key, type]) => properties[key]?.type !== type)
    || !['select', 'rich_text'].includes(properties['결제 출처']?.type)) {
    throw new NotionSyncError('schema_snapshots_missing', { setup: true });
  }
  // No remote schema mutation. Formulas must already support the immutable quote.
  const dependsOn = (key, field, seen = new Set()) => {
    if (seen.has(key)) return false;
    seen.add(key);
    const expression = properties[key]?.formula?.expression || '';
    if (expression.includes(field)) return true;
    return Object.keys(properties).some(dependency => dependency !== key && expression.includes(dependency)
      && properties[dependency]?.type === 'formula' && dependsOn(dependency, field, new Set(seen)));
  };
  for (const key of ['결제 금액', '미수금', '결제 상태', '유효 시간 회차']) {
    if (!dependsOn(key, '결제 당시 단가')) throw new NotionSyncError('formula_snapshot_not_ready', { setup: true });
  }
  if (!dependsOn('결제 금액', '결제 당시 할인율')) {
    throw new NotionSyncError('formula_snapshot_not_ready', { setup: true });
  }
  return properties;
}
export function sitePaymentNotionProperties(row, schema) {
  const snapshot = JSON.parse(row.snapshot);
  const paymentDate = row.approved_at;
  if(!schema['결제수단']?.select?.options?.some(option=>option.name===row.method))throw new NotionSyncError('payment_method_option_missing',{setup:true});
  if(schema['결제 출처'].type==='select'&&!schema['결제 출처'].select?.options?.some(option=>option.name==='홈페이지'))throw new NotionSyncError('payment_source_option_missing',{setup:true});
  const properties = {
    타이틀: { title: rich(snapshot.studentId ? `${snapshot.targetName} ${snapshot.billingPeriod}` : snapshot.customerName) },
    '수업 종류': { relation: [{ id: snapshot.classTypeId }] }, '학생': { relation: snapshot.studentId ? [{ id: snapshot.studentId }] : [] },
    '시간 회차': { number: snapshot.timeLedgerMode === 'hours' ? snapshot.hours : 0 },
    '실제 결제 금액': { number: row.amount }, '환불 금액': { number: row.refunded_amount },
    '웹 주문 항목 ID': { rich_text: rich(row.order_item_id) },
    '결제 당시 단가': { number: snapshot.unitPriceSnapshot }, '결제 당시 할인율': { number: snapshot.discountRateSnapshot },
    '결제수단': { select: { name: row.method } }, '결제일': { date: { start: paymentDate } },
    '환불일': row.refund_at ? { date: { start: row.refund_at } } : { date: null },
    '환불 사유': { rich_text: row.refund_reason ? rich(row.refund_reason.slice(0, 1000)) : [] },
    '결제 출처': schema['결제 출처'].type === 'select' ? { select: { name: '홈페이지' } } : { rich_text: rich('홈페이지') },
  };
  if (schema['할인 적용']?.type === 'relation') properties['할인 적용'] = { relation: snapshot.discountEventId ? [{ id: snapshot.discountEventId }] : [] };
  if (!snapshot.studentId && schema['전화번호']?.type === 'phone_number') properties['전화번호'] = { phone_number: snapshot.customerPhone };
  if (schema['메모']?.type === 'rich_text') properties['메모'] = { rich_text: rich(`청구 대상: ${snapshot.billingPeriod} / 웹 주문 항목: ${row.order_item_id}${row.easy_pay_provider?` / 간편결제사: ${row.easy_pay_provider}`:''}`) };
  return properties;
}
async function itemRow(db, id) {
  return db.prepare(`SELECT oi.id AS order_item_id, oi.snapshot, o.version AS current_version, p.amount,p.refunded_amount,p.approved_at,
    p.method,p.easy_pay_provider,p.refund_at,p.refund_reason FROM site_order_items oi JOIN site_orders o ON o.id=oi.order_id
    JOIN site_payments p ON p.order_id=o.id WHERE oi.id=?1`).bind(id).first();
}
function verifyExisting(page, row) {
  const snapshot = JSON.parse(row.snapshot), properties = page.properties || {};
  if (page.archived || page.in_trash || compact(page.parent?.database_id) !== compact(PAYMENT_DB)) throw new NotionSyncError('notion_page_removed');
  if (richValue(properties['웹 주문 항목 ID']) !== row.order_item_id) throw new NotionSyncError('notion_trace_conflict');
  if (properties['실제 결제 금액']?.number !== row.amount
    || properties['결제 당시 단가']?.number !== snapshot.unitPriceSnapshot
    || properties['결제 당시 할인율']?.number !== snapshot.discountRateSnapshot
    || (properties['환불 금액']?.number || 0) > row.refunded_amount) throw new NotionSyncError('notion_manual_override');
}
async function settle(db, id, lease, { state, code = null, applied = null, pageId = null, retryAfter = 0 }) {
  await db.prepare(`UPDATE site_notion_outbox SET state=CASE WHEN ?3='synced' AND desired_version>?5 THEN 'pending' ELSE ?3 END,
    reason_code=?4,applied_version=COALESCE(?5,applied_version),notion_page_id=COALESCE(?6,notion_page_id),
    lease_token=NULL,lease_until=NULL,next_attempt_at=?7,updated_at=?8
    WHERE order_item_id=?1 AND lease_token=?2`).bind(id, lease, state, code, applied, pageId, timestamp() + retryAfter, now()).run();
}
export async function runSiteNotionSync(env, { limit = 5 } = {}) {
  if (!env.GAME_DB) return { processed: 0, unavailable: true };
  const db = env.GAME_DB;
  await db.prepare(`UPDATE site_notion_outbox SET state=CASE WHEN create_started_at IS NOT NULL THEN 'unknown' ELSE 'pending' END,
    reason_code='lease_expired',lease_token=NULL,lease_until=NULL WHERE state='processing' AND lease_until<?1`).bind(timestamp()).run();
  const candidates = await db.prepare("SELECT order_item_id FROM site_notion_outbox WHERE state='pending' AND next_attempt_at<=?1 ORDER BY created_at LIMIT ?2")
    .bind(timestamp(), Math.min(10, Math.max(1, limit))).all();
  const results = [];
  for (const candidate of candidates.results) {
    const id = candidate.order_item_id, lease = crypto.randomUUID();
    const job = await db.prepare(`UPDATE site_notion_outbox SET state='processing',lease_token=?2,lease_until=?3,
      attempt_count=attempt_count+1,updated_at=?4 WHERE order_item_id=?1 AND state='pending' RETURNING *`)
      .bind(id, lease, timestamp() + 90, now()).first();
    if (!job) continue;
    let pageId = job.notion_page_id;
    try {
      const row = await itemRow(db, id);
      if (!row) throw new NotionSyncError('payment_evidence_missing');
      const schema = await schemaReady(env);
      const snapshot = JSON.parse(row.snapshot);
      await validateSiteLedgerReferences(env, snapshot);
      const properties = sitePaymentNotionProperties(row, schema);
      if (pageId) {
        const existing = await siteNotionOnce(env, 'GET', `/pages/${pageId}`);
        verifyExisting(existing, row);
        // Preserve instructor notes, title, relationships, and contact on refund updates.
        const refundOnly = { '환불 금액': properties['환불 금액'], '환불일': properties['환불일'], '환불 사유': properties['환불 사유'] };
        const gate = await db.prepare('SELECT desired_version,lease_token FROM site_notion_outbox WHERE order_item_id=?1').bind(id).first();
        if (gate.lease_token !== lease || gate.desired_version !== row.current_version) {
          await settle(db, id, lease, { state: 'pending' }); continue;
        }
        await siteNotionOnce(env, 'PATCH', `/pages/${pageId}`, { properties: refundOnly });
      } else {
        if (job.create_started_at) throw new NotionSyncError('notion_creation_unknown', { ambiguous: true });
        const duplicate = await siteNotionOnce(env, 'POST', `/databases/${PAYMENT_DB}/query`, {
          filter: { property: '웹 주문 항목 ID', rich_text: { equals: id } }, page_size: 2,
        });
        if (duplicate.results?.length) throw new NotionSyncError('notion_unlinked_existing', { ambiguous: true });
        const started = await db.prepare(`UPDATE site_notion_outbox SET create_started_at=?3 WHERE order_item_id=?1 AND lease_token=?2
          AND desired_version=?4 AND create_started_at IS NULL RETURNING order_item_id`).bind(id, lease, now(), row.current_version).first();
        if (!started) { await settle(db, id, lease, { state: 'pending' }); continue; }
        const created = await siteNotionOnce(env, 'POST', '/pages', { parent: { database_id: PAYMENT_DB }, properties });
        if (created.object !== 'page' || !created.id) throw new NotionSyncError('notion_creation_unknown', { ambiguous: true });
        pageId = created.id;
        await db.prepare('UPDATE site_notion_outbox SET notion_page_id=?3 WHERE order_item_id=?1 AND lease_token=?2').bind(id, lease, pageId).run();
      }
      const saved = await siteNotionOnce(env, 'GET', `/pages/${pageId}`);
      verifyExisting(saved, row);
      if ((saved.properties?.['환불 금액']?.number || 0) !== row.refunded_amount) throw new NotionSyncError('notion_refund_mismatch');
      const expectedHours = snapshot.timeLedgerMode !== 'hours' ? 0 : row.refunded_amount === 0 ? snapshot.hours
        : Math.max(0, Math.min(snapshot.hours, (row.amount - row.refunded_amount) / snapshot.unitPriceSnapshot));
      const unpaid = saved.properties?.['미수금']?.formula?.number;
      const effective = saved.properties?.['유효 시간 회차']?.formula?.number;
      if (!Number.isFinite(unpaid) || unpaid > 0 || !Number.isFinite(effective) || Math.abs(effective - expectedHours) > 0.000001) {
        throw new NotionSyncError('notion_calculation_mismatch');
      }
      await settle(db, id, lease, { state: 'synced', applied: row.current_version, pageId });
      results.push({ orderItemId: id, state: 'synced' });
    } catch (error) {
      const state = error.ambiguous ? 'unknown' : error.setup ? 'needs_setup'
        : error.code === 'notion_rate_limited' || error.code === 'notion_upstream_unknown' || error.code === 'notion_network_unknown' ? 'pending' : 'failed';
      // A 429 is a definitive refusal, so a new creation attempt remains safe.
      if (error.code === 'notion_rate_limited' || (error.setup && !job.create_started_at)) await db.prepare('UPDATE site_notion_outbox SET create_started_at=NULL WHERE order_item_id=?1 AND lease_token=?2 AND notion_page_id IS NULL').bind(id, lease).run();
      await settle(db, id, lease, { state, code: error.code || 'notion_sync_failed', pageId, retryAfter: error.retryAfter || 60 });
      results.push({ orderItemId: id, state, reasonCode: error.code || 'notion_sync_failed' });
    }
  }
  return { processed: results.length, results };
}
export async function reconcileSiteNotionItem(env, id, providedPageId = null) {
  const db = env.GAME_DB, job = await db.prepare('SELECT * FROM site_notion_outbox WHERE order_item_id=?1').bind(id).first();
  if (!job) return { status: 404, error: '장부 작업을 찾을 수 없습니다.' };
  if (job.state === 'processing') return { status: 409, error: '장부 반영이 진행 중입니다.' };
  try {
    await schemaReady(env);
    const row = await itemRow(db, id);
    let pageId = providedPageId || job.notion_page_id;
    if (!pageId && job.create_started_at) {
      const found = await siteNotionOnce(env, 'POST', `/databases/${PAYMENT_DB}/query`, {
        filter: { property: '웹 주문 항목 ID', rich_text: { equals: id } }, page_size: 2,
      });
      if (found.has_more || found.results?.length !== 1) return { status: 409, error: '생성 결과가 확정되지 않았습니다. 원래 장부 기록을 확인해주세요.' };
      pageId = found.results[0].id;
    }
    if (pageId) verifyExisting(await siteNotionOnce(env, 'GET', `/pages/${encodeURIComponent(pageId)}`), row);
    await db.prepare(`UPDATE site_notion_outbox SET state='pending',reason_code=NULL,notion_page_id=COALESCE(?2,notion_page_id),
      next_attempt_at=0,updated_at=?3 WHERE order_item_id=?1 AND state!='processing'`).bind(id, pageId, now()).run();
    return { status: 200, result: { ok: true, orderItemId: id, state: 'pending' } };
  } catch (error) { return { status: 409, error: error.code === 'schema_snapshots_missing' || error.setup ? 'Notion 추적 속성과 스냅샷 계산 설정을 확인해주세요.' : '원래 장부 기록을 확인한 후 다시 대조해주세요.' }; }
}
export const SITE_LEDGER_DATABASES = { payment: PAYMENT_DB, student: STUDENT_DB, classType: CLASS_TYPE_DB, discount: DISCOUNT_DB };
