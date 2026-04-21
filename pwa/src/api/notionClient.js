import { WORKER_URL } from '../config.js';
import { getToken, clearAuth } from './authUtils.js';

async function notionFetch(method, path, body) {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    clearAuth();
    if (window.location.hash !== '#/login') {
      window.location.hash = '#/login';
    }
    return new Promise(() => {}); // 이동 완료 전까지 pending 유지 (undefined 반환 방지)
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(`Notion API 오류: ${message}`);
  }

  return data;
}

/** 페이지네이션을 자동 처리해 전체 결과 수집 */
export async function queryAll(databaseId, filter, sorts) {
  const results = [];
  let cursor;

  do {
    const body = { page_size: 100 };
    if (filter) body.filter = filter;
    if (sorts) body.sorts = sorts;
    if (cursor) body.start_cursor = cursor;

    const data = await notionFetch('POST', `/v1/databases/${databaseId}/query`, body);
    results.push(...data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  return results;
}

/** 단일 페이지 조회 (UI 목록 표시용, page_size 기본 30) */
export async function queryPage(databaseId, filter, sorts, cursor, pageSize = 30) {
  const body = { page_size: pageSize };
  if (filter) body.filter = filter;
  if (sorts) body.sorts = sorts;
  if (cursor) body.start_cursor = cursor;

  return notionFetch('POST', `/v1/databases/${databaseId}/query`, body);
}

export async function getPage(pageId) {
  return notionFetch('GET', `/v1/pages/${pageId}`);
}

export async function createPage(databaseId, properties) {
  return notionFetch('POST', '/v1/pages', {
    parent: { database_id: databaseId },
    properties,
  });
}

export async function updatePage(pageId, properties) {
  return notionFetch('PATCH', `/v1/pages/${pageId}`, { properties });
}

export async function deletePage(pageId) {
  return notionFetch('PATCH', `/v1/pages/${pageId}`, { archived: true });
}
