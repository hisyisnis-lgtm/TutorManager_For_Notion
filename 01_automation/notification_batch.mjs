const DELIVERY_KEY = /^[a-f0-9]{64}$/;
const KNOWN_STATES = new Set(['pending', 'accepted', 'failed', 'unknown']);

/**
 * 수신자별 접수 이력을 보존하며 명확히 실패한 항목만 재시도한다.
 * pending/unknown은 이미 접수되었을 수 있으므로 자동으로 다시 보내지 않는다.
 * ledger.record는 동기적으로 기록을 완료하거나 예외를 던져야 한다.
 */
export async function sendNotificationBatch({ notifications, ledger, sendKakao } = {}) {
  if (!Array.isArray(notifications)
    || !notifications.every(item => item && typeof item === 'object' && !Array.isArray(item)
      && typeof item.key === 'string' && DELIVERY_KEY.test(item.key))
    || typeof ledger?.get !== 'function' || typeof ledger?.record !== 'function'
    || typeof sendKakao !== 'function') {
    throw new Error('알림 발송 목록 또는 이력 설정이 올바르지 않습니다.');
  }

  const counts = { sent: 0, alreadyAccepted: 0, failed: 0, unknown: 0 };
  const seen = new Set();
  for (const item of notifications) {
    // 같은 명단에 중복 관계가 있어도 하나의 발송 키는 한 번만 처리·집계한다.
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    const previous = ledger.get(item.key);
    if (previous !== undefined && !KNOWN_STATES.has(previous)) {
      throw new Error('알림 발송 이력을 확인할 수 없어 발송을 중단했습니다.');
    }
    if (previous === 'accepted') {
      counts.alreadyAccepted++;
      continue;
    }
    if (previous === 'pending' || previous === 'unknown') {
      counts.unknown++;
      continue;
    }

    // 기록에 실패하면 POST하지 않는다. 기록 예외를 발송 실패로 바꾸지 않는다.
    ledger.record(item.key, 'pending');
    let state = 'unknown';
    try {
      const result = await sendKakao(item.to, item.templateId, item.variables, item.buttons);
      if (result?.ok === true && result.state === 'accepted') state = 'accepted';
    } catch (error) {
      if (error?.result?.state === 'failed') state = 'failed';
    }
    // 접수 이후 기록 실패도 그대로 중단한다. accepted를 failed로 덮지 않는다.
    ledger.record(item.key, state);
    if (state === 'accepted') counts.sent++;
    else counts[state]++;
  }

  console.log(`[kakao] 배치 결과: 접수 ${counts.sent}, 기존 접수 ${counts.alreadyAccepted}, 실패 ${counts.failed}, 결과 불명 ${counts.unknown}`);
  if (counts.failed > 0 || counts.unknown > 0) {
    const error = new Error('일부 알림이 접수되지 않았거나 접수 결과를 확인할 수 없습니다.');
    error.counts = counts;
    throw error;
  }
  return counts;
}
