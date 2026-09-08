// 개인정보는 소유한 비공개 토픽에만, 공개/확인 불가 토픽에는 고정 안내만 보낸다.
// /v1/account에는 토큰·이메일 등이 있으므로 응답과 원본 예외는 절대 로그/반환하지 않는다.
import { pathToFileURL } from 'node:url';
import { publicNtfyAlert } from '../worker/lib/ntfyPrivacy.js';

const BASE = 'https://ntfy.sh';
const TOPIC_ALIAS = /^NTFY_TOPIC(?:_(?:CRITICAL|WARN|DIGEST|OPS))?$/;
const WORKFLOW_KINDS = Object.freeze({
  'pwa-build-failed': { title: 'PWA 빌드 실패', level: 'critical' },
  'worker-build-failed': { title: 'Worker 빌드 실패', level: 'critical' },
  'archive-complete': { title: '월간 아카이브 완료', level: 'digest' },
  'archive-failed': { title: '월간 아카이브 실패', level: 'critical' },
  'payments-backup-complete': { title: '결제 백업 완료', level: 'digest' },
  'payments-backup-failed': { title: '결제 백업 실패', level: 'critical' },
  'weekly-backup-complete': { title: '주간 백업 완료', level: 'digest' },
  'weekly-backup-failed': { title: '주간 백업 실패', level: 'critical' },
});

function validConfiguration(topic, token) {
  return typeof topic === 'string' && /^[-_A-Za-z0-9]{1,64}$/.test(topic)
    && typeof token === 'string' && Boolean(token.trim());
}

// 외부 제목/본문/actions/첨부/URL/tags를 복사하거나 일부 잘라 사용하는 것도 금지한다.
export function publicNtfyPayload(topic, level, workflowKind, originalTitle) {
  const template = publicNtfyAlert(level, originalTitle);
  const workflow = Object.hasOwn(WORKFLOW_KINDS, workflowKind) ? WORKFLOW_KINDS[workflowKind] : null;
  return { topic, ...template, title: workflow?.title || template.title };
}

export async function verifyPrivateNtfyTopic({ topic, token, fetchImpl = fetch } = {}) {
  if (!validConfiguration(topic, token)) return { ok: false, reason: 'ntfy_not_configured' };
  try {
    const response = await fetchImpl(`${BASE}/v1/account`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { ok: false, reason: 'ntfy_account_unavailable' };
    }
    const account = await response.json();
    const owned = Array.isArray(account?.reservations) ? account.reservations.filter(entry => entry?.topic === topic) : [];
    const ownedAndPrivate = ['user', 'admin'].includes(account?.role)
      && typeof account.username === 'string' && account.username && account.username !== '*'
      && owned.length === 1 && owned[0].everyone === 'deny-all';
    return ownedAndPrivate ? { ok: true } : { ok: false, reason: 'ntfy_topic_not_private' };
  } catch {
    return { ok: false, reason: 'ntfy_privacy_check_failed' };
  }
}

export async function publishNtfySafely({ token, payload, level = 'info', workflowKind, fetchImpl = fetch } = {}) {
  if (!validConfiguration(payload?.topic, token)) return { ok: false, reason: 'ntfy_not_configured' };
  const privacy = await verifyPrivateNtfyTopic({ topic: payload?.topic, token, fetchImpl });
  const outgoing = privacy.ok ? payload : publicNtfyPayload(payload.topic, level, workflowKind, payload.title);
  try {
    const response = await fetchImpl(BASE, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(outgoing),
    });
    await response.body?.cancel().catch(() => {});
    return response.ok ? { ok: true } : { ok: false, reason: 'ntfy_publish_failed' };
  } catch {
    return { ok: false, reason: 'ntfy_publish_failed' };
  }
}

export async function checkNtfyTopicAlias(alias, { env = process.env, fetchImpl = fetch } = {}) {
  if (typeof alias !== 'string' || !TOPIC_ALIAS.test(alias)) return { ok: false, reason: 'ntfy_invalid_alias' };
  return verifyPrivateNtfyTopic({ topic: env[alias], token: env.NTFY_TOKEN, fetchImpl });
}

export async function sendWorkflowNtfy(alias, kind, { env = process.env, fetchImpl = fetch } = {}) {
  if (typeof alias !== 'string' || !TOPIC_ALIAS.test(alias) || !Object.hasOwn(WORKFLOW_KINDS, kind)) {
    return { ok: false, reason: 'ntfy_invalid_alias' };
  }
  const { level } = WORKFLOW_KINDS[kind];
  return publishNtfySafely({
    token: env.NTFY_TOKEN, payload: publicNtfyPayload(env[alias], level, kind),
    level, workflowKind: kind, fetchImpl,
  });
}

// Workflow는 토픽 환경변수 별칭과 고정 종류만 전달한다. 동적 원문은 받지 않는다.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await sendWorkflowNtfy(process.argv[2], process.argv[3]);
  if (!result.ok) {
    console.error('[ntfy] 알림을 전송할 수 없습니다. 설정 또는 연결을 확인해주세요.');
  }
}
