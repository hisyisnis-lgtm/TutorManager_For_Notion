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
 * ntfy 알림 클라이언트 생성 (기존 단일 토픽용 — 하위호환)
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
 * 멀티 토픽 알림 발송 (level별 토픽 자동 선택)
 *
 * 환경변수:
 *   NTFY_TOPIC_CRITICAL — 즉시 대응 (priority 5)
 *   NTFY_TOPIC_WARN     — 당일 확인 (priority 3)
 *   NTFY_TOPIC_DIGEST   — 일일 요약 (priority 2)
 *   NTFY_TOPIC          — 일반 알림 (priority 4) + fallback
 *
 * 사용:
 *   await sendAlert({ level: 'critical', title: '⚠️ 스크립트 실패', message: err.stack });
 */
export async function sendAlert({ level = 'info', title, message, tags } = {}) {
  const env = process.env;
  const TOPIC_MAP = {
    critical: env.NTFY_TOPIC_CRITICAL || env.NTFY_TOPIC,
    warn: env.NTFY_TOPIC_WARN || env.NTFY_TOPIC,
    digest: env.NTFY_TOPIC_DIGEST || env.NTFY_TOPIC,
    info: env.NTFY_TOPIC,
  };
  const PRIORITY_MAP = { critical: 5, warn: 3, digest: 2, info: 4 };
  const topic = TOPIC_MAP[level] || env.NTFY_TOPIC;
  const priority = PRIORITY_MAP[level] || 4;
  if (!topic) {
    console.error(`[ntfy:${level}] 토픽 미설정 (level=${level})`);
    return;
  }

  const headers = { 'Content-Type': 'application/json' };
  if (env.NTFY_TOKEN) headers['Authorization'] = `Bearer ${env.NTFY_TOKEN}`;

  const payload = { topic, title, message, priority };
  if (Array.isArray(tags) && tags.length > 0) payload.tags = tags;

  try {
    const res = await fetch('https://ntfy.sh', { method: 'POST', headers, body: JSON.stringify(payload) });
    if (!res.ok) console.error(`[ntfy:${level}] 전송 실패 ${res.status}: ${await res.text()}`);
    else console.log(`[ntfy:${level}] 발송: ${title}`);
  } catch (e) {
    console.error(`[ntfy:${level}] 네트워크 오류:`, e.message);
  }
}

/**
 * 자동화 스크립트 main() 래퍼 — 미처리 예외를 critical 알림으로 발송 후 exit(1).
 *
 * 사용:
 *   import { runWithAlert } from './notion_utils.mjs';
 *   runWithAlert('check_conflicts.mjs', main);
 */
export async function runWithAlert(scriptName, mainFn) {
  try {
    await mainFn();
  } catch (err) {
    const msg = (err?.message || String(err)).slice(0, 400);
    const stack = (err?.stack || '').split('\n').slice(0, 6).join('\n').slice(0, 1000);
    console.error(`[${scriptName}] 실패:`, err);
    await sendAlert({
      level: 'critical',
      title: `🚨 자동화 스크립트 실패: ${scriptName}`,
      message: `${msg}\n\n${stack}`,
      tags: ['rotating_light', 'github-actions'],
    });
    process.exit(1);
  }
}

/**
 * 학생 이름 앞 상태 이모지(🟢🟡⚫) 제거
 */
export function stripEmoji(name) {
  return name.replace(/^[🟢🟡⚫]\s*/u, '');
}

/**
 * Rate limit 대응용 딜레이 (Notion API 초당 3회 제한)
 */
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
