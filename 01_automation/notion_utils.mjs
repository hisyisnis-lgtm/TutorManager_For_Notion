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
 * KST 기준 날짜 문자열 (YYYY-MM-DD). offsetDays로 어제(-1)·내일(+1) 계산.
 */
export function kstDayStr(offsetDays = 0) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' })
    .format(new Date(Date.now() + offsetDays * 86400000));
}

/** KST 기준 현재 시(0~23) */
export function kstHourNow() {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: '2-digit', hourCycle: 'h23' })
      .format(new Date())
  );
}

/**
 * 워크플로가 [sinceIso, untilIso) 구간에 성공한 실행이 있는지 GitHub API로 확인.
 * Actions 기본 GITHUB_TOKEN + permissions.actions:read 필요.
 *
 * @returns {Promise<boolean|null>} true=성공 있음 / false=없음 / null=조회 불가(토큰 없음·API 실패)
 *   호출부는 null을 "모름"으로 다뤄야 한다 — 발송 판단에선 안전한 쪽(발송)으로,
 *   이월 판단에선 보수적인 쪽(생략)으로 기울인다.
 */
export async function workflowSucceededBetween(workflow, sinceIso, untilIso) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) {
    console.warn(`[wf-check] GITHUB_TOKEN/REPOSITORY 없음 (${workflow})`);
    return null;
  }
  const url =
    `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs` +
    `?status=success&created=${encodeURIComponent(`${sinceIso}..${untilIso}`)}&per_page=20`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'tutor-manager-wf-check',
      },
    });
    if (!res.ok) {
      console.warn(`[wf-check] ${workflow} 조회 실패 (${res.status})`);
      return null;
    }
    const data = await res.json();
    // API의 created 파라미터를 그대로 믿지 않고 client-side로 한 번 더 거른다 (KST 경계)
    const s = new Date(sinceIso).getTime();
    const u = new Date(untilIso).getTime();
    const hits = (data.workflow_runs ?? []).filter((r) => {
      const c = new Date(r.created_at).getTime();
      return c >= s && c < u;
    });
    return hits.length > 0;
  } catch (e) {
    console.warn(`[wf-check] ${workflow} 조회 오류: ${e.message}`);
    return null;
  }
}

/**
 * 알림 발송 스크립트의 실행 가드 — main() 맨 앞에서 호출한다.
 *
 * 구조: 워커 cron이 발송 창 안에서 매시 정각 repository_dispatch로 깨우고(1차+재시도),
 * GitHub schedule은 창 중간의 :30에 한 번 더 깨운다(2차, 워커 전체가 죽었을 때).
 * 어느 경로로 깨어났든 **오늘 이미 성공한 실행이 있으면 그냥 종료**한다 — 그래서
 * 워커가 성공 여부를 확인하지 못하고 무턱대고 재dispatch해도 중복 발송이 없다.
 *
 * 수동 실행(workflow_dispatch)·로컬 실행은 검사 없이 통과한다 (= 강제 발송).
 *
 * 시각 한계(latestHourKST): 이 시각을 넘긴 실행은 발송하지 않는다. 학생 카톡이
 * 새벽에 울리는 것을 막는 마지노선이다(2026-08-27 GitHub 지연으로 03:29 발송 사고).
 * 한계를 넘겨 발송을 포기할 때는 critical 알림을 올려 조용히 사라지지 않게 한다.
 * (그날 알림이 포기되면 다음날 아침 브리핑이 "어제 안내 미발송" 섹션으로 강사에게 알린다.)
 *
 * @param {object} o
 * @param {string} o.workflow      - 워크플로 파일명 (예: 'notify-daily-brief.yml')
 * @param {number} o.latestHourKST - 이 시각(KST)을 넘겼으면 발송하지 않는다
 * @param {boolean} [o.alertOnMiss=true] - 한계 초과로 포기할 때 critical 알림을 올릴지.
 *   이월(carryover)처럼 "보낼 게 없어서 안 보낸 날"이 대부분인 스크립트는 false로 —
 *   지연 실행마다 오탐 알림이 뜬다.
 * @returns {Promise<boolean>} true면 발송을 건너뛴다
 */
export async function shouldSkipBackupRun({ workflow, latestHourKST, alertOnMiss = true }) {
  const event = process.env.GITHUB_EVENT_NAME ?? '';
  if (event !== 'schedule' && event !== 'repository_dispatch') return false; // 수동·로컬 = 강제

  // ① 오늘 이미 성공했으면 조용히 종료 (재시도·백업의 정상 경로)
  const succeeded = await workflowSucceededBetween(
    workflow,
    `${kstDayStr(0)}T00:00:00+09:00`,
    `${kstDayStr(1)}T00:00:00+09:00`
  );
  if (succeeded === true) {
    console.log(`[가드] 오늘 이미 발송 완료 — 종료 (${workflow})`);
    return true;
  }
  // null(조회 불가)이면 막지 않는다 — 중복 발송이 미발송보다 낫다

  // ② 아직 발송 전인데 너무 늦었으면 포기 + 알림 (새벽 발송 방지)
  const hour = kstHourNow();
  if (hour > latestHourKST) {
    console.log(`[가드] KST ${hour}시 — 발송 한계(${latestHourKST}시) 초과, 발송 포기`);
    if (!alertOnMiss) return true;
    await sendAlert({
      level: 'critical',
      title: `🚨 알림 미발송 — ${workflow}`,
      message: [
        `오늘 ${workflow}이 발송 한계(KST ${latestHourKST}시)까지 성공하지 못했습니다.`,
        succeeded === false ? '' : '(성공 여부 조회가 불가능한 상태에서의 판단입니다)',
        '학생 대상 알림은 내일 아침 당일 리마인더로 이월됩니다.',
        '즉시 발송이 필요하면 GitHub Actions에서 수동 실행(workflow_dispatch)하세요.',
      ].filter(Boolean).join('\n'),
      tags: ['rotating_light', 'cron'],
    });
    return true;
  }

  console.log(`[가드] 오늘 성공 이력 없음 — 발송 진행 (${workflow}, ${event})`);
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
