import { z } from 'zod';
import { authorizeSiteMember, siteOrigin, siteJson, checkSiteOrigin } from './siteAuth.js';
import { rateLimitCheck } from './securityStore.js';
import { validateSiteLedgerReferences, verifySiteNotionPage, SITE_LEDGER_DATABASES, runSiteNotionSync, reconcileSiteNotionItem } from './siteNotionSync.js';
import { linkSiteStudentMember, siteStudentMemberErrorResponse } from './siteStudentMembers.js';

const UUID = z.string().uuid();
const money = z.number().int().positive().max(1_000_000_000);
const phone = z.string().trim().min(8).max(24).refine(value => /^\+?[0-9]{8,15}$/.test(value.replace(/[\s()-]/g, '')), '연락처를 확인해주세요.');
const text = (max, min = 1) => z.string().trim().min(min).max(max);
const targetSchema = z.object({ name: text(80), experienceType: z.enum(['class', 'special', 'external', 'other']),
  classTypeId: UUID, studentRequired: z.boolean(), timeLedgerMode: z.enum(['hours', 'none']), unitPrice: z.number().int().min(0).max(1_000_000_000), active: z.boolean().optional().default(true) }).strict();
const requestSchema = z.object({ memberId: UUID, targetId: UUID, billingKey: text(100), billingPeriod: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  hours: z.number().min(0).max(1000), amount: money, unitPriceSnapshot: z.number().int().min(0).optional(),
  discountRateSnapshot: z.number().min(0).max(100).optional().default(0), discountEventId: UUID.nullable().optional().default(null),
  customerName: text(60).optional(), expiresAt: z.string().datetime({ offset: true }), termsVersion: text(60),
  refundPolicy: text(2000,20),
}).strict();
const orderSchema = z.object({ requestId: UUID, idempotencyKey: UUID, customerName: text(60), customerPhone: phone, termsVersion: text(60),termsAccepted:z.literal(true) }).strict();
const confirmSchema = z.object({ orderId: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/), paymentKey: text(200), amount: money }).strict();
const refundSchema = z.object({ reason: text(500, 2), amount: money.optional() }).strict();
const refundApprovalSchema=z.object({amount:money,reason:text(500,2)}).strict();
const error = (status, message) => siteJson({ error: message }, { status });
const now = () => new Date().toISOString();
const unix = () => Math.floor(Date.now() / 1000);
async function bodyOf(request, schema) {
  const result = schema.safeParse(await request.json().catch(() => null));
  return result.success ? { value: result.data } : { response: error(400, '입력값을 확인해주세요.') };
}
async function hash(secret, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`site-commerce/v1/${value}`))), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function siteTossReady(env) {
  const prefix = env.SITE_TOSS_MODE === 'test' ? 'test_' : env.SITE_TOSS_MODE === 'live' ? 'live_' : null;
  return !!prefix && typeof env.SITE_TOSS_CLIENT_KEY === 'string' && env.SITE_TOSS_CLIENT_KEY.startsWith(`${prefix}gck_`)
    && typeof env.SITE_TOSS_SECRET_KEY === 'string' && env.SITE_TOSS_SECRET_KEY.startsWith(`${prefix}gsk_`)
    && typeof env.SITE_TOSS_MERCHANT_ID === 'string' && env.SITE_TOSS_MERCHANT_ID.length > 0;
}
class PgError extends Error {
  constructor(code, { definitive = false, status = 503 } = {}) { super(code); this.code = code; this.definitive = definitive; this.status = status; }
}
async function pgJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new PgError('pg_invalid_response');
  const chunks = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength; if (size > 128 * 1024) { await reader.cancel(); throw new PgError('pg_response_too_large'); } chunks.push(part.value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new PgError('pg_invalid_response'); }
}
async function toss(env, method, path, body, idempotencyKey) {
  if (!siteTossReady(env)) throw new PgError('pg_not_configured');
  let response;
  try {
    response = await fetch(`https://api.tosspayments.com${path}`, { method, redirect: 'manual', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Basic ${btoa(`${env.SITE_TOSS_SECRET_KEY}:`)}`, 'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch { throw new PgError('pg_result_unknown'); }
  const data = await pgJson(response);
  if (!response.ok) throw new PgError('pg_request_failed', { definitive: response.status >= 400 && response.status < 500 && ![408,409,429].includes(response.status)
    && !/^(ALREADY_|DUPLICATED_)/.test(String(data?.code || '')), status: response.status });
  return data;
}
function targetDto(row, admin) {
  const value = { id: row.id, name: row.name, experienceType: row.experience_type };
  return admin ? { ...value, classTypeId: row.class_type_id, studentRequired: !!row.student_required,
    timeLedgerMode: row.time_ledger_mode, unitPrice: row.unit_price, active: !!row.active, version: row.version,
    createdAt: row.created_at, updatedAt: row.updated_at } : value;
}
function requestDto(row, admin = false) {
  const snapshot = JSON.parse(row.snapshot);
  const publicSnapshot = { targetId: row.target_id, targetName: snapshot.targetName, title: snapshot.targetName,
    experienceType: snapshot.experienceType, billingPeriod: snapshot.billingPeriod, periodLabel: snapshot.billingPeriod,
    hours: snapshot.hours, customerName: snapshot.customerName, refundPolicy: snapshot.refundPolicy,
    methods: ['CARD','EASY_PAY'], termsVersion: row.terms_version };
  return { id: row.id, ...publicSnapshot, amount: row.amount, currency: row.currency, expiresAt: row.expires_at,
    status: row.status === 'open' && row.expires_at <= now() ? 'expired' : row.status, version: row.version, createdAt: row.created_at,
    ...(admin ? { ...snapshot, memberId: row.member_id, memberCode: row.member_code, billingKey: row.billing_key } : {}) };
}
async function orderDto(db, row, admin = false) {
  const snapshot = JSON.parse(row.snapshot);
  const refunds = await db.prepare('SELECT id,amount,reason,approved_amount,approved_reason,state,created_at,approved_at FROM site_refund_requests WHERE order_id=?1 ORDER BY created_at DESC').bind(row.id).all();
  const method=await db.prepare('SELECT easy_pay_provider FROM site_payments WHERE order_id=?1').bind(row.id).first();
  const sync = await db.prepare(`SELECT state,reason_code,notion_page_id,updated_at,order_item_id FROM site_notion_outbox
    WHERE order_item_id=(SELECT id FROM site_order_items WHERE order_id=?1)`).bind(row.id).first();
  const inflight = refunds.results.some(refund => ['pending','approving','unknown'].includes(refund.state));
  const attempt=await db.prepare('SELECT state,created_at,payment_key FROM site_payment_attempts WHERE id=?1').bind(row.active_attempt_id).first();
  const invoice=await db.prepare('SELECT expires_at FROM site_payment_requests WHERE id=?1').bind(row.request_id).first();
  return { id: row.id, requestId: row.request_id, targetId: snapshot.targetId, targetName: snapshot.targetName, orderName: snapshot.targetName,
    billingPeriod: snapshot.billingPeriod, hours: snapshot.hours, amount: row.amount, currency: row.currency, status: row.status,
    customerName: snapshot.customerName, customerPhone: snapshot.customerPhone, createdAt: row.created_at,
    approvedAt: row.approved_at, paidAt: row.approved_at, paymentMethod: row.payment_method,paymentProvider:method?.easy_pay_provider||null, refundedAmount: row.refunded_amount,
    canRefund: !!row.approved_at && row.refunded_amount < row.amount && !inflight,
    canResume:row.status==='pending'&&!row.approved_at&&attempt?.state==='ready'&&!attempt.payment_key
      &&Date.parse(attempt.created_at)+30*60*1000>Date.now()&&invoice?.expires_at>now(),attemptStatus:attempt?.state||null,
    refundReason: refunds.results[0]?.reason || null,
    refunds: refunds.results.map(refund => ({ id: refund.id, amount: refund.approved_amount??refund.amount, reason: refund.approved_reason??refund.reason,
      requestedAmount:refund.amount,requestedReason:refund.reason,approvedAmount:refund.approved_amount,status: refund.state,
      requestedAt: refund.created_at, approvedAt: refund.approved_at })),
    notionSync: sync ? { state: sync.state, reasonCode: sync.reason_code, updatedAt: sync.updated_at,
      ...(admin ? { notionPageId: sync.notion_page_id, orderItemId: sync.order_item_id } : {}) } : null,
    ...(admin ? { memberId: row.member_id, memberCode: row.member_code, ...snapshot } : {}) };
}
function checkoutDto(env, order, attempt, member) {
  const snapshot = JSON.parse(order.snapshot), origin = siteOrigin(env);
  return { clientKey: env.SITE_TOSS_CLIENT_KEY, customerKey: member.customerKey,
    orderId: attempt.pg_order_id, orderName: `${snapshot.targetName} ${snapshot.billingPeriod}`.slice(0, 100),
    amount: order.amount, currency: order.currency, successUrl: `${origin}/pay/success/`, failUrl: `${origin}/pay/fail/` };
}
async function resumeCheckout(env,db,order,member){
  if(!siteTossReady(env)||order.status!=='pending'||order.approved_at)return null;
  const attempt=await db.prepare('SELECT * FROM site_payment_attempts WHERE id=?1').bind(order.active_attempt_id).first();
  const invoice=await db.prepare('SELECT expires_at FROM site_payment_requests WHERE id=?1').bind(order.request_id).first();
  if(!attempt||attempt.state!=='ready'||attempt.payment_key||attempt.pg_environment!==env.SITE_TOSS_MODE||!invoice||invoice.expires_at<=now()
    ||Date.parse(attempt.created_at)+30*60*1000<=Date.now())return null;
  return checkoutDto(env,order,attempt,member);
}
export function verifiedTossPayment(env, data, attempt, order) {
  if (!data || data.orderId !== attempt.pg_order_id || typeof data.paymentKey !== 'string' || data.paymentKey.length > 200
    || (attempt.payment_key && attempt.payment_key !== data.paymentKey) || data.mId !== env.SITE_TOSS_MERCHANT_ID
    || attempt.pg_environment !== env.SITE_TOSS_MODE || data.totalAmount !== order.amount || data.currency !== 'KRW'
    || !['DONE','PARTIAL_CANCELED','CANCELED'].includes(data.status) || !data.approvedAt || !Number.isFinite(Date.parse(data.approvedAt))
    || !['카드','간편결제'].includes(data.method)) throw new PgError('pg_evidence_mismatch');
  const cancellations = (data.cancels || []).filter(cancel => cancel.cancelStatus === 'DONE');
  if (cancellations.some(cancel => typeof cancel.transactionKey !== 'string' || cancel.transactionKey.length > 64
    || !Number.isSafeInteger(cancel.cancelAmount) || cancel.cancelAmount <= 0 || !Number.isFinite(Date.parse(cancel.canceledAt)))
    || new Set(cancellations.map(cancel => cancel.transactionKey)).size !== cancellations.length) throw new PgError('pg_cancel_evidence_mismatch');
  const refunded = cancellations.reduce((total, cancel) => total + cancel.cancelAmount, 0);
  if (refunded > order.amount || data.balanceAmount !== order.amount - refunded
    || (data.status === 'CANCELED' && refunded !== order.amount) || (data.status === 'DONE' && refunded !== 0)) throw new PgError('pg_balance_mismatch');
  const sorted = [...cancellations].sort((a,b) => Date.parse(a.canceledAt)-Date.parse(b.canceledAt) || a.transactionKey.localeCompare(b.transactionKey));
  return { paymentKey: data.paymentKey, merchantId: data.mId, amount: data.totalAmount, currency: data.currency,
    method: data.method,easyPayProvider:typeof data.easyPay?.provider==='string'?data.easyPay.provider.slice(0,60):null,
    approvedAt: new Date(data.approvedAt).toISOString(), refundedAmount: refunded,
    refundAt: sorted.length ? new Date(sorted.at(-1).canceledAt).toISOString() : null,
    refundReason: sorted.length ? String(sorted.at(-1).cancelReason || '').slice(0, 200) : null,
    cancellations: sorted.map(cancel => ({ key: cancel.transactionKey, amount: cancel.cancelAmount,
      at: new Date(cancel.canceledAt).toISOString(), reason: String(cancel.cancelReason || '').slice(0, 200) })) };
}
export async function recordSitePayment(env, data, attempt, order) {
  const proof = verifiedTossPayment(env, data, attempt, order), db = env.GAME_DB;
  const approvalReason=proof.refundReason?await db.prepare('SELECT approved_reason FROM site_refund_requests WHERE order_id=?1 AND approved_pg_reason=?2').bind(order.id,proof.refundReason).first():null;
  const cleanRefundReason=approvalReason?.approved_reason||proof.refundReason;
  const evidenceHash = await hash(env.SITE_SESSION_SECRET, JSON.stringify(proof));
  const updated = now();
  const statements = [db.prepare(`INSERT INTO site_payments (payment_key,order_id,attempt_id,pg_order_id,pg_environment,merchant_id,
    amount,currency,method,approved_at,refunded_amount,refund_at,refund_reason,evidence_hash,updated_at,easy_pay_provider)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
    ON CONFLICT(payment_key) DO UPDATE SET refunded_amount=excluded.refunded_amount,refund_at=excluded.refund_at,
      refund_reason=excluded.refund_reason,evidence_hash=excluded.evidence_hash,updated_at=excluded.updated_at
    WHERE site_payments.order_id=excluded.order_id AND site_payments.amount=excluded.amount AND site_payments.currency=excluded.currency
      AND site_payments.merchant_id=excluded.merchant_id AND site_payments.refunded_amount<=excluded.refunded_amount
      AND site_payments.evidence_hash!=excluded.evidence_hash`).bind(proof.paymentKey,order.id,attempt.id,attempt.pg_order_id,attempt.pg_environment,
      proof.merchantId,proof.amount,proof.currency,proof.method,proof.approvedAt,proof.refundedAmount,proof.refundAt,cleanRefundReason,evidenceHash,updated,proof.easyPayProvider),
    db.prepare(`UPDATE site_payment_attempts SET state='paid',payment_key=?2,lease_token=NULL,lease_until=NULL,updated_at=?3
      WHERE id=?1 AND EXISTS(SELECT 1 FROM site_payments p WHERE p.attempt_id=?1 AND p.payment_key=?2)`).bind(attempt.id,proof.paymentKey,updated),
    db.prepare(`UPDATE site_orders SET status=(SELECT CASE WHEN refunded_amount=amount THEN 'refunded' WHEN refunded_amount>0 THEN 'partially_refunded' ELSE 'paid' END
      FROM site_payments WHERE order_id=?1), refunded_amount=(SELECT refunded_amount FROM site_payments WHERE order_id=?1),
      approved_at=COALESCE(approved_at,(SELECT approved_at FROM site_payments WHERE order_id=?1)),
      payment_method=(SELECT method FROM site_payments WHERE order_id=?1),last_evidence_hash=(SELECT evidence_hash FROM site_payments WHERE order_id=?1),
      version=version+1,updated_at=?2 WHERE id=?1 AND EXISTS(SELECT 1 FROM site_payments p WHERE p.order_id=?1 AND
        (site_orders.last_evidence_hash IS NULL OR site_orders.last_evidence_hash!=p.evidence_hash))`).bind(order.id,updated),
    db.prepare("UPDATE site_payment_requests SET status='paid',version=version+1,updated_at=?2 WHERE id=?1 AND status!='paid' AND EXISTS(SELECT 1 FROM site_payments WHERE order_id=?3)")
      .bind(order.request_id,updated,order.id),
    db.prepare(`INSERT INTO site_notion_outbox(order_item_id,desired_version,state,created_at,updated_at)
      SELECT oi.id,o.version,'pending',?2,?2 FROM site_order_items oi JOIN site_orders o ON o.id=oi.order_id WHERE o.id=?1 AND o.approved_at IS NOT NULL
      ON CONFLICT(order_item_id) DO UPDATE SET desired_version=excluded.desired_version,
        state=CASE WHEN site_notion_outbox.state IN ('unknown','processing') THEN site_notion_outbox.state ELSE 'pending' END,
        updated_at=excluded.updated_at WHERE site_notion_outbox.desired_version<excluded.desired_version`).bind(order.id,updated),
  ];
  for (const cancel of proof.cancellations) statements.push(db.prepare(`INSERT INTO site_refund_transactions(transaction_key,payment_key,amount,cancelled_at,reason)
    VALUES(?1,?2,?3,?4,?5) ON CONFLICT(transaction_key) DO NOTHING`).bind(cancel.key,proof.paymentKey,cancel.amount,cancel.at,cancel.reason));
  statements.push(db.prepare(`UPDATE site_refund_requests SET state='completed',approved_at=COALESCE(approved_at,?2),updated_at=?2,
    lease_token=NULL,lease_until=NULL WHERE order_id=?1 AND state IN ('approving','unknown') AND approved_amount=(
      SELECT COALESCE(SUM(t.amount),0) FROM site_refund_transactions t WHERE t.payment_key=?3 AND t.reason=site_refund_requests.approved_pg_reason
    )`).bind(order.id,updated,proof.paymentKey));
  await db.batch(statements);
  return proof;
}
export async function reconcileSitePayments(env) {
  if(!env.GAME_DB)return {processed:0};
  await expireReadySiteAttempts(env);
  if(!siteTossReady(env))return {processed:0};
  const db=env.GAME_DB;
  const attempts=await db.prepare(`SELECT a.* FROM site_payment_attempts a WHERE a.payment_key IS NOT NULL AND
    (a.state='confirming' OR EXISTS(SELECT 1 FROM site_refund_requests r WHERE r.order_id=a.order_id AND r.state IN ('approving','unknown')))
    ORDER BY a.updated_at LIMIT 10`).all();
  let processed=0;
  for(const attempt of attempts.results){try{
    const order=await orderById(db,attempt.order_id);
    const data=await toss(env,'GET',`/v1/payments/${encodeURIComponent(attempt.payment_key)}`);
    if(!await recordClosedAttempt(env,data,attempt,order))await recordSitePayment(env,data,attempt,order);processed++;
  }catch{/* Known attempts remain durable until their authoritative result is available. */}}
  const inbox=await db.prepare("SELECT * FROM site_pg_webhook_inbox WHERE state='pending' ORDER BY created_at LIMIT 10").all();
  for(const event of inbox.results){try{
    const attempt=await attemptByPgId(db,event.pg_order_id),order=attempt&&await orderById(db,attempt.order_id);
    if(!attempt||!order)continue;
    const data=await toss(env,'GET',`/v1/payments/${encodeURIComponent(event.payment_key)}`);
    if(!await recordClosedAttempt(env,data,attempt,order))await recordSitePayment(env,data,attempt,order);
    await db.prepare("UPDATE site_pg_webhook_inbox SET state='processed',updated_at=?2 WHERE id=?1").bind(event.id,now()).run();processed++;
  }catch{/* Inbox is durable, so a transient PG outage does not lose the event. */}}
  return {processed};
}
export async function expireReadySiteAttempts(env,orderId=null){
  const db=env.GAME_DB,at=now(),cutoff=new Date(Date.now()-30*60*1000).toISOString();
  await db.batch([db.prepare(`UPDATE site_payment_attempts SET state='expired',updated_at=?1
    WHERE state='ready' AND payment_key IS NULL AND (?3 IS NULL OR order_id=?3)
      AND NOT EXISTS(SELECT 1 FROM site_payments p WHERE p.order_id=site_payment_attempts.order_id)
      AND (created_at<=?2 OR EXISTS(SELECT 1 FROM site_orders o JOIN site_payment_requests r ON r.id=o.request_id
        WHERE o.id=site_payment_attempts.order_id AND r.expires_at<=?1))`).bind(at,cutoff,orderId),
    db.prepare(`UPDATE site_orders SET status='expired',updated_at=?1 WHERE status='pending' AND approved_at IS NULL
      AND (?2 IS NULL OR id=?2) AND EXISTS(SELECT 1 FROM site_payment_attempts a WHERE a.id=site_orders.active_attempt_id
        AND a.state='expired' AND a.payment_key IS NULL) AND NOT EXISTS(SELECT 1 FROM site_payments p WHERE p.order_id=site_orders.id)`).bind(at,orderId)]);
}
async function recordClosedAttempt(env,data,attempt,order){
  if(data?.approvedAt||!['ABORTED','EXPIRED','CANCELED'].includes(data?.status))return false;
  if(data.orderId!==attempt.pg_order_id||data.mId!==env.SITE_TOSS_MERCHANT_ID||data.totalAmount!==order.amount||data.currency!=='KRW')throw new PgError('pg_closed_evidence_mismatch');
  const state=data.status==='EXPIRED'?'expired':'failed';
  await env.GAME_DB.batch([env.GAME_DB.prepare(`UPDATE site_payment_attempts SET state=?2,lease_token=NULL,lease_until=NULL,updated_at=?3
    WHERE id=?1 AND state IN ('ready','confirming') AND NOT EXISTS(SELECT 1 FROM site_payments WHERE order_id=?4)`).bind(attempt.id,state,now(),order.id),
    env.GAME_DB.prepare("UPDATE site_orders SET status=?2,updated_at=?3 WHERE id=?1 AND approved_at IS NULL AND EXISTS(SELECT 1 FROM site_payment_attempts WHERE id=?4 AND state=?2)").bind(order.id,state,now(),attempt.id)]);
  return true;
}
async function attemptByPgId(db, id) {
  return db.prepare('SELECT * FROM site_payment_attempts WHERE pg_order_id=?1').bind(id).first();
}
async function orderById(db, id, memberId) {
  return db.prepare(`SELECT o.*,m.member_code FROM site_orders o JOIN site_members m ON m.id=o.member_id WHERE o.id=?1${memberId ? ' AND o.member_id=?2' : ''}`)
    .bind(id,...(memberId ? [memberId] : [])).first();
}
async function memberOrderByReference(db, reference, memberId) {
  if (!UUID.safeParse(reference).success && !/^site_[a-f0-9]{32}$/.test(reference)) return null;
  return db.prepare(`SELECT o.*,m.member_code FROM site_orders o JOIN site_members m ON m.id=o.member_id
    WHERE o.member_id=?2 AND (o.id=?1 OR EXISTS(SELECT 1 FROM site_payment_attempts a WHERE a.order_id=o.id AND a.pg_order_id=?1))`)
    .bind(reference,memberId).first();
}
function scheduleSync(ctx, env) {
  if (ctx?.waitUntil) ctx.waitUntil(runSiteNotionSync(env).catch(() => console.error('[site-ledger] pending retry')));
}
async function confirmPayment(request, env, member, ctx) {
  const parsed = await bodyOf(request, confirmSchema); if (parsed.response) return parsed.response;
  const input = parsed.value, db = env.GAME_DB;
  if (!siteTossReady(env)) return error(503, '온라인 결제 서비스를 준비 중입니다.');
  const attempt = await attemptByPgId(db, input.orderId);
  const order = attempt && await orderById(db, attempt.order_id, member.id);
  if (!order) return error(404, '본인의 주문을 찾을 수 없습니다.');
  if (input.amount !== order.amount || (attempt.payment_key && attempt.payment_key !== input.paymentKey)) return error(409, '주문 결제 정보를 확인해주세요.');
  if (order.approved_at) return siteJson({ order: await orderDto(db, order), state: order.status });
  if (['failed','expired'].includes(attempt.state)) return error(409, '종료된 결제 시도입니다. 주문에서 다시 시작해주세요.');
  if(attempt.state==='ready'){
    const invoice=await db.prepare('SELECT expires_at FROM site_payment_requests WHERE id=?1').bind(order.request_id).first();
    if(!invoice||invoice.expires_at<=now()||Date.parse(attempt.created_at)+30*60*1000<=Date.now()){
      await db.batch([db.prepare("UPDATE site_payment_attempts SET state='expired',updated_at=?2 WHERE id=?1 AND state='ready'").bind(attempt.id,now()),
        db.prepare("UPDATE site_orders SET status='expired',updated_at=?2 WHERE id=?1 AND approved_at IS NULL AND EXISTS(SELECT 1 FROM site_payment_attempts WHERE id=?3 AND state='expired')").bind(order.id,now(),attempt.id)]);
      return error(410,'결제 시도 유효 기간이 지났습니다. 내 주문에서 다시 확인해주세요.');
    }
  }
  const lease = crypto.randomUUID();
  const claimed = await db.prepare(`UPDATE site_payment_attempts SET state='confirming',payment_key=?2,lease_token=?3,lease_until=?4,updated_at=?5
    WHERE id=?1 AND state='ready' AND payment_key IS NULL RETURNING *`).bind(attempt.id,input.paymentKey,lease,unix()+30,now()).first();
  if (!claimed) {
    if (attempt.payment_key) {
      try { const data=await toss(env,'GET',`/v1/payments/${encodeURIComponent(attempt.payment_key)}`);
        if(!await recordClosedAttempt(env,data,attempt,order))await recordSitePayment(env,data,attempt,order); }
      catch { /* Still unresolved: never ask the customer to charge again. */ }
    }
    const current = await orderById(db, order.id, member.id);
    return siteJson({ order: await orderDto(db,current), state: current.approved_at ? current.status : 'confirming' }, { status: current.approved_at ? 200 : 202 });
  }
  let approvalStarted=false,approvedObserved=false;
  try {
    // Authentication in the PG UI has not charged the customer yet. Read the
    // selected method before confirming so excluded methods cannot be captured.
    const pending=await toss(env,'GET',`/v1/payments/${encodeURIComponent(input.paymentKey)}`);
    if(pending.orderId!==claimed.pg_order_id||pending.paymentKey!==input.paymentKey||pending.mId!==env.SITE_TOSS_MERCHANT_ID
      ||pending.totalAmount!==order.amount||pending.currency!=='KRW'||claimed.pg_environment!==env.SITE_TOSS_MODE){
      throw new PgError('pg_preflight_mismatch',{definitive:true,status:400});
    }
    if(['DONE','PARTIAL_CANCELED','CANCELED'].includes(pending.status)&&pending.approvedAt){
      approvedObserved=true;await recordSitePayment(env,pending,claimed,order);scheduleSync(ctx,env);
      const current=await orderById(db,order.id,member.id);return siteJson({order:await orderDto(db,current),state:current.status});
    }
    if(pending.status!=='IN_PROGRESS'||!['카드','간편결제'].includes(pending.method)){
      throw new PgError('pg_method_not_enabled',{definitive:true,status:400});
    }
    approvalStarted=true;
    const data = await toss(env,'POST','/v1/payments/confirm', { orderId: input.orderId,paymentKey: input.paymentKey,amount: order.amount },claimed.idempotency_key);
    await recordSitePayment(env,data,claimed,order);
    scheduleSync(ctx,env);
    const current = await orderById(db,order.id,member.id);
    return siteJson({ order: await orderDto(db,current),state: current.status });
  } catch (failure) {
    if(!approvalStarted&&!approvedObserved&&!failure.definitive){
      await db.batch([db.prepare(`UPDATE site_payment_attempts SET state='ready',payment_key=NULL,lease_token=NULL,lease_until=NULL,updated_at=?3
        WHERE id=?1 AND lease_token=?2 AND state='confirming' AND NOT EXISTS(SELECT 1 FROM site_payments WHERE order_id=?4)`)
        .bind(attempt.id,lease,now(),order.id),db.prepare(`UPDATE site_orders SET status='pending',updated_at=?2 WHERE id=?1 AND approved_at IS NULL
        AND EXISTS(SELECT 1 FROM site_payment_attempts WHERE id=?3 AND state='ready')`).bind(order.id,now(),attempt.id)]);
      return error(503,'결제수단 확인을 잠시 완료하지 못했습니다. 같은 주문에서 다시 확인해주세요.');
    }
    if (failure.definitive) {
      const recovered=await orderById(db,order.id,member.id);
      if(recovered.approved_at)return siteJson({order:await orderDto(db,recovered),state:recovered.status});
      await db.batch([db.prepare("UPDATE site_payment_attempts SET state='failed',error_code='pg_declined',lease_token=NULL,lease_until=NULL,updated_at=?2 WHERE id=?1 AND state='confirming' AND NOT EXISTS(SELECT 1 FROM site_payments WHERE attempt_id=?1)").bind(attempt.id,now()),
        db.prepare("UPDATE site_orders SET status='failed',updated_at=?2 WHERE id=?1 AND approved_at IS NULL").bind(order.id,now())]);
      return error(402, '결제가 승인되지 않았습니다. 주문에서 결제 상태를 확인해주세요.');
    }
    return siteJson({ order: await orderDto(db,await orderById(db,order.id,member.id)),state:'confirming',message:'결제 결과를 확인 중입니다. 다시 결제하지 말고 주문 상태를 확인해주세요.' },{status:202});
  }
}
async function createOrder(request,env,member) {
  const parsed = await bodyOf(request,orderSchema); if (parsed.response) return parsed.response;
  if (!siteTossReady(env)) return error(503,'온라인 결제 서비스를 준비 중입니다.');
  const input = parsed.value, db=env.GAME_DB;
  const retryHash = await hash(env.SITE_SESSION_SECRET,`order-key:${member.id}:${input.idempotencyKey}`);
  const payloadHash = await hash(env.SITE_SESSION_SECRET,JSON.stringify(input));
  const existing = await db.prepare('SELECT * FROM site_orders WHERE idempotency_hash=?1 OR (request_id=?2 AND member_id=?3)').bind(retryHash,input.requestId,member.id).first();
  if (existing) {
    const frozen=JSON.parse(existing.snapshot);
    if(existing.member_id!==member.id||existing.request_id!==input.requestId||frozen.customerName!==input.customerName
      ||frozen.customerPhone!==input.customerPhone.replace(/[\s()-]/g,'')||frozen.termsVersion!==input.termsVersion)return error(409,'주문이 이미 생성되었습니다. 내 주문에서 확인해주세요.');
    return siteJson({order:await orderDto(db,existing),checkout:await resumeCheckout(env,db,existing,member)});
  }
  const paymentRequest=await db.prepare("SELECT * FROM site_payment_requests WHERE id=?1 AND member_id=?2 AND status='open'").bind(input.requestId,member.id).first();
  if(!paymentRequest) return error(404,'본인의 결제 요청을 찾을 수 없습니다.');
  if(paymentRequest.expires_at<=now()) return error(410,'결제 요청의 유효 기간이 지났습니다.');
  if(input.termsVersion!==paymentRequest.terms_version) return error(409,'주문 조건이 변경되었습니다. 결제 요청을 다시 확인해주세요.');
  const snapshot={...JSON.parse(paymentRequest.snapshot),customerName:input.customerName,customerPhone:input.customerPhone.replace(/[\s()-]/g,''),termsAcceptedAt:now()};
  const id=crypto.randomUUID(),itemId=crypto.randomUUID(),attemptId=crypto.randomUUID(),at=now(),pgOrderId=`site_${crypto.randomUUID().replace(/-/g,'')}`;
  // Conditional INSERT claims the request. Every dependent row exists only for the winner.
  await db.batch([
    db.prepare(`INSERT INTO site_orders(id,member_id,request_id,idempotency_hash,payload_hash,snapshot,amount,currency,active_attempt_id,created_at,updated_at)
      SELECT ?1,member_id,id,?3,?4,?5,amount,currency,?6,?7,?7 FROM site_payment_requests
      WHERE id=?2 AND member_id=?8 AND status='open' AND expires_at>?7 ON CONFLICT(request_id) DO NOTHING`)
      .bind(id,paymentRequest.id,retryHash,payloadHash,JSON.stringify(snapshot),attemptId,at,member.id),
    db.prepare(`INSERT INTO site_order_items(id,order_id,target_id,snapshot) SELECT ?1,id,?3,snapshot FROM site_orders WHERE id=?2`).bind(itemId,id,paymentRequest.target_id),
    db.prepare(`INSERT INTO site_payment_attempts(id,order_id,pg_order_id,pg_environment,idempotency_key,created_at,updated_at)
      SELECT ?1,id,?3,?4,?5,?6,?6 FROM site_orders WHERE id=?2`).bind(attemptId,id,pgOrderId,env.SITE_TOSS_MODE,crypto.randomUUID(),at),
    db.prepare(`UPDATE site_payment_requests SET status='ordered',version=version+1,updated_at=?2 WHERE id=?1 AND EXISTS(SELECT 1 FROM site_orders WHERE id=?3)`)
      .bind(paymentRequest.id,at,id),
  ]);
  const saved=await db.prepare('SELECT * FROM site_orders WHERE request_id=?1 AND member_id=?2').bind(paymentRequest.id,member.id).first();
  if(saved.id!==id) return error(409,'주문이 이미 생성되었습니다. 내 주문에서 확인해주세요.');
  const attempt=await db.prepare('SELECT * FROM site_payment_attempts WHERE id=?1').bind(attemptId).first();
  return siteJson({order:await orderDto(db,saved),checkout:checkoutDto(env,saved,attempt,member)}, {status:201});
}
async function retryOrder(request,env,member,id){
  const parsed=await bodyOf(request,z.object({idempotencyKey:UUID}).strict());if(parsed.response)return parsed.response;
  if(!siteTossReady(env))return error(503,'온라인 결제 서비스를 준비 중입니다.');
  const db=env.GAME_DB,order=await orderById(db,id,member.id);if(!order)return error(404,'본인의 주문을 찾을 수 없습니다.');
  const previous=await db.prepare('SELECT * FROM site_payment_attempts WHERE order_id=?1 AND idempotency_key=?2').bind(id,parsed.value.idempotencyKey).first();
  if(previous)return siteJson({order:await orderDto(db,order),checkout:previous.state==='ready'?checkoutDto(env,order,previous,member):null});
  const invoice=await db.prepare('SELECT expires_at FROM site_payment_requests WHERE id=?1').bind(order.request_id).first();
  if(!invoice||invoice.expires_at<=now())return error(410,'결제 요청 유효 기간이 지났습니다. 강사에게 새 요청을 확인해주세요.');
  if(order.approved_at||!['failed','expired'].includes(order.status))return error(409,'결제 결과를 확인 중이거나 이미 승인된 주문입니다. 다시 결제하지 마세요.');
  const count=await db.prepare('SELECT COUNT(*) AS total FROM site_payment_attempts WHERE order_id=?1').bind(id).first();
  if(count.total>=10)return error(429,'결제 시도가 많습니다. 강사에게 결제 상태를 확인해주세요.');
  const attemptId=crypto.randomUUID(),pgId=`site_${crypto.randomUUID().replace(/-/g,'')}`,at=now();
  await db.batch([db.prepare("UPDATE site_orders SET status='pending',active_attempt_id=?3,version=version+1,updated_at=?4 WHERE id=?1 AND member_id=?2 AND status IN ('failed','expired') AND approved_at IS NULL")
    .bind(id,member.id,attemptId,at),
    db.prepare(`INSERT INTO site_payment_attempts(id,order_id,pg_order_id,pg_environment,idempotency_key,created_at,updated_at)
      SELECT ?1,id,?3,?4,?5,?6,?6 FROM site_orders WHERE id=?2 AND active_attempt_id=?1 AND status='pending'`)
      .bind(attemptId,id,pgId,env.SITE_TOSS_MODE,parsed.value.idempotencyKey,at)]);
  const attempt=await db.prepare('SELECT * FROM site_payment_attempts WHERE id=?1').bind(attemptId).first();
  if(!attempt)return error(409,'주문이 변경되었습니다. 다시 확인해주세요.');
  return siteJson({order:await orderDto(db,await orderById(db,id,member.id)),checkout:checkoutDto(env,order,attempt,member)});
}
async function memberRefund(request,env,member,id) {
  const parsed=await bodyOf(request,refundSchema);if(parsed.response)return parsed.response;
  const db=env.GAME_DB,order=await orderById(db,id,member.id);
  if(!order||!order.approved_at)return error(404,'환불 가능한 본인 주문을 찾을 수 없습니다.');
  const amount=parsed.value.amount||order.amount-order.refunded_amount;
  if(amount<=0||amount>order.amount-order.refunded_amount)return error(400,'환불 요청 금액을 확인해주세요.');
  const refundId=crypto.randomUUID(),at=now(),reason=parsed.value.reason;
  const pgReason=`${reason.slice(0,145)} [웹:${refundId}]`;
  const row=await db.prepare(`INSERT INTO site_refund_requests(id,order_id,member_id,amount,reason,idempotency_key,pg_reason,created_at,updated_at)
    VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8) ON CONFLICT DO NOTHING RETURNING *`).bind(refundId,id,member.id,amount,reason,crypto.randomUUID(),pgReason,at).first();
  if(!row)return error(409,'이미 환불 요청을 확인 중입니다.');
  return siteJson({refundRequest:{id:row.id,amount:row.amount,reason:row.reason,status:row.state,requestedAt:row.created_at}},{status:201});
}
async function approveRefund(request,env,id,ctx) {
  const parsed=await bodyOf(request,refundApprovalSchema);if(parsed.response)return parsed.response;
  const input=parsed.value;
  if(!siteTossReady(env))return error(503,'온라인 환불 서비스를 준비 중입니다.');
  const db=env.GAME_DB,refund=await db.prepare('SELECT * FROM site_refund_requests WHERE id=?1').bind(id).first();
  if(!refund)return error(404,'환불 요청을 찾을 수 없습니다.');
  if(refund.state!=='pending'&&(refund.approved_amount!==input.amount||refund.approved_reason!==input.reason))return error(409,'이미 확정한 환불 금액·사유와 다릅니다. 기존 처리 결과를 확인해주세요.');
  if(refund.state==='completed')return siteJson({ok:true,order:await orderDto(db,await orderById(db,refund.order_id),true)});
  if(['failed','rejected'].includes(refund.state))return error(409,'종료된 환불 요청입니다.');
  const order=await orderById(db,refund.order_id),payment=await db.prepare('SELECT * FROM site_payments WHERE order_id=?1').bind(order.id).first();
  const attempt=payment&&await db.prepare('SELECT * FROM site_payment_attempts WHERE id=?1').bind(payment.attempt_id).first();
  if(!attempt)return error(409,'승인 원장을 먼저 확인해주세요.');
  if(input.amount>order.amount-order.refunded_amount&&refund.state==='pending')return error(409,'잔액을 초과하는 환불 요청입니다.');
  const lease=crypto.randomUUID();
  const approvedPgReason=`${input.reason.slice(0,145)} [웹:${id}]`;
  const claim=await db.prepare(`UPDATE site_refund_requests SET state='approving',lease_token=?2,lease_until=?3,updated_at=?4,
    approved_amount=?5,approved_reason=?6,approved_pg_reason=?7 WHERE id=?1 AND state='pending' RETURNING *`)
    .bind(id,lease,unix()+30,now(),input.amount,input.reason,approvedPgReason).first();
  if(!claim){
    const current=await db.prepare('SELECT * FROM site_refund_requests WHERE id=?1').bind(id).first();
    if(current.approved_amount!==input.amount||current.approved_reason!==input.reason)return error(409,'다른 환불 내용이 이미 확정되었습니다.');
    try{
      const data=await toss(env,'GET',`/v1/payments/${encodeURIComponent(payment.payment_key)}`);
      const proof=await recordSitePayment(env,data,attempt,order);
      const matching=proof.cancellations.filter(cancel=>cancel.reason===current.approved_pg_reason);
      if(matching.reduce((sum,cancel)=>sum+cancel.amount,0)===current.approved_amount){
        await db.prepare("UPDATE site_refund_requests SET state='completed',approved_at=?2,updated_at=?2,lease_token=NULL,lease_until=NULL WHERE id=?1").bind(id,now()).run();
        scheduleSync(ctx,env);return siteJson({ok:true,order:await orderDto(db,await orderById(db,order.id),true)});
      }
    }catch{/* Remain uncertain, never generate a fresh cancellation. */}
    return siteJson({ok:false,state:'unknown',message:'환불 결과를 확인 중입니다. 다시 취소하지 마세요.'},{status:202});
  }
  try{
    const data=await toss(env,'POST',`/v1/payments/${encodeURIComponent(payment.payment_key)}/cancel`,
      {cancelReason:claim.approved_pg_reason,cancelAmount:claim.approved_amount,currency:'KRW'},refund.idempotency_key);
    const proof=await recordSitePayment(env,data,attempt,order);
    if(proof.cancellations.filter(cancel=>cancel.reason===claim.approved_pg_reason).reduce((sum,cancel)=>sum+cancel.amount,0)!==claim.approved_amount)throw new PgError('pg_cancel_result_unknown');
    await db.prepare("UPDATE site_refund_requests SET state='completed',approved_at=?3,updated_at=?3,lease_token=NULL,lease_until=NULL WHERE id=?1 AND lease_token=?2").bind(id,lease,now()).run();
    scheduleSync(ctx,env);return siteJson({ok:true,order:await orderDto(db,await orderById(db,order.id),true)});
  }catch(failure){
    await db.prepare('UPDATE site_refund_requests SET state=?3,updated_at=?4,lease_token=NULL,lease_until=NULL WHERE id=?1 AND lease_token=?2')
      .bind(id,lease,failure.definitive?'failed':'unknown',now()).run();
    return siteJson({ok:false,state:failure.definitive?'failed':'unknown',message:'환불 결과를 확인해주세요.'},{status:failure.definitive?502:202});
  }
}
async function issueRequest(request,env) {
  const parsed=await bodyOf(request,requestSchema);if(parsed.response)return parsed.response;
  const input=parsed.value,db=env.GAME_DB;
  const member=await db.prepare("SELECT * FROM site_members WHERE id=?1 AND status='active'").bind(input.memberId).first();
  const target=await db.prepare('SELECT * FROM site_targets WHERE id=?1 AND active=1').bind(input.targetId).first();
  if(!member||!target)return error(404,'회원과 수업·특강 대상을 확인해주세요.');
  const link=await db.prepare('SELECT * FROM site_student_links WHERE member_id=?1').bind(member.id).first();
  if(target.student_required&&!link)return error(409,'정규 수업은 확인된 학생 연결이 필요합니다.');
  if(Date.parse(input.expiresAt)<=Date.now())return error(400,'결제 요청 유효 기간을 확인해주세요.');
  const rate=input.unitPriceSnapshot??target.unit_price;
  if(target.time_ledger_mode==='hours'&&(input.hours<=0||rate<=0||Math.round(input.hours*rate*(1-input.discountRateSnapshot/100))!==input.amount))return error(400,'시간·단가·할인과 결제 총액이 일치하지 않습니다.');
  if(target.time_ledger_mode==='none'&&input.hours!==0)return error(400,'시간 장부를 사용하지 않는 대상의 시간은 0이어야 합니다.');
  const snapshot={targetId:target.id,targetName:target.name,experienceType:target.experience_type,studentRequired:!!target.student_required,
    classTypeId:target.class_type_id,studentId:link?.student_id||null,timeLedgerMode:target.time_ledger_mode,
    billingPeriod:input.billingPeriod,hours:input.hours,unitPriceSnapshot:rate,discountRateSnapshot:input.discountRateSnapshot,
    discountEventId:input.discountEventId,customerName:input.customerName||member.name,refundPolicy:input.refundPolicy,termsVersion:input.termsVersion};
  try{await validateSiteLedgerReferences(env,snapshot);}catch{return error(409,'학생·수업 종류·할인의 Notion 연결과 접근 권한을 확인해주세요.');}
  const at=now();
  const row=await db.prepare(`INSERT INTO site_payment_requests(id,member_id,target_id,billing_key,billing_period,snapshot,amount,terms_version,expires_at,created_at,updated_at)
    VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10) ON CONFLICT(billing_key) DO NOTHING RETURNING *`)
    .bind(crypto.randomUUID(),member.id,target.id,input.billingKey,input.billingPeriod,JSON.stringify(snapshot),input.amount,input.termsVersion,new Date(input.expiresAt).toISOString(),at).first();
  if(!row)return error(409,'이미 발급한 청구입니다. 기존 결제 요청을 확인해주세요.');
  return siteJson({request:requestDto({...row,member_code:member.member_code},true)},{status:201});
}
async function adminRoutes(request,env,url,ctx) {
  const db=env.GAME_DB,path=url.pathname.slice('/api/site/admin'.length),method=request.method;
  if(path==='/members'&&method==='GET'){
    const query=(url.searchParams.get('query')||'').trim(),code=url.searchParams.get('code');
    if((!query&&!code)||query.length>120||(code&&code.length>80)||(/[\x00-\x1f]/.test(query)))return error(400,'이메일이나 이름으로 계정을 검색해주세요.');
    let rows;
    if(query){
      if(query.length<2)return error(400,'검색어를 두 글자 이상 입력해주세요.');
      const escaped=query.replace(/[\\%_]/g,character=>'\\'+character);
      rows=(await db.prepare("SELECT id,member_code,name,nickname,email,phone,status FROM site_members WHERE LOWER(email)=LOWER(?1) OR name LIKE ?2 ESCAPE '\\' OR nickname LIKE ?2 ESCAPE '\\' ORDER BY created_at DESC LIMIT 20").bind(query,escaped+'%').all()).results||[];
    }else{
      const member=await db.prepare('SELECT id,member_code,name,nickname,email,phone,status FROM site_members WHERE member_code=?1').bind(code).first();rows=member?[member]:[];
    }
    const members=[];
    for(const member of rows){
      const link=await db.prepare('SELECT student_id,verified_at FROM site_student_links WHERE member_id=?1').bind(member.id).first();
      members.push({id:member.id,memberCode:member.member_code,name:member.name,nickname:member.nickname,email:member.email,phone:member.phone,status:member.status,
        studentLink:link?{studentId:link.student_id,verifiedAt:link.verified_at}:null});
    }
    return siteJson({members});
  }
  const studentLink=path.match(/^\/members\/([^/]+)\/student-link$/);
  if(studentLink&&method==='POST'){
    const parsed=await bodyOf(request,z.object({studentId:UUID}).strict());if(parsed.response)return parsed.response;
    if(!UUID.safeParse(studentLink[1]).success)return error(404,'회원을 찾을 수 없습니다.');
    const member=await db.prepare("SELECT id FROM site_members WHERE id=?1 AND status='active'").bind(studentLink[1]).first();if(!member)return error(404,'회원을 찾을 수 없습니다.');
    try{await verifySiteNotionPage(env,parsed.value.studentId,SITE_LEDGER_DATABASES.student);}catch{return error(409,'학생 DB 연결을 확인해주세요.');}
    try { await linkSiteStudentMember(env,member.id,parsed.value.studentId); }
    catch(error) { return siteStudentMemberErrorResponse(error); }
    return siteJson({ok:true});
  }
  if(path==='/targets'){
    if(method==='GET'){const result=await db.prepare('SELECT * FROM site_targets ORDER BY created_at DESC LIMIT 200').all();return siteJson({targets:result.results.map(row=>targetDto(row,true))});}
    if(method==='POST'){const parsed=await bodyOf(request,targetSchema);if(parsed.response)return parsed.response;const input=parsed.value;
      if(input.timeLedgerMode==='hours'&&(input.unitPrice<=0||!input.studentRequired))return error(400,'시간 장부 대상은 학생 연결과 양수 단가가 필요합니다.');
      try{await verifySiteNotionPage(env,input.classTypeId,SITE_LEDGER_DATABASES.classType);}catch{return error(409,'Notion 수업 종류를 확인해주세요.');}
      const at=now(),row=await db.prepare(`INSERT INTO site_targets(id,name,experience_type,class_type_id,student_required,time_ledger_mode,unit_price,active,created_at,updated_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9) RETURNING *`).bind(crypto.randomUUID(),input.name,input.experienceType,input.classTypeId,input.studentRequired?1:0,input.timeLedgerMode,input.unitPrice,input.active?1:0,at).first();
      return siteJson({target:targetDto(row,true)},{status:201});}
  }
  if(path==='/payment-requests'){
    if(method==='POST')return issueRequest(request,env);
    if(method==='GET'){const rows=await db.prepare('SELECT r.*,m.member_code FROM site_payment_requests r JOIN site_members m ON m.id=r.member_id ORDER BY r.created_at DESC LIMIT 100').all();return siteJson({requests:rows.results.map(row=>requestDto(row,true))});}
  }
  const cancel=path.match(/^\/payment-requests\/([^/]+)\/cancel$/);
  if(cancel&&method==='POST'){
    const parsed=await bodyOf(request,z.object({version:z.number().int().positive()}).strict());if(parsed.response)return parsed.response;
    const row=await db.prepare("UPDATE site_payment_requests SET status='cancelled',version=version+1,updated_at=?3 WHERE id=?1 AND version=?2 AND status='open' RETURNING *")
      .bind(cancel[1],parsed.value.version,now()).first();return row?siteJson({request:requestDto(row,true)}):error(409,'이미 사용되었거나 변경된 결제 요청입니다.');
  }
  if(path==='/orders'&&method==='GET'){
    const rows=await db.prepare('SELECT o.*,m.member_code FROM site_orders o JOIN site_members m ON m.id=o.member_id ORDER BY o.created_at DESC LIMIT 100').all();
    return siteJson({orders:await Promise.all(rows.results.map(row=>orderDto(db,row,true))),nextCursor:null});
  }
  const approve=path.match(/^\/refund-requests\/([^/]+)\/approve$/);
  if(approve&&method==='POST')return approveRefund(request,env,approve[1],ctx);
  if(path==='/notion-sync'&&method==='GET'){
    const rows=await db.prepare('SELECT * FROM site_notion_outbox ORDER BY updated_at DESC LIMIT 100').all();return siteJson({jobs:rows.results.map(row=>({orderItemId:row.order_item_id,state:row.state,reasonCode:row.reason_code,notionPageId:row.notion_page_id,desiredVersion:row.desired_version,appliedVersion:row.applied_version,updatedAt:row.updated_at}))});
  }
  if(path==='/notion-sync/run'&&method==='POST')return siteJson(await runSiteNotionSync(env));
  const reconcile=path.match(/^\/notion-sync\/([^/]+)\/reconcile$/);
  if(reconcile&&method==='POST'){
    const parsed=await bodyOf(request,z.object({notionPageId:UUID.optional()}).strict());if(parsed.response)return parsed.response;
    const result=await reconcileSiteNotionItem(env,reconcile[1],parsed.value.notionPageId);return result.error?error(result.status,result.error):siteJson(result.result);
  }
  return error(404,'요청한 항목을 찾을 수 없습니다.');
}
async function webhook(request,env,ctx) {
  if(!siteTossReady(env))return error(503,'결제 연결을 준비 중입니다.');
  const data=await request.json().catch(()=>null);
  if(!data||data.eventType!=='PAYMENT_STATUS_CHANGED'||!data.data||typeof data.data.orderId!=='string')return error(400,'결제 알림을 확인해주세요.');
  const attempt=await attemptByPgId(env.GAME_DB,data.data.orderId);
  if(!attempt)return siteJson({ok:true});
  const paymentKey=typeof data.data.paymentKey==='string'&&data.data.paymentKey.length<=200?data.data.paymentKey:null;
  if(!paymentKey||(attempt.payment_key&&paymentKey!==attempt.payment_key))return error(400,'결제 알림 연결이 올바르지 않습니다.');
  const payloadHash=await hash(env.SITE_SESSION_SECRET,JSON.stringify({eventType:data.eventType,orderId:attempt.pg_order_id,paymentKey,createdAt:data.createdAt}));
  const eventId=payloadHash; // Unauthenticated transmission headers cannot poison trusted event IDs.
  await env.GAME_DB.prepare(`INSERT INTO site_pg_webhook_inbox(id,event_type,pg_order_id,payment_key,payload_hash,created_at,updated_at)
    VALUES(?1,?2,?3,?4,?1,?5,?5) ON CONFLICT(id) DO NOTHING`).bind(eventId,data.eventType,attempt.pg_order_id,paymentKey,now()).run();
  try{
    const order=await orderById(env.GAME_DB,attempt.order_id),verified=await toss(env,'GET',`/v1/payments/${encodeURIComponent(paymentKey)}`);
    if(!await recordClosedAttempt(env,verified,attempt,order))await recordSitePayment(env,verified,attempt,order);
    await env.GAME_DB.prepare("UPDATE site_pg_webhook_inbox SET state='processed',updated_at=?2 WHERE id=?1").bind(eventId,now()).run();
    scheduleSync(ctx,env);return siteJson({ok:true});
  }catch{return error(503,'결제 상태를 다시 대조해야 합니다.');}
}
export async function handleSiteCommerceRoutes(request,env,ctx,{authorizeTeacher}={}) {
  const url=new URL(request.url),path=url.pathname,db=env.GAME_DB;
  if(!path.startsWith('/api/site/'))return null;
  if(!db||!env.SITE_SESSION_SECRET)return error(503,'홈페이지 서비스를 준비 중입니다.');
  try{
    const ip=request.headers.get('CF-Connecting-IP')||'0.0.0.0';
    if(!(await rateLimitCheck(env,`site-commerce:${ip}`,120,60)))return siteJson({error:'요청이 너무 많습니다. 잠시 후 다시 시도해주세요.'},{status:429,headers:{'Retry-After':'60'}});
    if(path.startsWith('/api/site/admin/')){
      const denial=await authorizeTeacher(request,env,{});if(denial)return denial;
      return await adminRoutes(request,env,url,ctx);
    }
    if(path==='/api/site/webhooks/toss'&&request.method==='POST')return await webhook(request,env,ctx);
    if(path==='/api/site/targets'&&request.method==='GET'){
      const rows=await db.prepare('SELECT * FROM site_targets WHERE active=1 ORDER BY created_at LIMIT 200').all();return siteJson({targets:rows.results.map(row=>targetDto(row,false))});
    }
    const summary=path.match(/^\/api\/site\/targets\/([^/]+)\/review-summary$/);
    if(summary&&request.method==='GET'){
      const proofEnvironment=env.SITE_ENVIRONMENT==='development'&&env.SITE_TOSS_MODE==='test'?'test':'live';
      const rows=await db.prepare(`SELECT CASE WHEN p.pg_environment=?2 THEN 'purchase' ELSE 'general' END AS kind,
        r.published_rating AS rating,COUNT(*) AS total FROM reviews r LEFT JOIN site_order_items oi ON oi.id=r.published_purchase_item_id
        LEFT JOIN site_payments p ON p.order_id=oi.order_id WHERE r.status='published' AND r.published_target_id=?1 AND r.published_rating IS NOT NULL
        GROUP BY kind,r.published_rating`).bind(summary[1],proofEnvironment).all();
      const value={targetId:summary[1]};for(const kind of ['purchase','general']){const distribution={1:0,2:0,3:0,4:0,5:0};for(const row of rows.results.filter(row=>row.kind===kind))distribution[row.rating]=row.total;
        const count=Object.values(distribution).reduce((a,b)=>a+b,0),sum=Object.entries(distribution).reduce((a,[rating,count])=>a+Number(rating)*count,0);value[kind]={count,average:count?Math.round(sum/count*10)/10:null,distribution};}
      return siteJson(value);
    }
    const authorized=await authorizeSiteMember(request,env,{requireCsrf:!['GET','HEAD'].includes(request.method)});
    if(authorized instanceof Response)return authorized;
    const member=authorized.member;
    if(path==='/api/site/payment-requests'&&request.method==='GET'){
      const rows=await db.prepare('SELECT * FROM site_payment_requests WHERE member_id=?1 ORDER BY created_at DESC LIMIT 100').bind(member.id).all();return siteJson({requests:rows.results.map(row=>requestDto(row))});
    }
    const detail=path.match(/^\/api\/site\/payment-requests\/([^/]+)$/);
    if(detail&&request.method==='GET'){
      const row=await db.prepare('SELECT * FROM site_payment_requests WHERE id=?1 AND member_id=?2').bind(detail[1],member.id).first();return row?siteJson({request:requestDto(row)}):error(404,'본인의 결제 요청을 찾을 수 없습니다.');
    }
    if(path==='/api/site/orders'){
      if(request.method==='POST')return await createOrder(request,env,member);
      if(request.method==='GET'){await expireReadySiteAttempts(env);const rows=await db.prepare('SELECT * FROM site_orders WHERE member_id=?1 ORDER BY created_at DESC LIMIT 100').bind(member.id).all();return siteJson({orders:await Promise.all(rows.results.map(row=>orderDto(db,row))),nextCursor:null});}
    }
    const orderPath=path.match(/^\/api\/site\/orders\/([^/]+)$/);
    if(orderPath&&request.method==='GET'){
      let row=await memberOrderByReference(db,orderPath[1],member.id);if(!row)return error(404,'본인의 주문을 찾을 수 없습니다.');
      await expireReadySiteAttempts(env,row.id);row=await orderById(db,row.id,member.id);
      if(row.status==='confirming'){
        const attempt=await db.prepare('SELECT * FROM site_payment_attempts WHERE id=?1').bind(row.active_attempt_id).first();
        if(attempt.payment_key&&siteTossReady(env)){try{const data=await toss(env,'GET',`/v1/payments/${encodeURIComponent(attempt.payment_key)}`);
          if(!await recordClosedAttempt(env,data,attempt,row))await recordSitePayment(env,data,attempt,row);
          scheduleSync(ctx,env);row=await orderById(db,row.id,member.id);}catch{/* Still confirming. */}}
      }
      const checkout=await resumeCheckout(env,db,row,member),dto=await orderDto(db,row);
      dto.canResume=!!checkout;
      return siteJson({order:dto,checkout});
    }
    const retry=path.match(/^\/api\/site\/orders\/([^/]+)\/retry$/);
    if(retry&&request.method==='POST')return await retryOrder(request,env,member,retry[1]);
    if(path==='/api/site/payments/confirm'&&request.method==='POST')return await confirmPayment(request,env,member,ctx);
    const refund=path.match(/^\/api\/site\/orders\/([^/]+)\/refund-request$/);
    if(refund&&request.method==='POST')return await memberRefund(request,env,member,refund[1]);
    if(path==='/api/site/review-eligibility'&&request.method==='GET'){
      const targetId=url.searchParams.get('targetId');if(!UUID.safeParse(targetId).success)return error(400,'수업·특강 대상을 확인해주세요.');
      const target=await db.prepare('SELECT id FROM site_targets WHERE id=?1 AND active=1').bind(targetId).first();if(!target)return error(404,'수업·특강 대상을 찾을 수 없습니다.');
      const proofEnvironment=env.SITE_ENVIRONMENT==='development'&&env.SITE_TOSS_MODE==='test'?'test':'live';
      const purchase=await db.prepare(`SELECT oi.id FROM site_order_items oi JOIN site_orders o ON o.id=oi.order_id JOIN site_payments p ON p.order_id=o.id
        WHERE o.member_id=?1 AND oi.target_id=?2 AND p.pg_environment=?3 LIMIT 1`).bind(member.id,targetId,proofEnvironment).first();
      const review=await db.prepare("SELECT id FROM reviews WHERE member_id=?1 AND latest_target_id=?2 AND status!='deleted'").bind(member.id,targetId).first();
      return siteJson({targetId,purchaseConfirmed:!!purchase,canWrite:!review,existingReviewId:review?.id||null});
    }
    return null;
  }catch{
    console.error('[site-commerce] service unavailable');
    return error(503,'서비스를 잠시 사용할 수 없습니다. 다시 시도해주세요.');
  }
}
