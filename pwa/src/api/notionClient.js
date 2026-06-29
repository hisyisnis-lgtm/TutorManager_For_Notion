import { WORKER_URL } from '../config.js';
import { getToken, clearAuth } from './authUtils.js';

async function notionFetch(method, path, body, attempt = 0) {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // Notion rate limit(429): 워커가 이미 Retry-After backoff 재시도를 하지만, 그래도
  // 드물게 올라오면 클라이언트에서 한 번 더 backoff 재시도한다. 429는 요청이 처리되기
  // 전 거부된 것이라 재시도해도 중복 쓰기 위험이 없다.
  if (res.status === 429 && attempt < 2) {
    const retryAfter = Number(res.headers.get('Retry-After'));
    const waitMs = Math.min(
      (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** attempt) * 1000,
      5000,
    );
    await new Promise((r) => setTimeout(r, waitMs));
    return notionFetch(method, path, body, attempt + 1);
  }

  if (res.status === 401) {
    clearAuth();
    // 강사 HashRouter엔 '/login' 라우트가 없다. hash만 바꾸면 매칭되는 라우트가 없어
    // 콘텐츠가 흰 화면이 되고 BottomNav만 남는다. 새로고침해 App을 isAuthed()=false로
    // 재초기화하면 LoginPage가 정상으로 뜬다. (teacher_device 플래그가 남아 있어 루트
    // 자동 리다이렉트가 학생 페이지로 튕기지 않고 LoginPage로 간다.)
    window.location.reload();
    return new Promise(() => {}); // 리로드 전까지 pending 유지 (undefined 반환 방지)
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
