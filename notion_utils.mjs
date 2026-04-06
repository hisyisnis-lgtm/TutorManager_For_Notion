// 자동화 스크립트 공통 유틸리티

/**
 * Notion API 클라이언트 + queryAll 생성
 * @param {string} token - NOTION_TOKEN 환경변수 값
 * @returns {{ notion, queryAll }}
 */
export function createNotionClient(token) {
  async function notion(method, path, body) {
    const res = await fetch(`https://api.notion.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data)}`);
    return data;
  }

  async function queryAll(dbId, filter, sorts) {
    const results = [];
    let cursor;
    do {
      const body = { page_size: 100 };
      if (filter) body.filter = filter;
      if (sorts) body.sorts = sorts;
      if (cursor) body.start_cursor = cursor;
      const data = await notion('POST', `/databases/${dbId}/query`, body);
      results.push(...data.results);
      cursor = data.next_cursor;
    } while (cursor);
    return results;
  }

  return { notion, queryAll };
}

/**
 * ntfy 알림 클라이언트 생성
 * @param {string} topic - NTFY_TOPIC 환경변수 값
 * @param {string} [ntfyToken] - NTFY_TOKEN 환경변수 값 (선택)
 * @returns {Function} sendNtfy(title, message, priority?)
 */
export function createNtfyClient(topic, ntfyToken) {
  return async function sendNtfy(title, message, priority = 3) {
    if (!topic) return;
    const headers = { 'Content-Type': 'application/json' };
    if (ntfyToken) headers['Authorization'] = `Bearer ${ntfyToken}`;
    try {
      const res = await fetch('https://ntfy.sh', {
        method: 'POST',
        headers,
        body: JSON.stringify({ topic, title, message, priority }),
      });
      if (!res.ok) console.error(`ntfy 전송 실패 (${res.status}): ${await res.text()}`);
      else console.log(`ntfy 알림 전송 완료: ${title}`);
    } catch (e) {
      console.error('ntfy 전송 오류:', e.message);
    }
  };
}

/**
 * 학생 이름 앞 상태 이모지(🟢🟡⚫) 제거
 */
export function stripEmoji(name) {
  return name.replace(/^[🟢🟡⚫]\s*/, '');
}

/**
 * Rate limit 대응용 딜레이 (Notion API 초당 3회 제한)
 */
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
