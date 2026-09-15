const DELIVERY_KEY = /^[a-f0-9]{64}$/;
const KNOWN_STATES = new Set(['pending', 'accepted', 'failed', 'unknown']);
const GROUP = /^G4V[A-Za-z0-9]{20,40}$/;

/**
 * 수신자별 접수 이력을 보존하며 명확히 실패한 항목만 재시도한다.
 * 기존 단건 pending/unknown은 이미 접수되었을 수 있으므로 다시 보내지 않는다.
 * 추적 발송은 메시지를 추가하기 전에 그룹을 저장하고 같은 그룹만 재개한다.
 * ledger.record/recordGroup은 동기적으로 기록을 완료하거나 예외를 던져야 한다.
 */
export async function sendNotificationBatch({ notifications, ledger, sendKakao, sendTracked, onResult } = {}) {
  const tracked = typeof sendTracked === 'function';
  if (!Array.isArray(notifications)
    || !notifications.every(item => item && typeof item === 'object' && !Array.isArray(item)
      && typeof item.key === 'string' && DELIVERY_KEY.test(item.key))
    || typeof ledger?.get !== 'function' || typeof ledger?.record !== 'function'
    || (sendTracked !== undefined && !tracked)
    || (tracked ? typeof ledger?.getGroup !== 'function' || typeof ledger?.recordGroup !== 'function'
      : typeof sendKakao !== 'function')) {
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
    const groupId = tracked ? ledger.getGroup(item.key) : undefined;
    if (groupId !== undefined && groupId !== null && (typeof groupId !== 'string' || !GROUP.test(groupId))) {
      throw new Error('알림 발송 이력을 확인할 수 없어 발송을 중단했습니다.');
    }
    if ((previous === 'pending' || previous === 'unknown') && (!tracked || groupId === undefined)) {
      counts.unknown++;
      continue;
    }
    // 복원된 빈 그룹 뒤에 종료 기록이 없으면, 저장된 ID가 로그 꼬리와 함께
    // 유실됐을 수 있다. 종료가 확인된 unknown/failed만 새 빈 그룹을 만들 수 있다.
    if (tracked && groupId === null && (previous === undefined || previous === 'pending')) {
      counts.unknown++;
      continue;
    }

    // 기록에 실패하면 POST하지 않는다. 기록 예외를 발송 실패로 바꾸지 않는다.
    if (tracked && groupId === undefined) ledger.recordGroup(item.key, null);
    ledger.record(item.key, 'pending');
    const trackedGroupId = tracked ? ledger.getGroup(item.key) : undefined;
    let state = 'unknown';
    let groupWriteFailed = false;
    let groupWriteError;
    try {
      const result = tracked ? await sendTracked(item, {
        groupId: trackedGroupId,
        saveGroup: id => {
          try { return ledger.recordGroup(item.key, id); }
          catch (error) { groupWriteFailed = true; groupWriteError = error; throw error; }
        },
      }) : await sendKakao(item.to, item.templateId, item.variables, item.buttons);
      if (result?.ok === true && result.state === 'accepted') state = 'accepted';
    } catch (error) {
      if (groupWriteFailed) throw groupWriteError;
      if (error?.result?.state === 'failed') state = 'failed';
    }
    if (groupWriteFailed) throw groupWriteError;
    // 접수 이후 기록 실패도 그대로 중단한다. accepted를 failed로 덮지 않는다.
    ledger.record(item.key, state);
    if (state === 'accepted') counts.sent++;
    else counts[state]++;
  }

  console.log(`[kakao] 배치 결과: 접수 ${counts.sent}, 기존 접수 ${counts.alreadyAccepted}, 실패 ${counts.failed}, 결과 불명 ${counts.unknown}`);
  if (onResult) {
    try { await onResult(counts); }
    catch { console.error('[notification-followups] 배치 결과 보관 실패'); }
  }
  if (counts.failed > 0 || counts.unknown > 0) {
    const error = new Error('일부 알림이 접수되지 않았거나 접수 결과를 확인할 수 없습니다.');
    error.counts = counts;
    throw error;
  }
  return counts;
}
