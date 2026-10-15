import { reconcileSiteShopPayments } from './siteShop.js';
import { reconcileSitePayments } from './siteCommerce.js';
import { runSiteNotionSync } from './siteNotionSync.js';

const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const checkedStates = ['pending', 'processing', 'synced', 'unknown', 'failed', 'needs_setup'];
const jobSummary = result => ({ ok: result?.unavailable !== true, processed: count(result?.processed),
  ...(result?.failed == null ? {} : { failed: count(result.failed) }),
  ...(result?.configurationRequired == null ? {} : { configurationRequired: count(result.configurationRequired) }),
  ...(Array.isArray(result?.results) ? { states: Object.fromEntries(checkedStates.map(state =>
    [state, result.results.filter(item => item?.state === state).length])) } : {}) });

async function overdueCounts(env) {
  const db = env.GAME_DB;
  if (!db) throw new Error('database_unavailable');
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const queries = {
    shopPayments: `SELECT COUNT(*) AS count FROM site_shop_orders WHERE created_at<?1
      AND (status='confirming' OR (status='pending' AND payssam_bill_state IN ('creating','unknown','destroying')))
      AND (payssam_create_started_at IS NOT NULL OR tid IS NOT NULL OR auth_tid IS NOT NULL)`,
    shopRefunds: `SELECT COUNT(*) AS count FROM site_shop_refunds WHERE created_at<?1 AND state IN ('approving','unknown')`,
    shopWebhooks: `SELECT COUNT(*) AS count FROM site_shop_webhook_inbox WHERE created_at<?1 AND state='pending'`,
    legacyPayments: `SELECT COUNT(*) AS count FROM site_orders WHERE created_at<?1 AND status='confirming'`,
    legacyRefunds: `SELECT COUNT(*) AS count FROM site_refund_requests WHERE created_at<?1 AND state IN ('approving','unknown')`,
    legacyWebhooks: `SELECT COUNT(*) AS count FROM site_pg_webhook_inbox WHERE created_at<?1 AND state='pending'`,
    notionDelayed: `SELECT COUNT(*) AS count FROM site_notion_outbox WHERE created_at<?1 AND state IN ('pending','processing')`,
  };
  const backlog = {};
  for (const [key, sql] of Object.entries(queries)) backlog[key] = count((await db.prepare(sql).bind(cutoff).first())?.count);
  for (const state of ['unknown', 'failed', 'needs_setup']) {
    backlog[{ unknown: 'notionUnknown', failed: 'notionFailed', needs_setup: 'notionNeedsSetup' }[state]] =
      count((await db.prepare('SELECT COUNT(*) AS count FROM site_notion_outbox WHERE state=?1').bind(state).first())?.count);
  }
  return backlog;
}

// The scheduler owns waitUntil and the existing alert sender. This helper never
// changes alert destinations and never includes provider errors or member data.
export async function runSiteRecoveryJobs(env, { includeRecentPaid = false, notify } = {}) {
  const jobs = {};
  const execute = async (key, callback) => {
    try { jobs[key] = jobSummary(await callback()); }
    catch { jobs[key] = { ok: false, processed: 0 }; }
  };
  await Promise.all([
    execute('shopPayments', () => reconcileSiteShopPayments(env, { includeRecentPaid })),
    execute('legacyPayments', () => reconcileSitePayments(env)),
  ]);
  // Ledger synchronization still runs if either reconciliation failed; it also
  // sees outbox work created by a successful payment check in this invocation.
  await execute('notionSync', () => runSiteNotionSync(env));
  let backlog = null;
  try { backlog = await overdueCounts(env); jobs.backlog = { ok: true }; }
  catch { jobs.backlog = { ok: false }; }

  const alerts = [];
  const names = { shopPayments: '상품 결제 확인', legacyPayments: '기존 결제 확인', notionSync: '장부 반영', backlog: '처리 대기 감시' };
  const failed = Object.entries(jobs).filter(([, result]) => !result.ok).map(([key]) => names[key]);
  if (failed.length) alerts.push({ level: 'warn', title: '통합웹 복구 작업 확인 필요',
    message: `${failed.join(' · ')} 작업을 완료하지 못했습니다. Worker 실행 기록과 관리자 설정을 확인해주세요.`,
    dedupKey: 'site-recovery:job-failure', ttlSeconds: 3600, tags: ['warning'] });
  if (backlog && Object.values(backlog).some(value => value > 0)) {
    const labels = { shopPayments: '상품 결제', shopRefunds: '상품 환불', shopWebhooks: '상품 결제 알림',
      legacyPayments: '기존 결제', legacyRefunds: '기존 환불', legacyWebhooks: '기존 결제 알림',
      notionDelayed: '장부 반영 지연', notionUnknown: '장부 결과 확인', notionFailed: '장부 오류', notionNeedsSetup: '장부 설정' };
    alerts.push({ level: 'warn', title: '통합웹 처리 대기 확인 필요',
      message: Object.entries(backlog).filter(([, value]) => value > 0).map(([key, value]) => `${labels[key]} ${value}건`).join(' · ')
        + '\n결제·환불·알림은 15분 이상 미확정인 건입니다. 관리자 처리 업무와 장부 설정을 확인해주세요. 중복 결제나 환불을 실행하지 마세요.',
      dedupKey: 'site-recovery:backlog', ttlSeconds: 3600, tags: ['warning'] });
  }
  let notified = 0;
  jobs.notification = { ok: true, skipped: typeof notify !== 'function' || !alerts.length };
  if (typeof notify === 'function') {
    for (const alert of alerts) {
      try {
        const delivery = await notify(alert);
        if (delivery?.ok === false) jobs.notification.ok = false;
        else notified++;
      } catch { jobs.notification.ok = false; }
    }
  }
  return { ok: Object.values(jobs).every(result => result.ok), jobs, backlog, notified };
}
