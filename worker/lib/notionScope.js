import { normalizeId } from './string.js';

const UUID = '[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}';
const databaseRoute = new RegExp(`^/v1/databases/(${UUID})(/query)?$`, 'i');
const pageRoute = new RegExp(`^/v1/pages/(${UUID})$`, 'i');
const failure = (status, error) => ({ ok: false, status, error });

export function pageInDatabase(page, allowedDbIds) {
  const id = page?.parent?.database_id;
  return typeof id === 'string' && allowedDbIds.has(normalizeId(id).toLowerCase());
}

// Only API shapes used by this application are proxied. Resolve ownership on every
// page request; knowing an ID or querying some other allowed DB is not authority.
export async function authorizeNotionRequest(request, url, notion, allowedDbIds) {
  let body;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    try { body = await request.json(); } catch { return failure(400, 'JSON 형식이 올바르지 않습니다.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return failure(400, '요청 형식이 올바르지 않습니다.');
  }
  const db = url.pathname.match(databaseRoute);
  if (db) {
    if (!allowedDbIds.has(normalizeId(db[1]).toLowerCase())) return failure(403, '허용되지 않은 DB입니다.');
    if (db[2] ? request.method !== 'POST' : request.method !== 'GET') return failure(405, '허용되지 않은 메서드입니다.');
    return { ok: true, body };
  }
  if (url.pathname === '/v1/pages' && request.method === 'POST') {
    const parent = body?.parent;
    if (!parent || typeof parent.database_id !== 'string' || !allowedDbIds.has(normalizeId(parent.database_id).toLowerCase())
      || parent.page_id || parent.data_source_id || parent.workspace || (parent.type && parent.type !== 'database_id')) {
      return failure(403, '허용되지 않은 상위 DB입니다.');
    }
    return { ok: true, body };
  }
  const page = url.pathname.match(pageRoute);
  if (!page) return failure(403, '허용되지 않은 경로입니다.');
  if (request.method !== 'GET' && request.method !== 'PATCH') return failure(405, '허용되지 않은 메서드입니다.');
  if (body?.parent) return failure(403, '페이지 이동은 허용되지 않습니다.');
  const current = await notion('GET', `/pages/${page[1]}`);
  if (current?.object === 'error') return failure(current.status === 404 ? 404 : 502, '페이지를 확인할 수 없습니다.');
  if (!pageInDatabase(current, allowedDbIds)) return failure(403, '허용되지 않은 페이지입니다.');
  return { ok: true, body, ...(request.method === 'GET' ? { page: current } : {}) };
}
