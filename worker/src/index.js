// 순수 함수는 lib/로 분리되어 단위 테스트 대상.
// 새 순수 함수 추가 시 lib/ 안에 두고 여기서 import.
import { stripEmoji, normalizeId } from '../lib/string.js';
import { isSafeExternalUrl, maskPhone, maskToken } from '../lib/security.js';
import {
  ConsultSchema,
  HomeworkSubmitSchema,
  StudentTokenSchema,
  NotionPageIdSchema,
  MyClassesQuerySchema,
} from '../lib/schemas.js';
import { validateBody, validateParams, validatePathToken } from '../lib/validation.js';

const CLASS_DB_ID = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';
const STUDENT_DB_ID = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';
const HOMEWORK_DB_ID = '5ce7d5ef-7b80-4795-843f-325f4ca868e2';

// ===== 예약 시스템 DB =====
const BLOCKED_DATES_DB_ID = '31e838fa-f2a6-81d3-b034-c47a4f0e5f3e';

// ===== 무료상담 신청 DB =====
const CONSULT_DB_ID = '324838fa-f2a6-815d-99a7-ff165e8f78aa';

const DAY_KR = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * Notion API fetch 헬퍼 팩토리 — 토큰을 한 번만 바인딩
 * 반환된 함수: (method, path, body?) → Promise<JSON>
 */
function makeNotion(notionToken) {
  return (method, path, body) =>
    fetch(`https://api.notion.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(r => r.json());
}

/**
 * Notion DB query 페이지네이션 헬퍼 — has_more 처리하여 모든 결과 반환.
 * 100건 초과 시 데이터 누락을 막는다 (학생당 수업·숙제가 100개를 넘는 경우 대비).
 *
 * @param {Function} n         makeNotion()이 반환한 fetch 함수
 * @param {string}   dbId      대상 DB ID
 * @param {object}   [body]    Notion query body (filter, sorts 등). page_size는 무시됨.
 * @returns {Promise<Array>}   results 배열 전체
 */
async function queryAllNotion(n, dbId, body = {}) {
  const results = [];
  let cursor;
  do {
    const reqBody = { ...body, page_size: 100 };
    if (cursor) reqBody.start_cursor = cursor;
    const data = await n('POST', `/databases/${dbId}/query`, reqBody);
    if (Array.isArray(data.results)) results.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

/**
 * 에러 응답 헬퍼 — 모든 에러 응답의 단일 생성 지점
 * { error: message } JSON + Content-Type + CORS 헤더를 항상 일관되게 포함
 */
function errRes(corsHeaders, status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * JWT 인증 미들웨어 — 유효하지 않으면 401 Response 반환, 통과 시 null 반환
 * handleBookingRoutes / handleHomeworkRoutes 양쪽에서 공통 사용
 */
async function requireJwt(request, env, corsHeaders) {
  const authHeader = request.headers.get('Authorization') || '';
  const jwtToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!jwtToken || !(await verifyToken(jwtToken, env.JWT_SECRET || env.AUTH_PASSWORD))) {
    return errRes(corsHeaders, 401, 'Unauthorized');
  }
  return null;
}

// 수업 페이지 제목이 비어있고 학생이 연결돼 있으면 제목 자동 설정
async function syncClassTitle(pageId, notionToken) {
  const notionFetch = makeNotion(notionToken);

  const page = await notionFetch('GET', `/pages/${pageId}`);
  const studentRelation = page.properties?.['학생']?.relation ?? [];
  if (studentRelation.length === 0) return;

  const names = [];
  for (const { id } of studentRelation) {
    const student = await notionFetch('GET', `/pages/${id}`);
    const raw = student.properties?.['이름']?.title?.[0]?.plain_text ?? '?';
    names.push(stripEmoji(raw));
  }

  const newTitle = names.join(', ');
  await notionFetch('PATCH', `/pages/${pageId}`, {
    properties: { 제목: { title: [{ text: { content: newTitle } }] } },
  });
  console.log(`제목 설정: ${pageId} → "${newTitle}"`);
}

// 학생 이름 변경 시 → 해당 학생이 포함된 모든 수업 제목 강제 갱신
async function updateClassesByStudent(studentPageId, notionToken) {
  const notionFetch = makeNotion(notionToken);

  const res = await notionFetch('POST', `/databases/${CLASS_DB_ID}/query`, {
    filter: { property: '학생', relation: { contains: studentPageId } },
    page_size: 100,
  });

  for (const classPage of (res.results || [])) {
    const studentRelation = classPage.properties?.['학생']?.relation ?? [];
    if (studentRelation.length === 0) continue;

    const names = [];
    for (const { id } of studentRelation) {
      const student = await notionFetch('GET', `/pages/${id}`);
      const raw = student.properties?.['이름']?.title?.[0]?.plain_text ?? '?';
      names.push(stripEmoji(raw));
    }

    const newTitle = names.join(', ');
    await notionFetch('PATCH', `/pages/${classPage.id}`, {
      properties: { 제목: { title: [{ text: { content: newTitle } }] } },
    });
    console.log(`제목 갱신 (학생명 변경): ${classPage.id} → "${newTitle}"`);
  }
}

const ALLOWED_ORIGINS = new Set([
  'https://hisyisnis-lgtm.github.io',
  'https://tiantian-chinese.pages.dev',
  'http://localhost:5173',
  'http://localhost:4173',
]);

// ===== Notion 프록시 화이트리스트 =====
// /v1/databases/:id 또는 /v1/pages/:id 경로에 들어올 수 있는 ID 집합.
// 코드에서 명시적으로 사용하는 DB만 허용해 임의 워크스페이스 접근을 차단한다.
// (페이지 ID는 학생 DB의 row일 수밖에 없으므로 별도 검증은 query 단계에서 수행됨)
const STUDENT_DB_RAW = STUDENT_DB_ID.replace(/-/g, '');
const CLASS_DB_RAW = CLASS_DB_ID.replace(/-/g, '');
const HOMEWORK_DB_RAW = HOMEWORK_DB_ID.replace(/-/g, '');
const BLOCKED_DATES_DB_RAW = BLOCKED_DATES_DB_ID.replace(/-/g, '');
const CONSULT_DB_RAW = CONSULT_DB_ID.replace(/-/g, '');
const ALLOWED_NOTION_DB_IDS = new Set([
  STUDENT_DB_RAW,
  CLASS_DB_RAW,
  HOMEWORK_DB_RAW,
  BLOCKED_DATES_DB_RAW,
  CONSULT_DB_RAW,
  // 수업 유형·할인·결제·수업일지 등 강사용 추가 DB (PWA에서 사용)
  '314838faf2a681c3b4e4da87c48f9b43', // LESSON_TYPE_DB
  '314838faf2a681d39ce4c628edab065b', // DISCOUNT_DB
  '314838faf2a68154935bedd3d2fbea83', // PAYMENT_DB
  '318838faf2a681f19b9cfd379b1026ed', // LESSON_LOG_DB
]);

// SSRF 방어 isSafeExternalUrl는 lib/security.js로 분리됨.

// fetch 응답 본문 크기 제한 (스트리밍 단위로 누적). maxBytes 초과 시 throw.
async function fetchWithLimit(url, init = {}, maxBytes = 5 * 1024 * 1024) {
  const res = await fetch(url, { ...init, redirect: 'manual' });
  // redirect 발생 시 Location을 다시 검증 후 따라가야 안전 → 여기선 그냥 거절
  if (res.status >= 300 && res.status < 400) {
    throw new Error('redirect blocked');
  }
  const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
  if (contentLength && contentLength > maxBytes) {
    throw new Error('response too large');
  }
  const reader = res.body?.getReader();
  if (!reader) return { res, buffer: new ArrayBuffer(0) };
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { reader.cancel(); } catch {}
      throw new Error('response too large');
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { buffer.set(c, offset); offset += c.byteLength; }
  return { res, buffer: buffer.buffer };
}

// ===== Rate limit (Cloudflare Cache API 기반, KV 없이 동작) =====
// 같은 키로 windowSec 동안 최대 limit번 허용. 초과 시 false 반환.
// 카운터를 cache에 저장: key별로 호출마다 새 응답을 push하고, 매치된 응답 수로 횟수 추정.
// 단순화 위해 키별 단일 슬롯에 카운터를 atomic하게 증가하는 대신,
// "현재 window 시작 시점의 카운터 시리얼라이즈된 응답"을 사용한다.
async function rateLimitCheck(key, limit, windowSec) {
  try {
    const cache = caches.default;
    const bucket = Math.floor(Date.now() / 1000 / windowSec);
    const cacheKey = new Request(`https://ratelimit.local/${encodeURIComponent(key)}/${bucket}`);
    const hit = await cache.match(cacheKey);
    let count = 0;
    if (hit) {
      const text = await hit.text();
      count = parseInt(text, 10) || 0;
    }
    if (count >= limit) return false;
    await cache.put(
      cacheKey,
      new Response(String(count + 1), {
        headers: { 'Cache-Control': `public, max-age=${windowSec}` },
      }),
    );
    return true;
  } catch {
    return true; // 캐시 실패 시 fail-open (가용성 우선)
  }
}

// IP를 안정적으로 얻는다. 없으면 0.0.0.0으로 묶음 (테스트/내부 호출 대응).
function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || '0.0.0.0';
}

// PII 마스킹 maskPhone/maskToken는 lib/security.js로 분리됨.

