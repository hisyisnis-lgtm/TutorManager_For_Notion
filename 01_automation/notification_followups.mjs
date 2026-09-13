import { createHmac } from 'node:crypto';

const DOMAIN = 'tutor-notification-followup/v1';
const WORKFLOWS = { 'notify-student-tomorrow.yml': 'student-tomorrow', 'notify-consult-tomorrow.yml': 'consult-tomorrow' };

// Outcome reporting never sends a notification again. Failure is visible in the
// Actions log; the existing signed delivery ledger remains the retry authority.
async function publish(event, secret, { env, fetchImpl, log }) {
  const endpoint = env.NOTIFICATION_FOLLOWUP_URL;
  if (!endpoint) { log('[notification-followups] 연결 주소 미설정: Actions 발송 이력을 확인해 주세요.'); return { ok: false, reason: 'not_configured' }; }
  let url;
  try { url = new URL(endpoint); } catch { return { ok: false, reason: 'invalid_url' }; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/notification-followups/ingest' || !secret) {
    log('[notification-followups] 연결 설정 오류'); return { ok: false, reason: 'invalid_configuration' };
  }
  const body = JSON.stringify(event), timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret).update(`${DOMAIN}\n${timestamp}\n${body}`).digest('hex');
  try {
    const response = await fetchImpl(url.href, { method: 'POST', body, redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json', 'X-Notification-Timestamp': timestamp, 'X-Notification-Signature': signature } });
    await response.body?.cancel().catch(() => {});
    if (response.status !== 200) throw new Error('Follow-up rejected');
    return { ok: true };
  } catch {
    log('[notification-followups] 결과 보관 실패: 원래 발송을 반복하지 않고 Actions 이력을 유지합니다.');
    return { ok: false, reason: 'unavailable' };
  }
}

export async function reportNotificationBatch(workflow, counts, { env = process.env, fetchImpl = fetch, log = console.warn } = {}) {
  const kind = WORKFLOWS[workflow], referenceId = env.GITHUB_RUN_ID, attempt = env.GITHUB_RUN_ATTEMPT;
  const secret = env.SOLAPI_API_SECRET;
  if (!kind || !/^\d{1,20}$/.test(referenceId || '') || !/^[1-9]\d{0,4}$/.test(attempt || '') || !secret
    || !counts || !['sent', 'alreadyAccepted', 'failed', 'unknown'].every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0 && counts[key] <= 100000)) {
    log('[notification-followups] 배치 결과 연결 설정 오류'); return { ok: false, reason: 'invalid_configuration' };
  }
  const id = createHmac('sha256', secret).update(`notification-followup-id/v1\n${kind}\n${referenceId}\n${attempt}`).digest('hex');
  const safeCounts = Object.fromEntries(['sent', 'alreadyAccepted', 'failed', 'unknown'].map(key => [key, counts[key]]));
  return publish({ id, kind, referenceId, state: counts.unknown > 0 ? 'unknown' : counts.failed > 0 ? 'failed' : 'accepted', reason: 'batch_result', counts: safeCounts }, secret, { env, fetchImpl, log });
}

export async function reportNotificationRelay(followup, state, { env = process.env, fetchImpl = fetch, log = console.warn } = {}) {
  if (!followup) return { ok: false, reason: 'legacy_payload' };
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (!uuid.test(followup.id || '') || !['consult-relay', 'homework-submit'].includes(followup.kind)
    || (followup.referenceId != null && !uuid.test(followup.referenceId)) || !['accepted', 'failed', 'unknown'].includes(state)) {
    log('[notification-followups] 릴레이 결과 연결 형식 오류'); return { ok: false, reason: 'invalid_event' };
  }
  return publish({ id: followup.id, kind: followup.kind, referenceId: followup.referenceId ?? null, state,
    reason: state === 'accepted' ? 'ntfy_accepted' : state === 'failed' ? 'ntfy_publish_failed' : 'ntfy_publish_unknown' }, env.NTFY_TOKEN, { env, fetchImpl, log });
}
