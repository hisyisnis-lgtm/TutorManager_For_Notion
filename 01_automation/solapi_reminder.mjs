import { createHmac, randomBytes } from 'node:crypto';
import { readDeliveryJson } from '../worker/lib/notificationDelivery.js';

const BASE = 'https://api.solapi.com/messages/v4/groups';
const GROUP_ID = /^G4V[A-Za-z0-9]{20,40}$/;
const KEY = /^[a-f0-9]{64}$/;
const STATES = new Set(['PENDING', 'SENDING', 'PROCESSING', 'SCHEDULED', 'COMPLETE', 'FAILED', 'DELETED', 'SYSTEM-ERROR']);
const COUNTS = ['registeredSuccess', 'sentTotal', 'sentSuccess', 'sentFailed', 'sentPending', 'sentReplacement'];
const unknown = () => ({ ok: false, state: 'unknown', reason: 'solapi_group_unconfirmed', retryable: true });
const failed = () => ({ ok: false, state: 'failed', reason: 'solapi_group_rejected', retryable: false });
const accepted = () => ({ ok: true, state: 'accepted', reason: 'solapi_group_accepted' });

function rejectedRegistration(data) {
  // PUT can return HTTP 200 with a rejected message. A duplicate (1026) needs
  // reconciliation against the group, not a new group or another recipient.
  return Number.isSafeInteger(data?.errorCount) && data.errorCount > 0
    && Array.isArray(data.resultList) && data.resultList.length === 1
    && /^\d{4}$/.test(String(data.resultList[0]?.statusCode))
    && !['2000', '3000', '4000', '1026'].includes(String(data.resultList[0].statusCode));
}

function deliveryError(result) {
  // Do not include provider replies, recipient details, or credentials in errors.
  const error = new Error('리마인더 발송 접수를 확인하지 못했습니다.');
  error.result = { ok: result.ok, state: result.state, reason: result.reason };
  return error;
}

function validGroup(group, key, groupId) {
  return group && GROUP_ID.test(group.groupId || '') && (!groupId || group.groupId === groupId)
    && group.customFields?.notificationKey === key && group.allowDuplicates === false
    && STATES.has(group.status) && group.count
    && COUNTS.every(name => Number.isSafeInteger(group.count[name]) && group.count[name] >= 0)
    && group.count.registeredSuccess <= 1;
}

function outcome(group) {
  if (group.count.registeredSuccess === 1) {
    // Acceptance is distinct from delivery to the handset. A group merely being
    // COMPLETE is insufficient: it can contain only failed messages.
    if (group.count.sentSuccess > 0) return accepted();
    if (['SENDING', 'PROCESSING'].includes(group.status) && group.count.sentFailed === 0) return accepted();
  }
  if (['COMPLETE', 'FAILED', 'DELETED', 'SYSTEM-ERROR'].includes(group.status)) return failed();
  return unknown();
}

/**
 * D-1 reminders use a persisted, one-recipient Solapi group. Creating/adding a
 * message does not send it. Store the returned group ID BEFORE adding/sending;
 * after any lost response, resume that same group rather than create a new send.
 * Solapi only accepts send on PENDING groups and prevents duplicate recipients.
 * https://solapi.com/developers/api/msg-groups-sendGroupMessage
 * https://solapi.com/developers/api/msg-groups-createMessageGroup
 */
export function createSolapiReminderClient({ apiKey, apiSecret, pfId, fetchImpl = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  async function request(method, suffix, body) {
    const date = new Date().toISOString();
    const salt = randomBytes(8).toString('hex');
    const signature = createHmac('sha256', apiSecret).update(date + salt).digest('hex');
    try {
      const response = await fetchImpl(`${BASE}${suffix}`, {
        method, redirect: 'manual', signal: AbortSignal.timeout(15_000),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await readDeliveryJson(response);
      if (response.status >= 200 && response.status < 300 && data && typeof data === 'object') {
        return { ok: true, data };
      }
      return response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)
        ? failed() : unknown();
    } catch { return unknown(); }
  }

  return async function sendReminder(item, { groupId, saveGroup }) {
    if (![apiKey, apiSecret, pfId, item?.to, item?.templateId].every(value => typeof value === 'string' && value.trim())
      || !KEY.test(item?.key || '') || (groupId !== null && !GROUP_ID.test(groupId || ''))
      || typeof saveGroup !== 'function') throw deliveryError(failed());
    const kakaoOptions = { pfId, templateId: item.templateId, variables: item.variables };
    if (item.buttons !== undefined) kakaoOptions.buttons = item.buttons;
    let last = unknown();

    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(attempt === 1 ? 1000 : 3000);
      let group;
      if (groupId === null) {
        const created = await request('POST', '', { allowDuplicates: false, customFields: { notificationKey: item.key } });
        if (!created.ok) {
          last = created;
          if (!last.retryable) break;
          continue;
        }
        if (!validGroup(created.data, item.key) || created.data.status !== 'PENDING'
          || created.data.count.registeredSuccess !== 0 || created.data.count.sentTotal !== 0) {
          last = unknown();
          continue;
        }
        group = created.data;
        // A storage exception must propagate. Never add/send an uncheckpointed
        // group, and never hide this exception in the network retry handler.
        saveGroup(group.groupId);
        groupId = group.groupId;
      } else {
        const current = await request('GET', `/${groupId}`);
        if (!current.ok || !validGroup(current.data, item.key, groupId)) {
          last = current.ok ? unknown() : current;
          if (!last.retryable) break;
          continue;
        }
        group = current.data;
      }

      last = outcome(group);
      if (last.ok) return last;
      if (!last.retryable) break;
      if (group.status !== 'PENDING') continue;

      if (group.count.registeredSuccess === 0) {
        const added = await request('PUT', `/${groupId}/messages`, { messages: [{ to: item.to, kakaoOptions }] });
        // The PUT might have succeeded even when its response was lost or said
        // duplicate. Confirm the saved group before attempting its send.
        const current = await request('GET', `/${groupId}`);
        if (!current.ok || !validGroup(current.data, item.key, groupId)) {
          last = unknown();
          continue;
        }
        group = current.data;
        last = outcome(group);
        if (last.ok) return last;
        if (!last.retryable) break;
        if (group.status !== 'PENDING') continue;
        if (group.count.registeredSuccess !== 1) {
          last = added.ok && rejectedRegistration(added.data) ? failed()
            : !added.ok && !added.retryable ? added : unknown();
          if (!last.retryable) break;
          continue;
        }
      }

      // Never issue another single-message send. If this POST races with an
      // earlier timed-out request, Solapi's group state rejects a second send.
      const sent = await request('POST', `/${groupId}/send`, {});
      const current = await request('GET', `/${groupId}`);
      if (current.ok && validGroup(current.data, item.key, groupId)) {
        last = outcome(current.data);
        if (last.ok) return last;
        if (!last.retryable) break;
        // A rejected send on a still-pending group is a real rejection. Already
        // sent/processing responses are resolved by the group read above.
        if (!sent.ok && !sent.retryable && current.data.status === 'PENDING') { last = sent; break; }
      } else last = unknown();
    }
    throw deliveryError(last);
  };
}
