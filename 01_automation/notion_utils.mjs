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
  //
  // 연결 자체가 끊기는 실패(ECONNRESET·ETIMEDOUT 등)도 같은 백오프로 흡수한다.
  // 이때는 fetch가 응답 없이 곧바로 throw하기 때문에 아래 상태 코드 분기를
  // 아예 타지 못한다 — 2026-07-29·08-06 스크립트 실패가 모두 이 경로였다.
  async function notion(method, path, body, { maxRetries = 4 } = {}) {
    let attempt = 0;
    while (true) {
      const waitAndRetry = async (reason) => {
        const backoffMs = Math.min(15000, 500 * Math.pow(2, attempt)) + Math.random() * 250;
        console.warn(`[notion] ${reason}, ${Math.round(backoffMs)}ms 후 재시도 (${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, backoffMs));
        attempt++;
      };

      let res;
      try {
        res = await fetch(`https://api.notion.com/v1${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        if (attempt >= maxRetries) {
          throw new Error(`Notion 연결 실패 (${method} ${path}, ${attempt + 1}회 시도): ${e.message}`);
        }
        await waitAndRetry(`연결 실패(${e.cause?.code || e.message})`);
        continue;
      }

      if (res.ok) return res.json();

      const isRetryable = res.status === 429 || (res.status >= 500 && res.status < 600);
      if (!isRetryable || attempt >= maxRetries) {
        // 본문이 JSON이 아닐 수 있다(Cloudflare 평문 에러 페이지 등) — 원문을 그대로 남겨
        // 알림에 실제 원인이 드러나게 한다.
        const text = await res.text().catch(() => '');
        throw new Error(`Notion ${res.status} (${method} ${path}): ${text.slice(0, 300).trim()}`);
      }
      const retryAfter = parseInt(res.headers.get('Retry-After') || '0', 10);
      if (retryAfter > 0) {
        console.warn(`[notion] ${res.status} 응답, ${retryAfter}s 후 재시도 (${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        attempt++;
      } else {
        await waitAndRetry(`${res.status} 응답`);
      }
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
 * 백업 schedule 실행을 걸러낸다 — 알림 발송 스크립트 맨 앞에서 호출한다.
 *
 * 구조: 워커 cron(repository_dispatch)이 1차, GitHub schedule이 2차 백업이다.
 * 1차가 정상이면 2차는 아무것도 하면 안 되고(중복 발송), 1차가 실패했을 때만 대신 보낸다.
 *
 * 두 가지를 본다:
 *  ① 오늘(KST) 같은 워크플로가 이미 **성공**했으면 건너뛴다.
 *     실패한 실행은 성공으로 치지 않으므로, 1차가 에러로 끝났으면 백업이 진짜로 돈다.
 *  ② 예정 시각에서 너무 지났으면 건너뛴다. GitHub schedule 자체도 몇 시간씩 밀리는데
 *     (2026-08-27 실측 8~11시간), 학생 카톡이 KST 새벽 3시에 나가는 건 안 보내느니만 못하다.
 *
 * 토큰이 없거나 조회에 실패하면 **막지 않는다** — 두 번 오는 것보다 안 오는 게 나쁘다.
 * 단 ②(시각 가드)는 토큰과 무관하게 항상 적용된다.
 *
 * @param {object} o
 * @param {string} o.workflow      - 워크플로 파일명 (예: 'notify-daily-brief.yml')
 * @param {number} o.latestHourKST - 이 시각(KST)을 넘겼으면 발송하지 않는다
 * @returns {Promise<boolean>} true면 발송을 건너뛴다
 */
export async function shouldSkipBackupRun({ workflow, latestHourKST }) {
  // 워커가 깨운 1차 실행과 수동 실행은 검사 대상이 아니다
  if (process.env.GITHUB_EVENT_NAME !== 'schedule') return false;

  // ① 오늘 이미 성공한 실행이 있으면 조용히 종료 (정상 경로)
  let primaryKnownOk = false;
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const todayKST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const since = `${todayKST}T00:00:00+09:00`;

  if (token && repo) {
    const url =
      `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs` +
      `?status=success&created=%3E%3D${encodeURIComponent(since)}&per_page=20`;
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'tutor-manager-backup-guard',
        },
      });
      if (res.ok) {
        const data = await res.json();
        const done = (data.workflow_runs ?? []).filter(
          (r) => new Date(r.created_at) >= new Date(since)
        );
        if (done.length > 0) {
          console.log(`[백업] 오늘 이미 성공 ${done.length}건 (${done[0].event}) — 생략`);
          return true;
        }
        primaryKnownOk = true; // 조회는 됐고, 성공 이력이 없다는 뜻
      } else {
        console.warn(`[백업] 실행 이력 조회 실패 (${res.status})`);
      }
    } catch (e) {
      console.warn('[백업] 조회 오류:', e.message);
    }
  } else {
    console.warn('[백업] GITHUB_TOKEN/REPOSITORY 없음');
  }

  // ② 여기까지 왔으면 1차가 안 됐다는 뜻이다. 그런데 백업마저 너무 늦었으면 보내지 않는다
  //    — 학생 카톡이 KST 새벽에 나가는 건 안 보내느니만 못하다(2026-08-27 실측 03:29 발송).
  //    다만 이 경우 알림이 그날 통째로 빠지므로 **조용히 넘어가면 안 된다.**
  const kstHour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul', hour: '2-digit', hourCycle: 'h23',
    }).format(new Date())
  );
  if (kstHour > latestHourKST) {
    console.log(`[백업] KST ${kstHour}시 — 발송 한계(${latestHourKST}시) 초과, 생략`);
    await sendAlert({
      level: 'critical',
      title: `🚨 알림 누락 — ${workflow}`,
      message: [
        `오늘 ${workflow} 알림이 발송되지 못했습니다.`,
        `워커 cron(1차)이 실패했고, 백업 schedule도 KST ${kstHour}시에야 실행돼 한계(${latestHourKST}시)를 넘겼습니다.`,
        primaryKnownOk ? '' : '(1차 성공 여부는 확인하지 못했습니다 — GitHub API 조회 실패)',
        '',
        '필요하면 GitHub Actions에서 수동 실행(workflow_dispatch)하세요.',
      ].filter(Boolean).join('\n'),
      tags: ['rotating_light', 'cron'],
    });
    return true;
  }

  console.log('[백업] 1차 성공 이력 없음 — 백업이 대신 발송한다');
  return false;
}

/**
 * 학생별 결제 시간 회차 합계 (환불 차감 반영) — Map<studentId, hours>
 *
 * 학생 DB의 '결제 시간 회차 합계' rollup은 결제 행이 연결된 시점 값에 고정돼 이후 환불을
 * 반영하지 않는다(2026-08-25 검증). 결제 행의 '유효 시간 회차'는 정확하므로 직접 합산한다.
 * PWA payments.js remainingSessionsOf()와 같은 계산 — **한쪽만 고치지 말 것.**
 *
 * @param {Function} queryAll - createNotionClient가 준 queryAll
 * @param {string} paymentsDbId - 수강료 결제 내역 DB id
 */
export async function loadPaidSessions(queryAll, paymentsDbId) {
  const paidByStudent = new Map();
  for (const pay of await queryAll(paymentsDbId)) {
    const sessions = pay.properties['유효 시간 회차']?.formula?.number ?? 0;
    for (const rel of pay.properties['학생']?.relation ?? []) {
      paidByStudent.set(rel.id, (paidByStudent.get(rel.id) ?? 0) + sessions);
    }
  }
  return paidByStudent;
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
 * 전화번호 PII 마스킹 — 끝 4자리만 보존.
 * 공개 저장소의 GitHub Actions 로그에 수강생 전화번호가 평문으로 남지 않게,
 * 발송 로그 출력 시 거친다. (worker/lib/security.js의 maskPhone과 동일 로직 — 빌드 구조상 공유 불가라 별도 정의)
 * 예: "010-1234-5678" → "***-****-5678"
 */
export function maskPhone(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***-****-${digits.slice(-4)}`;
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
          console.error(`카카오 발송 실패 (${maskPhone(to)}):`, JSON.stringify(data));
          return;
        }
        console.log(`카카오 알림톡 발송 완료: ${maskPhone(to)}`);
        return;
      } catch (e) {
        if (attempt < 3) {
          console.warn(`카카오 발송 오류 (${maskPhone(to)}), ${attempt}회 시도 실패 — 2초 후 재시도:`, e.message);
          await new Promise(r => setTimeout(r, 2000));
        } else {
          console.error(`카카오 발송 오류 (${maskPhone(to)}), 최종 실패:`, e.message);
        }
      }
    }
  };
}