// HMAC-SHA256 서명 생성 → base64 (토큰용)
async function createToken(secret, expSeconds) {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSeconds }));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${payload}.${sigB64}`;
}

// 토큰 검증 → 유효하면 true, 만료/위조면 false
async function verifyToken(token, secret) {
  const parts = (token || '').split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const sigBytes = Uint8Array.from(atob(sig), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payload));
    if (!valid) return false;
    const { exp } = JSON.parse(atob(payload));
    return exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

// HMAC-SHA256 서명 생성 → hex (Notion 웹훅 검증용)
async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Notion 웹훅 처리 → GitHub Actions repository_dispatch 트리거
async function handleNotionWebhook(request, env, ctx) {
  const body = await request.text();

  // Notion 구독 인증 챌린지 처리 (verification_token 포함 시 즉시 응답)
  let parsed = null;
  try { parsed = JSON.parse(body); } catch {}
  if (parsed?.verification_token) {
    console.log('Notion verification_token:', parsed.verification_token);
    return new Response(JSON.stringify({ challenge: parsed.verification_token }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Notion HMAC-SHA256 서명 검증 (X-Notion-Signature: v0=<hex>)
  // 시크릿 미설정 시 fail-closed: 요청을 거부해 인증 없는 접근 차단
  if (!env.NOTION_WEBHOOK_SECRET) {
    console.error('[webhook] NOTION_WEBHOOK_SECRET 미설정. npx wrangler secret put NOTION_WEBHOOK_SECRET 실행 필요.');
    return new Response('Webhook secret not configured', { status: 500 });
  }
  const sigHeader = request.headers.get('X-Notion-Signature') || '';
  const expected = 'v0=' + (await hmacSha256Hex(env.NOTION_WEBHOOK_SECRET, body));
  if (expected !== sigHeader) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 수업 캘린더 DB 페이지 생성/속성 변경 시 → 제목 즉시 동기화 (백그라운드)
  const eventType = parsed?.type;
  const parentId = parsed?.data?.parent?.id;
  const pageId = parsed?.entity?.id;
  console.log(`[webhook] type=${eventType} parentId=${parentId} pageId=${pageId}`);

  if (
    pageId &&
    normalizeId(parentId) === normalizeId(CLASS_DB_ID) &&
    (eventType === 'page.created' || eventType === 'page.properties_updated')
  ) {
    console.log('[webhook] → 수업 제목 동기화 시작');
    ctx.waitUntil(syncClassTitle(pageId, env.NOTION_TOKEN));
  }

  // 학생 DB 이름 변경 시 → 연결된 수업 제목 갱신 (백그라운드)
  if (
    pageId &&
    eventType === 'page.properties_updated' &&
    normalizeId(parentId) === normalizeId(STUDENT_DB_ID)
  ) {
    console.log('[webhook] → 학생명 변경, 수업 제목 갱신 시작');
    ctx.waitUntil(updateClassesByStudent(pageId, env.NOTION_TOKEN));
  }

  // GitHub Actions repository_dispatch 트리거 (백그라운드)
  if (env.GITHUB_PAT) {
    const dispatch = (event_type) =>
      fetch('https://api.github.com/repos/hisyisnis-lgtm/TutorManager_For_Notion/dispatches', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GITHUB_PAT}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'tutor-manager-proxy',
        },
        body: JSON.stringify({ event_type }),
      });
    ctx.waitUntil(dispatch('session-shortage-check'));
    ctx.waitUntil(dispatch('conflict-check'));
  }

  // Notion은 빠른 200 응답 필요
  return new Response('OK', { status: 200 });
}

// ===== 알림톡 발송 (Solapi 준비 전 no-op placeholder) =====
async function sendAlimtalk(_env, { to: _to, templateCode, variables }) {
  // TODO: Solapi API 키 준비되면 구현
  // env.SOLAPI_API_KEY, env.SOLAPI_API_SECRET, env.KAKAO_PFID 필요
  console.log(`[알림톡 placeholder] template=${templateCode}`, JSON.stringify(variables));
}

// ===== 카카오 알림톡 발송 (Solapi) — 강사 알림용 =====
async function sendKakaoAlert(env, { to, templateId, variables }) {
  if (!env.SOLAPI_API_KEY || !env.SOLAPI_API_SECRET || !env.KAKAO_PFID || !templateId || !to) return;
  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const signature = await hmacSha256Hex(env.SOLAPI_API_SECRET, date + salt);
  try {
    const res = await fetch('https://api.solapi.com/messages/v4/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `HMAC-SHA256 apiKey=${env.SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}`,
      },
      body: JSON.stringify({
        message: { to, kakaoOptions: { pfId: env.KAKAO_PFID, templateId, variables } },
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.error('[kakao] 발송 실패:', JSON.stringify(data));
    } else {
      console.log(`[kakao] 알림톡 발송 완료: ${to}`);
    }
  } catch (e) {
    console.error('[kakao] 발송 오류:', e.message);
  }
}

// ===== ntfy 강사 알림 발송 (멀티 토픽 + 심각도) =====
//
// level별 토픽 매핑:
//   critical → NTFY_TOPIC_CRITICAL (즉시 대응, priority 5)
//   warn     → NTFY_TOPIC_WARN     (당일 확인, priority 3)
//   digest   → NTFY_TOPIC_DIGEST   (일일 요약, priority 2)
//   info     → NTFY_TOPIC          (일반 운영 알림, priority 4) — 기존 동작 호환
//
// 미설정 토픽은 NTFY_TOPIC으로 fallback. dedupKey를 주면 같은 키로 5분 내 중복 발송 차단.
async function sendAlert(env, { level = 'info', title, message, tags, dedupKey, ttlSeconds = 300 } = {}) {
  const TOPIC_MAP = {
    critical: env.NTFY_TOPIC_CRITICAL || env.NTFY_TOPIC,
    warn: env.NTFY_TOPIC_WARN || env.NTFY_TOPIC,
    digest: env.NTFY_TOPIC_DIGEST || env.NTFY_TOPIC,
    info: env.NTFY_TOPIC,
  };
  const PRIORITY_MAP = { critical: 5, warn: 3, digest: 2, info: 4 };
  const topic = TOPIC_MAP[level] || env.NTFY_TOPIC;
  const priority = PRIORITY_MAP[level] || 4;
  if (!topic) { console.error(`[ntfy:${level}] 토픽 미설정`); return; }

  // dedup: 동일 키로 ttl 내 중복 발송 차단 (Cloudflare Cache API)
  if (dedupKey) {
    try {
      const cache = caches.default;
      const cacheReq = new Request(`https://ntfy-dedup.local/${level}/${encodeURIComponent(dedupKey)}`);
      const hit = await cache.match(cacheReq);
      if (hit) { console.log(`[ntfy:${level}] dedup hit:`, dedupKey); return; }
      await cache.put(cacheReq, new Response('1', { headers: { 'Cache-Control': `public, max-age=${ttlSeconds}` } }));
    } catch (e) {
      console.warn('[ntfy] dedup 캐시 오류 (무시하고 발송):', e.message);
    }
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    // 새 토픽(critical/warn/digest)은 anonymous public이라 토큰을 보내면 ntfy.sh가
    // user context로 처리하면서 ACL에 없는 토픽이라 silently drop함 (200 응답은 옴).
    // 기존 NTFY_TOPIC만 user 계정의 reserved topic이라 토큰 필요.
    const isLegacyTopic = topic === env.NTFY_TOPIC;
    if (isLegacyTopic && env.NTFY_TOKEN) headers['Authorization'] = `Bearer ${env.NTFY_TOKEN}`;
    const payload = { topic, title, message, priority };
    if (Array.isArray(tags) && tags.length > 0) payload.tags = tags;
    const res = await fetch('https://ntfy.sh', { method: 'POST', headers, body: JSON.stringify(payload) });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[ntfy:${level}] HTTP ${res.status}:`, text);
    } else {
      console.log(`[ntfy:${level}] 발송 성공:`, title);
    }
  } catch (e) {
    console.error(`[ntfy:${level}] 네트워크 오류:`, e.message);
  }
}

// info level 알림은 GitHub repository_dispatch로 우회한다.
//
// Cloudflare Workers의 공유 IP가 ntfy.sh의 IP-based daily quota에 자주 걸려 429를 받는
// 문제를 회피하기 위함. GitHub Actions runner IP에서는 ntfy 발송이 정상 동작한다.
// 워크플로우: .github/workflows/notify-from-worker.yml (event_type: ntfy-relay)
//
// 트레이드오프: ntfy.sh 직접 호출 대비 약 5~15초 지연. 무료상담은 카톡 알림톡으로 가고
// 이 함수를 쓰는 곳은 숙제 제출 알림 1곳뿐이라 지연 허용 가능.
async function sendNtfy(env, message, title = 'New Consultation') {
  if (!env.GITHUB_PAT) {
    console.error('[ntfy-relay] GITHUB_PAT 미설정 — 알림 발송 불가');
    return;
  }
  try {
    const res = await fetch(
      'https://api.github.com/repos/hisyisnis-lgtm/TutorManager_For_Notion/dispatches',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GITHUB_PAT}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'tutor-manager-proxy',
        },
        body: JSON.stringify({
          event_type: 'ntfy-relay',
          client_payload: { title, message, level: 'info' },
        }),
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[ntfy-relay] HTTP ${res.status}:`, text);
    } else {
      console.log('[ntfy-relay] dispatch 성공:', title);
    }
  } catch (e) {
    console.error('[ntfy-relay] 네트워크 오류:', e.message);
  }
}

// ===== 워커 런타임 에러 캡처 =====
//
// fetch 핸들러가 던진 unhandled exception을 critical 토픽으로 즉시 알림.
// 동일 에러(message + path)가 짧은 시간 내 폭주하면 dedup으로 1건만 발송.
async function captureWorkerError(err, env, request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const errMsg = (err?.message || String(err)).slice(0, 300);
  const stack = (err?.stack || '').split('\n').slice(0, 4).join('\n').slice(0, 800);
  const dedupKey = `worker:${request.method}:${path}:${errMsg}`;
  await sendAlert(env, {
    level: 'critical',
    title: `🚨 Worker 에러 (${request.method} ${path})`,
    message: `${errMsg}\n\n${stack}`,
    tags: ['rotating_light', 'worker'],
    dedupKey,
    ttlSeconds: 600, // 10분 dedup
  });
}

