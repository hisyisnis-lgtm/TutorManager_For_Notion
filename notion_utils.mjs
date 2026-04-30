// 자동화 스크립트 공통 유틸리티

import { createHmac, randomBytes } from 'crypto';

/**
 * Notion API 클라이언트 + queryAll 생성
 * @param {string} token - NOTION_TOKEN 환경변수 값
 * @returns {{ notion, queryAll }}
 */
export function createNotionClient(token) {
  // 429 (rate limit) / 5xx 응답은 지수 백오프로 자동 재시도.
  // Notion은 429에 Retry-After 헤더를 보내기도 하므로 우선 사용.
  async function notion(method, path, body, { maxRetries = 4 } = {}) {
    let attempt = 0;
    while (true) {
      const res = await fetch(`https://api.notion.com/v1${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.ok) return res.json();

      const isRetryable = res.status === 429 || (res.status >= 500 && res.status < 600);
      if (!isRetryable || attempt >= maxRetries) {
        const data = await res.json().catch(() => ({}));
        throw new Error(`${res.status}: ${JSON.stringify(data)}`);
      }
      const retryAfter = parseInt(res.headers.get('Retry-After') || '0', 10);
      const backoffMs = retryAfter > 0
        ? retryAfter * 1000
        : Math.min(15000, 500 * Math.pow(2, attempt)) + Math.random() * 250;
      console.warn(`[notion] ${res.status} 응답, ${Math.round(backoffMs)}ms 후 재시도 (${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, backoffMs));
      attempt++;
    }
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
  // 기존 NTFY_TOPIC은 user 계정의 reserved topic이라 토큰 필요.
  // 새 토픽(critical/warn/digest)은 anonymous public이라 토큰을 보내면 ntfy.sh가
  // user context로 처리하면서 ACL에 없는 토픽이라 silently drop함 (200 응답은 옴).
  // → 토픽이 env.NTFY_TOPIC과 일치할 때만 토큰 첨부.
  const isLegacyTopic = topic === env.NTFY_TOPIC;
  if (isLegacyTopic && env.NTFY_TOKEN) headers['Authorization'] = `Bearer ${env.NTFY_TOKEN}`;

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

/**
 * Solapi 카카오 알림톡 발송 클라이언트 생성
 *
 * 사용:
 *   const sendKakao = createSolapiClient({
 *     apiKey: process.env.SOLAPI_API_KEY,
 *     apiSecret: process.env.SOLAPI_API_SECRET,
 *     pfId: process.env.KAKAO_PFID,
 *   });
 *   await sendKakao(to, templateId, variables);                  // 버튼 없음
 *   await sendKakao(to, templateId, variables, buttonsArray);    // 버튼 포함
 *
 * 동작:
 *  - apiKey/apiSecret/pfId/templateId/to 중 하나라도 비면 silent return (no-op)
 *  - HMAC-SHA256 서명 + 3회 재시도 (네트워크 오류만 재시도, API 오류는 즉시 반환)
 *  - buttons === undefined 이면 kakaoOptions.buttons 필드를 누락 (Solapi 호환)
 *
 * @returns {Function} sendKakao(to, templateId, variables, buttons?)
 */
export function createSolapiClient({ apiKey, apiSecret, pfId }) {
  return async function sendKakao(to, templateId, variables, buttons) {
    if (!apiKey || !apiSecret || !pfId || !templateId || !to) return;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const date = new Date().toISOString();
      const salt = randomBytes(8).toString('hex');
      const signature = createHmac('sha256', apiSecret).update(date + salt).digest('hex');
      const kakaoOptions = { pfId, templateId, variables };
      if (buttons !== undefined) kakaoOptions.buttons = buttons;
      try {
        const res = await fetch('https://api.solapi.com/messages/v4/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
          },
          body: JSON.stringify({ message: { to, kakaoOptions } }),
        });
        const data = await res.json();
        if (!res.ok) {
          console.error(`카카오 발송 실패 (${to}):`, JSON.stringify(data));
          return;
        }
        console.log(`카카오 알림톡 발송 완료: ${to}`);
        return;
      } catch (e) {
        if (attempt < 3) {
          console.warn(`카카오 발송 오류 (${to}), ${attempt}회 시도 실패 — 2초 후 재시도:`, e.message);
          await new Promise(r => setTimeout(r, 2000));
        } else {
          console.error(`카카오 발송 오류 (${to}), 최종 실패:`, e.message);
        }
      }
    }
  };
}
