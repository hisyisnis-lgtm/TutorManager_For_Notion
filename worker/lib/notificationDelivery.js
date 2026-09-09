// A successful HTTP request is not proof of delivery to a handset. These are
// Solapi's accepted/pending/completed states, not every 2xxx/3xxx status.
// https://guide.solapi.com/e8af535f-f3ca-4573-bdd3-be41a1d37f70
const ACCEPTED_CODES = new Set(['2000', '3000', '4000']);

// Pure and shared with the Node automation sender. Never return upstream text,
// recipient details, message bodies, identifiers, or authentication material.
export function parseSolapiResult(httpStatus, body) {
  if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus === 408 || httpStatus >= 500) {
    return { ok: false, state: 'unknown', reason: 'solapi_response_unknown' };
  }
  if (httpStatus >= 300) return { ok: false, state: 'failed', reason: 'solapi_http_error' };
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, state: 'unknown', reason: 'solapi_response_unknown' };
  }
  const rawCode = body.statusCode;
  const statusCode = (typeof rawCode === 'string' || typeof rawCode === 'number') && /^\d{4}$/.test(String(rawCode))
    ? String(rawCode) : null;
  if (body.errorCode || (Array.isArray(body.failedMessageList) && body.failedMessageList.length > 0)) {
    return { ok: false, state: 'failed', reason: 'solapi_rejected', ...(statusCode ? { statusCode } : {}) };
  }
  if (!statusCode) return { ok: false, state: 'unknown', reason: 'solapi_response_unknown' };
  return ACCEPTED_CODES.has(statusCode)
    ? { ok: true, state: 'accepted', reason: 'solapi_accepted', statusCode }
    : { ok: false, state: 'failed', reason: 'solapi_rejected', statusCode };
}

// Solapi's single-message response is small. Keep malformed upstream replies
// bounded as well; a parse/read failure remains unknown, never an auto-retry.
export async function readDeliveryJson(response) {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > 64 * 1024) return null;
      text += decoder.decode(item.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