// ===== 무료상담 신청 처리 =====
async function handleConsultRequest(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return new Response(JSON.stringify({ error: '잘못된 요청입니다.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // zod 스키마 검증 (lib/schemas.js의 ConsultSchema)
  const v = validateBody(ConsultSchema, body, corsHeaders);
  if (!v.ok) return v.response;
  const { name, phone, kakaoId, level, preferredDays, preferredTime, concerns, reasons, reasonOther, message } = v.data;
  const phoneDigits = phone.replace(/\D/g, '');

  const dbId = env.CONSULT_DB_ID || CONSULT_DB_ID;
  if (!dbId) {
    console.error('[consult] CONSULT_DB_ID 미설정');
    return new Response(JSON.stringify({ error: '서버 설정 오류입니다. 잠시 후 다시 시도해주세요.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const daysText = Array.isArray(preferredDays) && preferredDays.length > 0
    ? preferredDays.join(', ')
    : '미기재';

  // 고민/이유를 상담 내용에 포함
  const structuredParts = [];
  if (Array.isArray(concerns) && concerns.length > 0) {
    structuredParts.push(`[고민] ${concerns.join(', ')}`);
  }
  if (Array.isArray(reasons) && reasons.length > 0) {
    const reasonText = reasons.map(r =>
      r === '기타 (직접 입력)' && reasonOther?.trim() ? `기타: ${reasonOther.trim()}` : r
    ).join(', ');
    structuredParts.push(`[이유] ${reasonText}`);
  }
  if (message?.trim()) structuredParts.push(`[상담 내용] ${message.trim()}`);
  const fullContent = structuredParts.join('\n');

  // Notion 페이지 생성
  const notionRes = await fetch(`https://api.notion.com/v1/pages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parent: { database_id: dbId },
      properties: {
        '이름': { title: [{ text: { content: name.trim() } }] },
        '전화번호': { rich_text: [{ text: { content: phoneDigits } }] },
        '카카오톡 ID': kakaoId?.trim() ? { rich_text: [{ text: { content: kakaoId.trim() } }] } : undefined,
        '수준': level ? { select: { name: level } } : undefined,
        '희망 요일': Array.isArray(preferredDays) && preferredDays.length > 0
          ? { multi_select: preferredDays.map(d => ({ name: d })) }
          : undefined,
        '희망 시간대': preferredTime ? { select: { name: preferredTime } } : undefined,
        '상담 내용': fullContent
          ? { rich_text: [{ text: { content: fullContent } }] }
          : undefined,
        '상태': { select: { name: '신청됨' } },
        '신청 일시': { date: { start: new Date().toISOString() } },
      },
    }),
  }).then(r => r.json());

  if (notionRes.object === 'error') {
    console.error('[consult] Notion 오류:', JSON.stringify(notionRes));
    return new Response(JSON.stringify({ error: '신청 저장 중 오류가 발생했습니다.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 강사에게 ntfy 알림 — PII는 마스킹 (전체 정보는 Notion CONSULT_DB에서 확인)
  const concernsText = Array.isArray(concerns) && concerns.length > 0 ? concerns.join(', ') : '미기재';
  const reasonsText = Array.isArray(reasons) && reasons.length > 0
    ? reasons.map(r => r === '기타 (직접 입력)' && reasonOther?.trim() ? `기타: ${reasonOther.trim()}` : r).join(', ')
    : '미기재';
  // 이름은 성만, 카카오 ID는 첫 2자만 노출 (ntfy.sh 서버에 평문 PII 누적 방지)
  const trimmedName = name.trim();
  const maskedName = trimmedName.length > 1 ? `${trimmedName[0]}**` : trimmedName;
  const maskedKakao = kakaoId?.trim() ? `${kakaoId.trim().slice(0, 2)}***` : null;
  const ntfyMsg = [
    `이름: ${maskedName}`,
    `전화: ${maskPhone(phoneDigits)}`,
    maskedKakao ? `카카오톡 ID: ${maskedKakao}` : null,
    `수준: ${level || '미기재'}`,
    `고민: ${concernsText}`,
    `이유: ${reasonsText}`,
    `희망 요일: ${daysText}`,
    `희망 시간대: ${preferredTime || '미기재'}`,
    `※ 자세한 내용은 Notion 무료상담 DB에서 확인하세요.`,
  ].filter(Boolean).join('\n');

  // 카카오 알림톡 발송 (강사에게)
  if (env.KAKAO_TPL_CONSULT && env.MY_PHONE) {
    await sendKakaoAlert(env, {
      to: env.MY_PHONE,
      templateId: env.KAKAO_TPL_CONSULT,
      variables: {
        '#{name}': name.trim(),
        '#{phone}': phoneDigits,
        '#{level}': level || '미기재',
        '#{days}': daysText,
        '#{time}': preferredTime || '미기재',
        '#{message}': message?.trim() || '없음',
      },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ===== 예약 시스템 라우트 처리 =====
async function handleBookingRoutes(request, env, corsHeaders, url) {
  // 토큰 기반 학생 라우트는 brute-force/스캔 대상이 될 수 있어 IP당 분당 60회 제한.
  // (강사 인증이 필요한 /booking/blocked 등은 JWT 검증으로 별도 보호)
  const isStudentTokenPath =
    /^\/booking\/(student|status|my-classes|my-class)\//.test(url.pathname) ||
    url.pathname === '/booking/reserve';
  if (isStudentTokenPath) {
    if (!(await rateLimitCheck(`book:${clientIp(request)}`, 60, 60))) {
      return errRes(corsHeaders, 429, '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
    }
  }

  const n = makeNotion(env.NOTION_TOKEN);

  // 시간 관련 유틸
  const timeToMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const minToTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  // 예약 불가 날짜 파싱 & isBlocked / getBlockedTimes 함수 생성 (공통)
  // 날짜 요일 계산: 'T12:00:00Z' 기준으로 UTC 정오에 getDay() → 모든 타임존에서 정확
  const buildBlockedData = (blockedResults) => {
    const entries = (blockedResults ?? []).map(p => {
      const props = p.properties;
      const d = props?.['날짜']?.date;
      const type = props?.['반복 유형']?.select?.name;
      const days = (props?.['반복 요일']?.multi_select ?? []).map(o => o.name);
      const timesStr = props?.['차단 시간']?.rich_text?.[0]?.plain_text || '';
      const blockedTimes = timesStr ? timesStr.split(',').map(t => t.trim()).filter(Boolean) : [];
      return { type, days, start: d?.start, end: d?.end || d?.start, blockedTimes };
    }).filter(b => b.type === '반복' ? b.days.length > 0 : b.start);

    const matchesDateRange = (b, dateStr) => {
      if (b.type === '반복') {
        const dayKR = DAY_KR[new Date(dateStr + 'T12:00:00Z').getDay()];
        if (!b.days.includes(dayKR)) return false;
        if (b.start && dateStr < b.start) return false;
        if (b.end && dateStr > b.end) return false;
        return true;
      }
      return b.start && dateStr >= b.start && dateStr <= (b.end || b.start);
    };

    // 전일 차단 (차단 시간 미설정)
    const isBlocked = (dateStr) =>
      entries.some(b => b.blockedTimes.length === 0 && matchesDateRange(b, dateStr));

    // 개별 차단 시간 슬롯 집합 반환
    const getBlockedTimes = (dateStr) => {
      const times = new Set();
      for (const b of entries) {
        if (b.blockedTimes.length > 0 && matchesDateRange(b, dateStr)) {
          for (const t of b.blockedTimes) times.add(t);
        }
      }
      return times;
    };

    return { isBlocked, getBlockedTimes };
  };

  // GET /booking/slots?from=YYYY-MM-DD&to=YYYY-MM-DD
  // 전일 차단된 날짜만 제외하고 오늘+2일 ~ 오늘+90일 범위 전부 반환
  if (url.pathname === '/booking/slots' && request.method === 'GET') {
    const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const minDate = new Date(nowKST);
    minDate.setUTCDate(minDate.getUTCDate() + 2);
    const minDateStr = minDate.toISOString().slice(0, 10);

    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');
    const from = !fromParam || fromParam < minDateStr ? minDateStr : fromParam;
    const to = toParam || (() => {
      const d = new Date(minDate);
      d.setUTCDate(d.getUTCDate() + 90);
      return d.toISOString().slice(0, 10);
    })();

    const blockedRes = await n('POST', `/databases/${BLOCKED_DATES_DB_ID}/query`, {
      filter: {
        or: [
          { property: '반복 유형', select: { equals: '반복' } },
          {
            and: [
              { property: '반복 유형', select: { equals: '일회성' } },
              { property: '날짜', date: { on_or_after: from } },
            ],
          },
        ],
      },
      page_size: 100,
    });
    const { isBlocked } = buildBlockedData(blockedRes.results);

    const result = [];
    const cur = new Date(from + 'T00:00:00Z');
    const end = new Date(to + 'T00:00:00Z');

    while (cur <= end) {
      const dateStr = cur.toISOString().slice(0, 10);
      if (!isBlocked(dateStr)) result.push({ date: dateStr });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // GET /booking/time-slots?date=YYYY-MM-DD — 해당 날짜의 30분 단위 예약 가능 시간 목록
  if (url.pathname === '/booking/time-slots' && request.method === 'GET') {
    const date = url.searchParams.get('date');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 최소 예약 가능 날짜 (오늘+2) 체크 — skipMinDate=1이면 강사용으로 건너뜀
    const skipMinDate = url.searchParams.get('skipMinDate') === '1';
    if (!skipMinDate) {
      const nowKST2 = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const minDate2 = new Date(nowKST2);
      minDate2.setUTCDate(minDate2.getUTCDate() + 2);
      if (date < minDate2.toISOString().slice(0, 10)) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const excludeSlotId = (url.searchParams.get('excludeId') ?? '').replace(/-/g, '');

    const [blockedRes2, classRes] = await Promise.all([
      n('POST', `/databases/${BLOCKED_DATES_DB_ID}/query`, {
        filter: {
          or: [
            { property: '반복 유형', select: { equals: '반복' } },
            {
              and: [
                { property: '반복 유형', select: { equals: '일회성' } },
                { property: '날짜', date: { on_or_after: date } },
              ],
            },
          ],
        },
        page_size: 100,
      }),
      n('POST', `/databases/${CLASS_DB_ID}/query`, {
        filter: { property: '수업 일시', date: { equals: date } },
        page_size: 100,
      }),
    ]);

    const { isBlocked, getBlockedTimes } = buildBlockedData(blockedRes2.results);

    if (isBlocked(date)) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 08:00 ~ 21:00 전체 30분 슬롯 생성 (22:00은 종료시간으로만 사용)
    const allSlots = new Set();
    for (let m = 8 * 60; m <= 21 * 60; m += 30) allSlots.add(minToTime(m));

    // busySet: 시작 불가 슬롯
    // passableBlockSet: 종료 시간 범위 탐색 차단 슬롯 (pre-buffer 중 classStart-30만 차단)
    const busySet = new Set();
    const passableBlockSet = new Set();
    // busyIntervals: 클라이언트 측 수업시간 충돌 계산용 (check-conflict 대체)
    const busyIntervals = [];
    for (const p of classRes.results ?? []) {
      if (p.id.replace(/-/g, '') === excludeSlotId) continue;
      const props = p.properties;
      if (props?.['특이사항']?.select?.name === '🚫 취소') continue;
      const dtStr = props?.['수업 일시']?.date?.start;
      const dur = Number(props?.['수업 시간(분)']?.select?.name);
      if (!dtStr || !dur) continue;
      const timeMatch = dtStr.match(/T(\d{2}):(\d{2})/);
      if (!timeMatch) continue;
      const classStartMin = Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
      // 수업 점유 슬롯: 시작 불가 + 탐색 불가
      for (let elapsed = 0; elapsed < dur; elapsed += 30) {
        const slot = minToTime(classStartMin + elapsed);
        busySet.add(slot);
        passableBlockSet.add(slot);
      }
      // 앞 버퍼: classStart-60은 시작만 차단(탐색 가능), classStart-30은 탐색 한계도 차단
      busySet.add(minToTime(classStartMin - 60));
      busySet.add(minToTime(classStartMin - 30));
      passableBlockSet.add(minToTime(classStartMin - 30));
      // 뒤 버퍼: 시작 불가 + 탐색 불가
      const postBuf = minToTime(classStartMin + dur);
      busySet.add(postBuf);
      passableBlockSet.add(postBuf);
      busyIntervals.push({ startMin: classStartMin, dur });
    }

    // 개별 차단 시간 슬롯 제거
    for (const t of getBlockedTimes(date)) {
      busySet.add(t);
      passableBlockSet.add(t);
    }

    const available = [...allSlots].filter(t => !busySet.has(t)).sort();
    const passable = [...allSlots].filter(t => !passableBlockSet.has(t)).sort();
    return new Response(JSON.stringify({ available, passable, busyIntervals }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // GET /booking/check-conflict?date=YYYY-MM-DD&startTime=HH:MM&duration=NNN&excludeId=pageId (강사용 충돌 검사)
  if (url.pathname === '/booking/check-conflict' && request.method === 'GET') {
    const date = url.searchParams.get('date');
    const startTime = url.searchParams.get('startTime');
    const duration = parseInt(url.searchParams.get('duration') ?? '0');
    const excludeId = (url.searchParams.get('excludeId') ?? '').replace(/-/g, '');

    if (!date || !startTime || !duration) {
      return new Response(JSON.stringify({ conflict: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const classRes = await n('POST', `/databases/${CLASS_DB_ID}/query`, {
      filter: { property: '수업 일시', date: { equals: date } },
      page_size: 100,
    });

    const newStartMin = timeToMin(startTime);
    const newEndMin = newStartMin + duration;

    for (const p of classRes.results ?? []) {
      if (p.id.replace(/-/g, '') === excludeId) continue;
      const props = p.properties;
      if (props?.['특이사항']?.select?.name === '🚫 취소') continue;
      const dtStr = props?.['수업 일시']?.date?.start;
      const dur = Number(props?.['수업 시간(분)']?.select?.name);
      if (!dtStr || !dur) continue;
      const timeMatch = dtStr.match(/T(\d{2}):(\d{2})/);
      if (!timeMatch) continue;
      const classStartMin = Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
      // 기존 수업 ± 30분 버퍼와 겹치는지 확인
      if (newStartMin < classStartMin + dur + 30 && newEndMin > classStartMin - 30) {
        return new Response(JSON.stringify({ conflict: true, conflictTime: minToTime(classStartMin) }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ conflict: false }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // POST /booking/reserve
  if (url.pathname === '/booking/reserve' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const { date, startTime, endTime, studentToken, mode } = body;

    if (!date || !startTime || !endTime || !studentToken) {
      return new Response(JSON.stringify({ error: '필수 항목이 누락되었습니다.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 학생 코드로 학생 조회
    const studentRes = await n('POST', `/databases/${STUDENT_DB_ID}/query`, {
      filter: { property: '예약 코드', rich_text: { equals: studentToken } },
      page_size: 1,
    });
    const studentPage = studentRes.results?.[0];
    if (!studentPage) {
      return new Response(JSON.stringify({ error: '등록된 학생이 아닙니다. 예약 코드를 확인해주세요.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sProps = studentPage.properties;
    const rawName = sProps?.['이름']?.title?.[0]?.plain_text ?? '';
    const studentName = stripEmoji(rawName);
    const phone = sProps?.['전화번호']?.phone_number ?? '';
    const remainingSessions = sProps?.['잔여 시간 회차']?.formula?.number ?? 0;

    const durationMin = timeToMin(endTime) - timeToMin(startTime);

    if (durationMin < 60) {
      return new Response(JSON.stringify({ error: '최소 1시간 이상 예약해야 합니다.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (durationMin % 30 !== 0) {
      return new Response(JSON.stringify({ error: '30분 단위로만 예약 가능합니다.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 잔여 시간 회차 체크 (60분=1회차, 90분=1.5회차 등)
    const requiredSessions = durationMin / 60;
    if (remainingSessions < requiredSessions) {
      return new Response(JSON.stringify({ error: `잔여 시간이 부족합니다. (잔여: ${remainingSessions}회차, 필요: ${requiredSessions}회차)` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Race condition 방지: 같은 날짜의 수업(CLASS_DB)과 시간 겹침 확인
    const classCheckRes = await n('POST', `/databases/${CLASS_DB_ID}/query`, {
      filter: { property: '수업 일시', date: { equals: date } },
      page_size: 100,
    });

    const startMin = timeToMin(startTime);
    const endMin = timeToMin(endTime);
    const hasOverlap = (classCheckRes.results ?? [])
      .filter(p => p.properties?.['특이사항']?.select?.name !== '🚫 취소')
      .some(p => {
        const dtStr = p.properties?.['수업 일시']?.date?.start;
        const dur = Number(p.properties?.['수업 시간(분)']?.select?.name);
        if (!dtStr || !dur) return false;
        const tm = dtStr.match(/T(\d{2}):(\d{2})/);
        if (!tm) return false;
        const bStart = Number(tm[1]) * 60 + Number(tm[2]);
        const bEnd = bStart + dur;
        // 수업 사이 30분 갭 필수: 기존 수업 종료 후 30분, 시작 전 30분 이내 불가
        return startMin < bEnd + 30 && endMin > bStart - 30;
      });

    if (hasOverlap) {
      return new Response(JSON.stringify({ error: '해당 시간은 다른 수업과 30분 이내 겹칩니다. 다른 시간을 선택해주세요.' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = crypto.randomUUID();

    // 수업 캘린더 DB에 등록 (예약 토큰 포함)
    const classDatetime = `${date}T${startTime}:00+09:00`;
    const classProps = {
      '제목': { title: [{ text: { content: `${studentName} ${date}` } }] },
      '수업 일시': { date: { start: classDatetime } },
      '수업 시간(분)': { select: { name: String(durationMin) } },
      '학생': { relation: [{ id: studentPage.id }] },
      '예약 토큰': { rich_text: [{ text: { content: token } }] },
    };
    if (env.LESSON_TYPE_PAGE_ID) classProps['수업 유형'] = { relation: [{ id: env.LESSON_TYPE_PAGE_ID }] };
    if (mode) classProps['수업 장소'] = { select: { name: mode } };

    const newPage = await n('POST', '/pages', {
      parent: { database_id: CLASS_DB_ID },
      properties: classProps,
    });

    // 레이스 컨디션 방지: 생성 직후 재확인 (동시 요청이 겹친 경우 롤백)
    const postCheckRes = await n('POST', `/databases/${CLASS_DB_ID}/query`, {
      filter: { property: '수업 일시', date: { equals: date } },
      page_size: 100,
    });
    const postConflicts = (postCheckRes.results ?? [])
      .filter(p => p.id !== newPage.id && p.properties?.['특이사항']?.select?.name !== '🚫 취소')
      .filter(p => {
        const dtStr = p.properties?.['수업 일시']?.date?.start;
        const dur = Number(p.properties?.['수업 시간(분)']?.select?.name);
        if (!dtStr || !dur) return false;
        const tm = dtStr.match(/T(\d{2}):(\d{2})/);
        if (!tm) return false;
        const bStart = Number(tm[1]) * 60 + Number(tm[2]);
        const bEnd = bStart + dur;
        return startMin < bEnd && bStart < endMin;
      });
    if (postConflicts.length > 0) {
      await n('PATCH', `/pages/${newPage.id}`, { archived: true }).catch(e => {
        console.error('[예약 롤백 실패] 중복 수업 페이지 잔존:', newPage.id, e?.message);
      });
      return new Response(JSON.stringify({ error: '방금 다른 분이 예약했습니다. 다른 시간을 선택해주세요.' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      await sendAlimtalk(env, {
        to: phone,
        templateCode: 'BOOKING_CONFIRMED',
        variables: { name: studentName, date, startTime },
      });
    } catch (e) {
      console.error('[알림톡] 발송 실패 (예약은 완료됨):', e.message);
    }

    return new Response(JSON.stringify({ token, date, startTime, endTime, durationMin, studentName }), {
      status: 201,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // GET /booking/student/:token (공개, 학생 예약 코드로 학생 정보 조회)
  const studentLookupMatch = url.pathname.match(/^\/booking\/student\/([^/]+)$/);
  if (studentLookupMatch && request.method === 'GET') {
    const token = decodeURIComponent(studentLookupMatch[1]);
    const tv = validatePathToken(StudentTokenSchema, token, corsHeaders, '학생 토큰');
    if (!tv.ok) return tv.response;
    const res = await n('POST', `/databases/${STUDENT_DB_ID}/query`, {
      filter: { property: '예약 코드', rich_text: { equals: token } },
      page_size: 1,
    });
    const page = res.results?.[0];
    if (!page) {
      return new Response(JSON.stringify({ error: '등록된 학생이 아닙니다.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const props = page.properties;
    const rawName = props?.['이름']?.title?.[0]?.plain_text ?? '';

    // 완료된 유료 수업의 시간 회차 합계 (취소·보강 제외, 예정 제외)
    const nowISO = new Date().toISOString();
    const paidHours = props?.['결제 시간 회차 합계']?.rollup?.number ?? 0;
    let completedHours = 0;
    let classCursor;
    do {
      const classRes = await n('POST', `/databases/${CLASS_DB_ID}/query`, {
        filter: {
          and: [
            { property: '학생', relation: { contains: page.id } },
            { property: '수업 일시', date: { on_or_before: nowISO } },
            { property: '특이사항', select: { does_not_equal: '🚫 취소' } },
            { property: '특이사항', select: { does_not_equal: '🟠 보강' } },
            { property: '무료 수업', rollup: { number: { greater_than: 0 } } },
          ],
        },
        page_size: 100,
        ...(classCursor ? { start_cursor: classCursor } : {}),
      });
      for (const cls of classRes.results ?? []) {
        const minStr = cls.properties?.['수업 시간(분)']?.select?.name;
        if (minStr) completedHours += parseInt(minStr, 10) / 60;
      }
      classCursor = classRes.has_more ? classRes.next_cursor : undefined;
    } while (classCursor);

    const remainingHours = Math.max(0, paidHours - completedHours);

    return new Response(JSON.stringify({
      id: page.id,
      name: stripEmoji(rawName),
      phone: props?.['전화번호']?.phone_number ?? '',
      remainingSessions: props?.['잔여 시간 회차']?.formula?.number ?? 0,
      totalSessions: props?.['총 수업 횟수']?.rollup?.number ?? 0,
      referralBonus: props?.['추천 보너스']?.number ?? 0,
      remainingHours,
      paidHours,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // GET /booking/status/:token — CLASS_DB 기반
  const statusMatch = url.pathname.match(/^\/booking\/status\/([^/]+)$/);
  if (statusMatch && request.method === 'GET') {
    const token = decodeURIComponent(statusMatch[1]);
    const res = await n('POST', `/databases/${CLASS_DB_ID}/query`, {
      filter: { property: '예약 토큰', rich_text: { equals: token } },
      page_size: 1,
    });

    const page = res.results?.[0];
    if (!page) {
      return new Response(JSON.stringify({ error: '예약을 찾을 수 없습니다.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const props = page.properties;
    const dtStr = props['수업 일시']?.date?.start ?? '';
    const date = dtStr.slice(0, 10);
    const tm = dtStr.match(/T(\d{2}):(\d{2})/);
    const startTime = tm ? `${tm[1]}:${tm[2]}` : '';
    const durationMin = Number(props['수업 시간(분)']?.select?.name) || 0;
    const isCancelled = props['특이사항']?.select?.name === '🚫 취소';

    // 학생 이름: 학생 relation에서 조회
    let studentName = '';
    const studentRelation = props['학생']?.relation ?? [];
    if (studentRelation.length > 0) {
      try {
        const studentPage = await n('GET', `/pages/${studentRelation[0].id}`);
        const rawName = studentPage.properties?.['이름']?.title?.[0]?.plain_text ?? '';
        studentName = stripEmoji(rawName);
      } catch {}
    }

    return new Response(JSON.stringify({
      status: isCancelled ? '취소' : '확정',
      date,
      startTime,
      durationMin,
      studentName,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // GET /booking/my-classes/:token?month=YYYY-MM (공개, 학생 본인 수업 목록)
  const myClassesMatch = url.pathname.match(/^\/booking\/my-classes\/([^/]+)$/);
  if (myClassesMatch && request.method === 'GET') {
    const token = decodeURIComponent(myClassesMatch[1]);
    const tv = validatePathToken(StudentTokenSchema, token, corsHeaders, '학생 토큰');
    if (!tv.ok) return tv.response;
    const qv = validateParams(MyClassesQuerySchema, Object.fromEntries(url.searchParams), corsHeaders);
    if (!qv.ok) return qv.response;
    const month = url.searchParams.get('month'); // "YYYY-MM" 형식

    const studentRes = await n('POST', `/databases/${STUDENT_DB_ID}/query`, {
      filter: { property: '예약 코드', rich_text: { equals: token } },
      page_size: 1,
    });
    const studentPage = studentRes.results?.[0];
    if (!studentPage) {
      return new Response(JSON.stringify({ error: '등록된 학생이 아닙니다.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let classFilter;
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [y, m] = month.split('-').map(Number);
      const nextY = m === 12 ? y + 1 : y;
      const nextM = m === 12 ? 1 : m + 1;
      const nextMonthStart = `${nextY}-${String(nextM).padStart(2, '0')}-01`;
      classFilter = {
        and: [
          { property: '학생', relation: { contains: studentPage.id } },
          { property: '수업 일시', date: { on_or_after: `${month}-01` } },
          { property: '수업 일시', date: { before: nextMonthStart } },
        ],
      };
    } else {
      classFilter = { property: '학생', relation: { contains: studentPage.id } };
    }

    // 페이지네이션 처리 — 학생이 100개+ 수업 보유 시 누락 방지
    const allClassResults = await queryAllNotion(n, CLASS_DB_ID, {
      filter: classFilter,
      sorts: [{ property: '수업 일시', direction: 'descending' }],
    });
    const rawClasses = allClassResults.map(p => {
      const props = p.properties;
      const dtStr = props['수업 일시']?.date?.start ?? '';
      const date = dtStr.slice(0, 10);
      const tm = dtStr.match(/T(\d{2}):(\d{2})/);
      const startTime = tm ? `${tm[1]}:${tm[2]}` : '';
      const specialNote = props['특이사항']?.select?.name ?? null;
      const lessonTypeId = props['수업 유형']?.relation?.[0]?.id ?? null;
      return {
        id: p.id,
        date,
        startTime,
        durationMin: Number(props['수업 시간(분)']?.select?.name) || 0,
        location: props['수업 장소']?.select?.name ?? null,
        isCancelled: specialNote === '🚫 취소',
        specialNote,
        lessonTypeId,
      };
    });

    // 수업 유형 (1:1 / 2:1) — relation이므로 유니크 ID만 병렬 fetch
    const uniqueTypeIds = [...new Set(rawClasses.map(c => c.lessonTypeId).filter(Boolean))];
    const typeMap = {};
    if (uniqueTypeIds.length > 0) {
      await Promise.all(uniqueTypeIds.map(async id => {
        try {
          const page = await n('GET', `/pages/${id}`);
          typeMap[id] = page.properties?.['수업 유형']?.select?.name ?? null;
        } catch { typeMap[id] = null; }
      }));
    }

    const classes = rawClasses.map(({ lessonTypeId, ...c }) => ({
      ...c,
      classType: lessonTypeId ? (typeMap[lessonTypeId] ?? null) : null,
    }));
    return new Response(JSON.stringify(classes), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // DELETE /booking/my-class/:classId (학생 본인 수업 취소, 당일 불가)
  // 토큰은 body { token } 로 전달 (URL 쿼리 노출 방지)
  const myClassDeleteMatch = url.pathname.match(/^\/booking\/my-class\/([^/]+)$/);
  if (myClassDeleteMatch && request.method === 'DELETE') {
    const classId = myClassDeleteMatch[1];
    const deleteBody = await request.json().catch(() => ({}));
    const studentToken = deleteBody.token || '';
    if (!studentToken) {
      return new Response(JSON.stringify({ error: '인증이 필요합니다.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const sRes = await n('POST', `/databases/${STUDENT_DB_ID}/query`, {
      filter: { property: '예약 코드', rich_text: { equals: studentToken } },
      page_size: 1,
    });
    const sPage = sRes.results?.[0];
    if (!sPage) {
      return new Response(JSON.stringify({ error: '예약 코드가 올바르지 않습니다.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const classPageRes = await n('GET', `/pages/${classId}`);
    if (!classPageRes || classPageRes.object === 'error') {
      return new Response(JSON.stringify({ error: '수업을 찾을 수 없습니다.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const cProps = classPageRes.properties;
    // 소유자 확인
    const classStudentIds = (cProps?.['학생']?.relation ?? []).map(r => r.id);
    if (!classStudentIds.includes(sPage.id)) {
      return new Response(JSON.stringify({ error: '이 수업을 취소할 권한이 없습니다.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (cProps?.['특이사항']?.select?.name === '🚫 취소') {
      return new Response(JSON.stringify({ error: '이미 취소된 수업입니다.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // 당일 취소 불가
    const dtStr = cProps?.['수업 일시']?.date?.start ?? '';
    const classDate = dtStr.slice(0, 10);
    const todayKST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    if (!classDate || classDate <= todayKST) {
      return new Response(JSON.stringify({ error: '당일 취소는 불가합니다. 강사에게 직접 연락해주세요.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // CLASS_DB 취소 처리
    await n('PATCH', `/pages/${classId}`, {
      properties: { '특이사항': { select: { name: '🚫 취소' } } },
    });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // POST /booking/my-class/:classId/restore (학생 본인 취소 수업 복구)
  // 토큰은 body { token } 로 전달 (URL 쿼리 노출 방지)
  const myClassRestoreMatch = url.pathname.match(/^\/booking\/my-class\/([^/]+)\/restore$/);
  if (myClassRestoreMatch && request.method === 'POST') {
    const classId = myClassRestoreMatch[1];
    const restoreBody = await request.json().catch(() => ({}));
    const studentToken = restoreBody.token || '';
    if (!studentToken) {
      return new Response(JSON.stringify({ error: '인증이 필요합니다.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const sRes = await n('POST', `/databases/${STUDENT_DB_ID}/query`, {
      filter: { property: '예약 코드', rich_text: { equals: studentToken } },
      page_size: 1,
    });
    const sPage = sRes.results?.[0];
    if (!sPage) {
      return new Response(JSON.stringify({ error: '예약 코드가 올바르지 않습니다.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const classPageRes = await n('GET', `/pages/${classId}`);
    if (!classPageRes || classPageRes.object === 'error') {
      return new Response(JSON.stringify({ error: '수업을 찾을 수 없습니다.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const cProps = classPageRes.properties;
    const classStudentIds = (cProps?.['학생']?.relation ?? []).map(r => r.id);
    if (!classStudentIds.includes(sPage.id)) {
      return new Response(JSON.stringify({ error: '이 수업을 복구할 권한이 없습니다.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (cProps?.['특이사항']?.select?.name !== '🚫 취소') {
      return new Response(JSON.stringify({ error: '취소된 수업이 아닙니다.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const dtStr = cProps?.['수업 일시']?.date?.start ?? '';
    const classDate = dtStr.slice(0, 10);
    const todayKST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    if (!classDate || classDate <= todayKST) {
      return new Response(JSON.stringify({ error: '과거 수업은 복구할 수 없습니다.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const restoreDurationMin = Number(cProps?.['수업 시간(분)']?.select?.name) || 60;
    const requiredForRestore = restoreDurationMin / 60;
    const currentRemaining = sPage.properties?.['잔여 시간 회차']?.formula?.number ?? 0;
    if (currentRemaining < requiredForRestore) {
      return new Response(JSON.stringify({ error: `잔여 시간이 부족하여 복구할 수 없습니다. (잔여: ${currentRemaining}회차, 필요: ${requiredForRestore}회차)` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    await n('PATCH', `/pages/${classId}`, {
      properties: { '특이사항': { select: null } },
    });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ===== 예약 불가 날짜 관리 (강사용, 인증 필요) =====

  // GET /booking/blocked
  if (url.pathname === '/booking/blocked' && request.method === 'GET') {
    const authErr = await requireJwt(request, env, corsHeaders);
    if (authErr) return authErr;

    const res = await n('POST', `/databases/${BLOCKED_DATES_DB_ID}/query`, {
      sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
      page_size: 100,
    });

    const blocked = (res.results ?? []).map(p => {
      const props = p.properties;
      const d = props?.['날짜']?.date;
      const timesStr = props?.['차단 시간']?.rich_text?.[0]?.plain_text || '';
      return {
        id: p.id,
        type: props?.['반복 유형']?.select?.name || '일회성',
        days: (props?.['반복 요일']?.multi_select ?? []).map(o => o.name),
        start: d?.start,
        end: d?.end,
        memo: props?.['메모']?.title?.[0]?.plain_text || '',
        blockedTimes: timesStr ? timesStr.split(',').map(t => t.trim()).filter(Boolean) : [],
      };
    });

    return new Response(JSON.stringify(blocked), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // POST /booking/blocked
  if (url.pathname === '/booking/blocked' && request.method === 'POST') {
    const authErr = await requireJwt(request, env, corsHeaders);
    if (authErr) return authErr;

    const body = await request.json().catch(() => ({}));
    const { type, days, start, end, memo, blockedTimes } = body;

    if (type === '반복' && (!days || days.length === 0)) {
      return new Response(JSON.stringify({ error: '반복 요일을 선택해주세요.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (type !== '반복' && !start) {
      return new Response(JSON.stringify({ error: '날짜를 선택해주세요.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const timeLabel = blockedTimes?.length > 0 ? ` (${blockedTimes.join(', ')})` : '';
    const autoMemo = type === '반복'
      ? `매주 ${(days ?? []).join('·')}${timeLabel}`
      : `${start}${timeLabel}`;

    const properties = {
      '메모': { title: [{ text: { content: memo || autoMemo } }] },
      '반복 유형': { select: { name: type || '일회성' } },
    };

    if (type === '반복' && days?.length > 0) {
      properties['반복 요일'] = { multi_select: days.map(d => ({ name: d })) };
    }
    if (start) {
      properties['날짜'] = { date: { start, ...(end && end !== start ? { end } : {}) } };
    }
    if (blockedTimes?.length > 0) {
      properties['차단 시간'] = { rich_text: [{ text: { content: blockedTimes.join(',') } }] };
    }

    const created = await n('POST', '/pages', {
      parent: { database_id: BLOCKED_DATES_DB_ID },
      properties,
    });

    return new Response(JSON.stringify({ id: created.id }), {
      status: 201,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // DELETE /booking/blocked/:id
  const blockedDeleteMatch = url.pathname.match(/^\/booking\/blocked\/([^/]+)$/);
  if (blockedDeleteMatch && request.method === 'DELETE') {
    const authErr = await requireJwt(request, env, corsHeaders);
    if (authErr) return authErr;

    await n('PATCH', `/pages/${blockedDeleteMatch[1]}`, { archived: true });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return errRes(corsHeaders, 404, '요청한 항목을 찾을 수 없습니다.');
}

// ===== 숙제 파일 업로드 공통 헬퍼 =====
async function uploadFileToNotion(file, notionToken) {
  const fileName = file.name || 'audio.m4a';
  const mimeType = file.type || 'audio/mpeg';
  const arrayBuffer = await file.arrayBuffer();

  // 1. Notion file_upload 세션 생성
  const sessionRes = await fetch('https://api.notion.com/v1/file_uploads', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${notionToken}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mode: 'single_part' }),
  });
  if (!sessionRes.ok) {
    const err = await sessionRes.json().catch(() => ({}));
    throw new Error(err.message || 'Notion 파일 업로드 세션 생성 실패');
  }
  const session = await sessionRes.json();
  const { id: fileUploadId, upload_url } = session;

  // 2. 파일을 upload_url로 전송
  const uploadForm = new FormData();
  uploadForm.append('file', new Blob([arrayBuffer], { type: mimeType }), fileName);
  const uploadRes = await fetch(upload_url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${notionToken}`,
      'Notion-Version': '2022-06-28',
    },
    body: uploadForm,
  });
  if (!uploadRes.ok) {
    throw new Error('Notion 파일 업로드 실패');
  }

  return { fileUploadId, fileName };
}

// ===== 숙제 라우트 핸들러 =====
async function handleHomeworkRoutes(request, env, corsHeaders, url) {
  // 학생 토큰 기반 라우트만 IP rate limit (업로드는 정상 사용량이 있어 한도 완화)
  const isStudentTokenPath = /^\/homework\/student(-upload)?\//.test(url.pathname);
  if (isStudentTokenPath) {
    const isUpload = url.pathname.startsWith('/homework/student-upload/');
    const limit = isUpload ? 30 : 60;
    if (!(await rateLimitCheck(`hw:${clientIp(request)}`, limit, 60))) {
      return errRes(corsHeaders, 429, '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
    }
  }

  const n = makeNotion(env.NOTION_TOKEN);

  // 학생 토큰으로 학생 페이지 조회 (공통)
  async function findStudentByToken(token) {
    const res = await n('POST', `/databases/${STUDENT_DB_ID}/query`, {
      filter: { property: '예약 코드', rich_text: { equals: token } },
      page_size: 1,
    });
    return res.results?.[0] ?? null;
  }

  // POST /homework/upload — 강사용 파일 업로드 (JWT 인증)
  if (url.pathname === '/homework/upload' && request.method === 'POST') {
    const authErr = await requireJwt(request, env, corsHeaders);
    if (authErr) return authErr;
    try {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!file) throw new Error('파일이 없습니다');
      const result = await uploadFileToNotion(file, env.NOTION_TOKEN);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // POST /homework/notify-assign, /homework/notify-feedback — 학생에게 카카오 알림톡 발송 (JWT 인증)
  // 템플릿 ID 또는 Solapi Secret 미설정 시 no-op, 학생 전화번호 없으면 skip
  const notifyAssign = url.pathname === '/homework/notify-assign' && request.method === 'POST';
  const notifyFeedback = url.pathname === '/homework/notify-feedback' && request.method === 'POST';
  if (notifyAssign || notifyFeedback) {
    const authErr = await requireJwt(request, env, corsHeaders);
    if (authErr) return authErr;
    const body = await request.json().catch(() => ({}));
    const homeworkId = body.homeworkId;
    if (!homeworkId) {
      return new Response(JSON.stringify({ error: 'homeworkId 필수' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const templateId = notifyAssign ? env.KAKAO_TPL_HW_ASSIGN : env.KAKAO_TPL_HW_FEEDBACK;
    try {
      const hwPage = await n('GET', `/pages/${homeworkId}`);
      const title = hwPage.properties?.['제목']?.title?.[0]?.plain_text ?? '숙제';
      const studentId = hwPage.properties?.['학생']?.relation?.[0]?.id;
      if (!studentId) {
        return new Response(JSON.stringify({ ok: false, reason: 'no_student' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const studentPage = await n('GET', `/pages/${studentId}`);
      const name = stripEmoji(studentPage.properties?.['이름']?.title?.[0]?.plain_text ?? '');
      const phone = (studentPage.properties?.['전화번호']?.phone_number ?? '').replace(/-/g, '');
      const studentToken = studentPage.properties?.['예약 코드']?.rich_text?.[0]?.plain_text ?? '';
      if (!phone) {
        return new Response(JSON.stringify({ ok: false, reason: 'no_phone' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!studentToken) {
        // 버튼 URL 변수가 비면 Kakao 발송 실패 위험 → 예약 코드 없으면 skip
        return new Response(JSON.stringify({ ok: false, reason: 'no_token' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      await sendKakaoAlert(env, {
        to: phone,
        templateId,
        variables: {
          '#{이름}': name,
          '#{숙제제목}': title,
          '#{token}': studentToken,
        },
      });
      return new Response(JSON.stringify({ ok: true, sent: !!templateId }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (e) {
      console.error('[notify-homework] 오류:', e.message);
      return new Response(JSON.stringify({ ok: false, error: e.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // POST /homework/student-upload/:token — 학생용 파일 업로드 (예약 코드 인증)
  const studentUploadMatch = url.pathname.match(/^\/homework\/student-upload\/([^/]+)$/);
  if (studentUploadMatch && request.method === 'POST') {
    const token = decodeURIComponent(studentUploadMatch[1]);
    const tv = validatePathToken(StudentTokenSchema, token, corsHeaders, '학생 토큰');
    if (!tv.ok) return tv.response;
    const studentPage = await findStudentByToken(token);
    if (!studentPage) {
      return new Response(JSON.stringify({ error: '등록된 학생이 아닙니다.' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    try {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!file) throw new Error('파일이 없습니다');
      const result = await uploadFileToNotion(file, env.NOTION_TOKEN);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // GET /homework/student/:token — 학생 숙제 목록
  const studentHomeworkMatch = url.pathname.match(/^\/homework\/student\/([^/]+)$/);
  if (studentHomeworkMatch && request.method === 'GET') {
    const token = decodeURIComponent(studentHomeworkMatch[1]);
    const tv = validatePathToken(StudentTokenSchema, token, corsHeaders, '학생 토큰');
    if (!tv.ok) return tv.response;
    const studentPage = await findStudentByToken(token);
    if (!studentPage) {
      return new Response(JSON.stringify({ error: '등록된 학생이 아닙니다.' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // 페이지네이션 처리 — 누적 숙제 100개+ 보유 시 누락 방지
    const allHomework = await queryAllNotion(n, HOMEWORK_DB_ID, {
      filter: { property: '학생', relation: { contains: studentPage.id } },
      sorts: [{ timestamp: 'created_time', direction: 'descending' }],
    });
    return new Response(JSON.stringify(allHomework), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // POST /homework/student/:token/:id/submit — 학생 숙제 제출
  const submitMatch = url.pathname.match(/^\/homework\/student\/([^/]+)\/([^/]+)\/submit$/);
  if (submitMatch && request.method === 'POST') {
    const token = decodeURIComponent(submitMatch[1]);
    const homeworkId = submitMatch[2];
    const tv = validatePathToken(StudentTokenSchema, token, corsHeaders, '학생 토큰');
    if (!tv.ok) return tv.response;
    const hv = validatePathToken(NotionPageIdSchema, homeworkId, corsHeaders, '숙제 ID');
    if (!hv.ok) return hv.response;
    const studentPage = await findStudentByToken(token);
    if (!studentPage) {
      return new Response(JSON.stringify({ error: '등록된 학생이 아닙니다.' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const rawBody = await request.json().catch(() => ({}));
    const bv = validateBody(HomeworkSubmitSchema, rawBody, corsHeaders);
    if (!bv.ok) return bv.response;
    const body = bv.data;
    // files: [{fileUploadId, fileName}] — 새로 추가할 파일 (0~20개)
    // deleteFileNames: [string] — 삭제할 기존 파일 이름 목록
    const newFiles = Array.isArray(body.files) ? body.files : [];
    const deleteFileNamesSet = new Set(Array.isArray(body.deleteFileNames) ? body.deleteFileNames : []);

    // 기존 제출 파일 조회 + 소유권 확인
    const currentPage = await fetch(`https://api.notion.com/v1/pages/${homeworkId}`, {
      headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' },
    }).then(r => r.json());
    const hwStudentIds = (currentPage.properties?.['학생']?.relation ?? []).map(r => r.id);
    if (!hwStudentIds.includes(studentPage.id)) {
      return new Response(JSON.stringify({ error: '이 숙제에 접근할 권한이 없습니다.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const keptFiles = (currentPage.properties?.['학생 제출 파일']?.files ?? [])
      .filter(f => !deleteFileNamesSet.has(f.name));

    const totalCount = keptFiles.length + newFiles.length;
    if (totalCount > 5) {
      return new Response(JSON.stringify({ error: '파일은 최대 5개까지 가능합니다.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const nowIso = new Date().toISOString();
    // 파일이 0개이면 제출 취소 (미제출로 복귀)
    const newStatus = totalCount === 0 ? '미제출' : '제출완료';
    const updateRes = await fetch(`https://api.notion.com/v1/pages/${homeworkId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          '제출 상태': { select: { name: newStatus } },
          '학생 제출 파일': {
            files: [
              ...keptFiles,
              ...newFiles.map(({ fileUploadId, fileName }) => ({
                name: fileName || 'audio.mp3',
                type: 'file_upload',
                file_upload: { id: fileUploadId },
              })),
            ],
          },
          제출일: totalCount > 0 ? { date: { start: nowIso } } : { date: null },
        },
      }),
    });
    const updateData = await updateRes.json();

    // 실제 새 파일이 업로드된 제출완료 상태일 때만 강사에게 ntfy 알림
    if (updateRes.ok && newStatus === '제출완료' && newFiles.length > 0) {
      const studentName = stripEmoji(studentPage.properties?.['이름']?.title?.[0]?.plain_text ?? '학생');
      const homeworkTitle = currentPage.properties?.['제목']?.title?.[0]?.plain_text ?? '숙제';
      const fileDesc = newFiles.length === 1 ? '파일 1개' : `파일 ${newFiles.length}개`;
      await sendNtfy(
        env,
        `${studentName} 학생이 "${homeworkTitle}" 숙제를 제출했습니다. (${fileDesc})`,
        '숙제 제출'
      );
    }

    return new Response(JSON.stringify(updateData), {
      status: updateRes.ok ? 200 : updateRes.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: '요청한 항목을 찾을 수 없습니다.' }), {
    status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ===== 클라이언트 에러 수집 (PWA window.onerror → 여기로 POST) =====
async function handleErrorLog(request, env, corsHeaders) {
  // Abuse 방지: IP당 분당 10건만 ntfy로 전달 (초과분은 조용히 200으로 무시)
  const allowed = await rateLimitCheck(`errlog:${clientIp(request)}`, 10, 60);
  let body = {};
  try { body = await request.json(); } catch { /* ignore */ }
  if (!allowed) {
    return new Response(JSON.stringify({ ok: true, throttled: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const message = String(body.message || 'unknown error').slice(0, 400);
  const source = String(body.source || '').slice(0, 200);
  const lineno = body.lineno != null ? String(body.lineno).slice(0, 10) : '';
  const colno = body.colno != null ? String(body.colno).slice(0, 10) : '';
  const stack = String(body.stack || '').split('\n').slice(0, 6).join('\n').slice(0, 1000);
  const pageUrl = String(body.url || '').slice(0, 300);
  const userAgent = String(body.userAgent || request.headers.get('User-Agent') || '').slice(0, 200);
  const studentToken = String(body.studentToken || '').slice(0, 64);

  // dedup key: 같은 메시지+경로 조합은 5분에 한 번만 알림 (폭주 방지)
  const dedupKey = `client:${message}:${pageUrl}`;

  const lines = [
    `📍 ${pageUrl || '(URL 없음)'}`,
    `💬 ${message}`,
    source ? `📄 ${source}${lineno ? `:${lineno}` : ''}${colno ? `:${colno}` : ''}` : '',
    studentToken ? `👤 학생 토큰: ${studentToken.slice(0, 8)}...` : '',
    `🌐 ${userAgent.slice(0, 100)}`,
    stack ? `\n${stack}` : '',
  ].filter(Boolean);

  await sendAlert(env, {
    level: 'warn',
    title: `⚠️ PWA 클라이언트 에러`,
    message: lines.join('\n'),
    tags: ['warning', 'client'],
    dedupKey,
    ttlSeconds: 300,
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// 모든 라우팅 로직을 여기 위임. throw된 unhandled exception은 default.fetch에서 캡처.
async function handleFetch(request, env, ctx) {
  const url = new URL(request.url);

    // Notion 웹훅은 CORS/인증 체크 없이 별도 처리
    if (url.pathname === '/notion-webhook' && request.method === 'POST') {
      return handleNotionWebhook(request, env, ctx);
    }

    // OG 이미지 프록시 — <img src> 요청은 Origin 헤더가 없어서 CORS 체크 전에 처리
    if (url.pathname === '/og-proxy/image' && request.method === 'GET') {
      const imageUrl = url.searchParams.get('url');
      const referer = url.searchParams.get('referer') || '';
      if (!imageUrl) return new Response('url 파라미터 필요', { status: 400 });
      // SSRF 방어: 사설망/메타데이터/IP 직접 표기 차단
      if (!isSafeExternalUrl(imageUrl)) return new Response('forbidden url', { status: 403 });
      if (referer && !isSafeExternalUrl(referer)) return new Response('forbidden referer', { status: 403 });
      // 간단한 IP 기반 rate limit (분당 60건)
      if (!(await rateLimitCheck(`og-img:${clientIp(request)}`, 60, 60))) {
        return new Response('too many requests', { status: 429 });
      }
      try {
        const { res, buffer } = await fetchWithLimit(imageUrl, {
          headers: {
            'Referer': referer,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        }, 5 * 1024 * 1024);
        const contentType = res.headers.get('Content-Type') || 'image/jpeg';
        // 이미지 외 콘텐츠 타입 거부 (HTML/JS 등 다른 데이터 누설 차단)
        if (!/^image\//i.test(contentType)) {
          return new Response('not an image', { status: 415 });
        }
        return new Response(buffer, {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=86400',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch (e) {
        return new Response('이미지 로드 실패', { status: 500 });
      }
    }

    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.has(origin) || (env.ALLOWED_ORIGIN && origin === env.ALLOWED_ORIGIN) || /^https:\/\/[a-z0-9-]+\.tiantian-chinese\.pages\.dev$/.test(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);

    const corsHeaders = {
      'Access-Control-Allow-Origin': allowed ? origin : '',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!allowed) {
      return new Response(JSON.stringify({ error: '허용되지 않은 출처입니다.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 클라이언트 JS 에러 수집 (공개, 인증 불필요)
    if (url.pathname === '/error-log' && request.method === 'POST') {
      return handleErrorLog(request, env, corsHeaders);
    }

    // 예약 시스템 라우트 (공개 + 강사 인증 혼재, 내부에서 분기)
    if (url.pathname.startsWith('/booking')) {
      return handleBookingRoutes(request, env, corsHeaders, url);
    }

    // 숙제 라우트 (공개 학생용 + 강사 JWT 인증 혼재)
    if (url.pathname.startsWith('/homework')) {
      return handleHomeworkRoutes(request, env, corsHeaders, url);
    }

    // 무료상담 신청 (공개, 인증 불필요)
    if (url.pathname === '/consult' && request.method === 'POST') {
      return handleConsultRequest(request, env, corsHeaders);
    }

    // 추천 링크 트래킹 (공개) — GET /referral/track?ref=STUDENT_TOKEN
    // 친구가 추천 링크를 클릭했을 때 호출. 학생의 '추천 보너스' +5 적립.
    // 최대 한도(100)를 초과하지 않는 범위 내에서만 적립.
    //
    // 서버측 중복 방지: Cloudflare Cache API를 이용해 (IP + ref) 조합 기준
    // 24시간 내 중복 적립을 차단. 브라우저 localStorage 우회(curl/incognito)를
    // 방지하기 위한 최소 방어선이며, IP를 돌려가며 시도하면 여전히 가능하지만
    // 자동 부스팅 비용을 크게 올린다.
    if (url.pathname === '/referral/track' && request.method === 'GET') {
      const ref = url.searchParams.get('ref') || '';
      if (!ref) return errRes(corsHeaders, 400, 'ref 파라미터가 필요합니다.');

      const okResponse = () => new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

      // (IP, ref) 조합 해시로 dedup key 생성
      const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
      const dedupInput = new TextEncoder().encode(`${ip}|${ref}`);
      const dedupHashBuf = await crypto.subtle.digest('SHA-256', dedupInput);
      const dedupHash = Array.from(new Uint8Array(dedupHashBuf))
        .map((b) => b.toString(16).padStart(2, '0')).join('');
      const dedupKey = new Request(
        new URL(`/_internal/referral-dedup/${dedupHash}`, request.url).toString(),
        { method: 'GET' }
      );
      const cache = caches.default;
      const already = await cache.match(dedupKey);
      if (already) {
        // 동일 IP가 24시간 내 재시도: 조용히 성공 반환 (공격자에게 dedup 노출 안 함)
        return okResponse();
      }

      const n = makeNotion(env.NOTION_TOKEN);
      const studentRes = await n('POST', `/databases/${STUDENT_DB_ID}/query`, {
        filter: { property: '예약 코드', rich_text: { equals: ref } },
        page_size: 1,
      });
      const page = studentRes.results?.[0];
      if (!page) {
        // 존재하지 않는 토큰이어도 조용히 성공 반환 (정보 노출 방지)
        return okResponse();
      }

      const current = page.properties?.['추천 보너스']?.number ?? 0;
      const MAX_REFERRAL_BONUS = 100;
      const BONUS_PER_REFERRAL = 5;
      if (current < MAX_REFERRAL_BONUS) {
        const newBonus = Math.min(current + BONUS_PER_REFERRAL, MAX_REFERRAL_BONUS);
        await n('PATCH', `/pages/${page.id}`, {
          properties: { '추천 보너스': { number: newBonus } },
        });
      }

      // dedup 마킹: 24시간 TTL. Notion 업데이트 성공 후에만 마킹해 실패 시 재시도 가능.
      await cache.put(
        dedupKey,
        new Response('1', {
          headers: { 'Cache-Control': 'public, max-age=86400' },
        }),
      );

      return okResponse();
    }

    // OG 메타태그 파싱 프록시 — GET /og-proxy?url=<encoded>
    if (url.pathname === '/og-proxy' && request.method === 'GET') {
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl) {
        return new Response(JSON.stringify({ error: 'url 파라미터가 필요합니다.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // SSRF 방어 + rate limit (분당 30건)
      if (!isSafeExternalUrl(targetUrl)) {
        return new Response(JSON.stringify({ error: 'forbidden url' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!(await rateLimitCheck(`og:${clientIp(request)}`, 30, 60))) {
        return new Response(JSON.stringify({ error: 'too many requests' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      try {
        // redirect 직접 처리: 따라가되 매 단계마다 SSRF 재검증
        let currentUrl = targetUrl;
        let res;
        for (let hop = 0; hop < 3; hop++) {
          res = await fetch(currentUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
              'Accept': 'text/html,application/xhtml+xml',
              'Accept-Language': 'ko-KR,ko;q=0.9',
            },
            redirect: 'manual',
          });
          if (res.status >= 300 && res.status < 400) {
            const loc = res.headers.get('Location');
            if (!loc) break;
            const next = new URL(loc, currentUrl).toString();
            if (!isSafeExternalUrl(next)) {
              return new Response(JSON.stringify({ error: 'redirect to forbidden host' }), {
                status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              });
            }
            currentUrl = next;
            continue;
          }
          break;
        }
        // HTML만 처리 (다른 콘텐츠 타입 누설 방지)
        const ct = res.headers.get('Content-Type') || '';
        if (!/text\/html|application\/xhtml/i.test(ct)) {
          return new Response(JSON.stringify({ error: 'not an html page' }), {
            status: 415, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        // 본문 1MB 제한
        const reader = res.body?.getReader();
        let html = '';
        if (reader) {
          const dec = new TextDecoder();
          let total = 0;
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > 1024 * 1024) { try { reader.cancel(); } catch {} break; }
            html += dec.decode(value, { stream: true });
          }
        }

        function getOg(prop) {
          return (
            html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))?.[1] ||
            html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`, 'i'))?.[1] ||
            null
          );
        }
        function getMeta(name) {
          return (
            html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'))?.[1] ||
            html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, 'i'))?.[1] ||
            null
          );
        }
        const pageTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || null;

        const title = getOg('title') || getMeta('title') || pageTitle;
        const description = getOg('description') || getMeta('description');
        let image = getOg('image');

        // 이미지가 있으면 Worker 이미지 프록시로 래핑 (hotlink 차단 우회)
        if (image) {
          const origin = new URL(request.url).origin;
          image = `${origin}/og-proxy/image?url=${encodeURIComponent(image)}&referer=${encodeURIComponent(targetUrl)}`;
        }

        return new Response(JSON.stringify({ title, description, image, url: targetUrl }), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // 로그인 엔드포인트: POST /auth/login
    if (url.pathname === '/auth/login' && request.method === 'POST') {
      // Brute-force 방어: IP당 5분 윈도우에 최대 10회 시도
      if (!(await rateLimitCheck(`login:${clientIp(request)}`, 10, 300))) {
        return new Response(JSON.stringify({ error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { password } = await request.json().catch(() => ({}));
      if (!env.AUTH_PASSWORD || password !== env.AUTH_PASSWORD) {
        return new Response(JSON.stringify({ error: '비밀번호가 틀렸습니다.' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!env.JWT_SECRET) {
        console.warn('[보안 경고] JWT_SECRET 미설정. AUTH_PASSWORD를 JWT 서명 키로 사용 중. npx wrangler secret put JWT_SECRET 실행 권장.');
      }
      // 토큰 유효기간 30일 — localStorage 저장으로 강사 로그인 유지
      const token = await createToken(env.JWT_SECRET || env.AUTH_PASSWORD, 30 * 24 * 60 * 60);
      return new Response(JSON.stringify({ token }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 나머지 모든 요청: Bearer 토큰 검증
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const valid = await verifyToken(token, env.JWT_SECRET || env.AUTH_PASSWORD);
    if (!valid) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Notion API 프록시 경로 화이트리스트 (실제 사용 경로만 허용)
    const ALLOWED_NOTION_PATHS = ['/v1/databases/', '/v1/pages', '/v1/pages/'];
    const isAllowedPath = ALLOWED_NOTION_PATHS.some(prefix => url.pathname === prefix || url.pathname.startsWith(prefix));
    if (!isAllowedPath) {
      return new Response(JSON.stringify({ error: '허용되지 않은 경로입니다.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // /v1/databases/:id/* 형식이면 :id가 우리 코드에서 사용하는 DB 화이트리스트에 있어야 함.
    // 강사 토큰이 유출돼도 임의 워크스페이스 DB로의 horizontal access를 차단.
    const dbMatch = url.pathname.match(/^\/v1\/databases\/([a-z0-9-]+)/i);
    if (dbMatch) {
      const dbId = dbMatch[1].replace(/-/g, '').toLowerCase();
      if (!ALLOWED_NOTION_DB_IDS.has(dbId)) {
        return new Response(JSON.stringify({ error: '허용되지 않은 DB입니다.' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const notionUrl = `https://api.notion.com${url.pathname}${url.search}`;

    let body;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      body = await request.text();
    }

    const notionResponse = await fetch(notionUrl, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: body || undefined,
    });

    const responseText = await notionResponse.text();

    return new Response(responseText, {
      status: notionResponse.status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleFetch(request, env, ctx);
    } catch (err) {
      // unhandled exception → critical 알림 (dedup으로 폭주 방지)
      // ctx.waitUntil로 알림 발송이 응답을 막지 않도록 처리
      ctx.waitUntil(captureWorkerError(err, env, request).catch(() => {}));
      console.error('[unhandled]', err?.stack || err);
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
