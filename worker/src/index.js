// 순수 함수는 lib/로 분리되어 단위 테스트 대상.
// 새 순수 함수 추가 시 lib/ 안에 두고 여기서 import.
import { stripEmoji, normalizeId, normalizePhone } from '../lib/string.js';
import { isSafeExternalUrl, maskPhone, maskToken } from '../lib/security.js';
import { validateFileUpload, resolveFileMime, dedupeFileNames } from '../lib/upload.js';
import {
  ConsultSchema,
  HomeworkSubmitSchema,
  StudentTokenSchema,
  NotionPageIdSchema,
  MyClassesQuerySchema,
  GameKeySchema,
  GameResultSchema,
  ToneDifficultySchema,
} from '../lib/schemas.js';
import { validateBody, validateParams, validatePathToken } from '../lib/validation.js';

const CLASS_DB_ID = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';
const STUDENT_DB_ID = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';
const HOMEWORK_DB_ID = '5ce7d5ef-7b80-4795-843f-325f4ca868e2';

// ===== 예약 시스템 DB =====
const BLOCKED_DATES_DB_ID = '31e838fa-f2a6-81d3-b034-c47a4f0e5f3e';

// ===== 무료상담 신청 DB =====
const CONSULT_DB_ID = '324838fa-f2a6-815d-99a7-ff165e8f78aa';

// ===== 미니게임 베스트 DB (학생 × 게임 = 1 row) =====
const GAME_BEST_DB_ID = '2602021c-39b5-4517-9eda-ce4808f570bd';

// ===== 게임 계정 DB (독립실행·회원/게스트, 전화번호=주 정체성) =====
const GAME_USERS_DB_ID = 'd9c69797-2daf-4d89-8f9a-e4a4e0cbc969';

// ===== 성조 게임 단어 DB (난이도별 출제 풀) =====
const TONE_WORDS_DB_ID = '6e6956bf-4d48-4d63-adf2-778f056529df';

// 난이도 키(영문) ↔ Notion '난이도' select 옵션(한글) 매핑.
const TONE_DIFFICULTY_TO_NAME = {
  'easy': '초급',
  'normal': '중급',
  'hard': '고급',
};

// 게임 키 ↔ Notion '게임' select 옵션 이름 매핑.
// 새 게임/난이도 추가 시: (1) Notion DB 'select' 옵션 추가, (2) 여기 매핑 추가, (3) GameKeySchema enum에 키 추가.
// 'tone'은 레거시(난이도 도입 전), 'tone-easy/normal/hard'는 난이도별 분리.
const GAME_KEY_TO_NAME = {
  'tone': '성조 찾기',
  'tone-easy': '성조 찾기 (초급)',
  'tone-normal': '성조 찾기 (중급)',
  'tone-hard': '성조 찾기 (고급)',
};
const GAME_NAME_TO_KEY = {
  '성조 찾기': 'tone',
  '성조 찾기 (초급)': 'tone-easy',
  '성조 찾기 (중급)': 'tone-normal',
  '성조 찾기 (고급)': 'tone-hard',
};

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
const GAME_BEST_DB_RAW = GAME_BEST_DB_ID.replace(/-/g, '');
const GAME_USERS_DB_RAW = GAME_USERS_DB_ID.replace(/-/g, '');
const TONE_WORDS_DB_RAW = TONE_WORDS_DB_ID.replace(/-/g, '');
const ALLOWED_NOTION_DB_IDS = new Set([
  STUDENT_DB_RAW,
  CLASS_DB_RAW,
  HOMEWORK_DB_RAW,
  BLOCKED_DATES_DB_RAW,
  CONSULT_DB_RAW,
  GAME_BEST_DB_RAW,
  GAME_USERS_DB_RAW,
  TONE_WORDS_DB_RAW,
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

// ===== 게임 계정(독립실행) 인증 헬퍼 — 휴대폰 OTP + 게임유저 JWT =====

// 게임유저 JWT — 강사용 createToken과 달리 sub(유저 페이지ID)를 담는다. HMAC-SHA256.
async function createGameToken(secret, sub, expSeconds) {
  const payload = btoa(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + expSeconds }));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${payload}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;
}
// 게임유저 JWT 검증 → claim {sub, exp} 또는 null(만료/위조)
async function verifyGameToken(token, secret) {
  const parts = (token || '').split('.');
  if (parts.length !== 2 || !secret) return null;
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sigBytes = Uint8Array.from(atob(parts[1]), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(parts[0]));
    if (!valid) return null;
    const claim = JSON.parse(atob(parts[0]));
    return claim.exp > Math.floor(Date.now() / 1000) ? claim : null;
  } catch { return null; }
}

// OTP 임시저장 (Cloudflare Cache API, 3분 TTL — KV 없이)
function otpCacheKey(phone) { return new Request(`https://gameotp.local/${encodeURIComponent(phone)}`); }
async function putGameOtp(phone, code) {
  try { await caches.default.put(otpCacheKey(phone), new Response(code, { headers: { 'Cache-Control': 'public, max-age=180' } })); } catch { /* noop */ }
}
async function getGameOtp(phone) {
  try { const h = await caches.default.match(otpCacheKey(phone)); return h ? (await h.text()) : null; } catch { return null; }
}
async function clearGameOtp(phone) {
  try { await caches.default.delete(otpCacheKey(phone)); } catch { /* noop */ }
}

// 솔라피 일반 SMS 발송 (현재 미사용 — 게임 OTP는 알림톡 채널명 발송으로 발신번호 노출 회피).
// 향후 발신전용번호 SMS fallback 등이 필요하면 재사용. 발신번호 env.SOLAPI_SENDER 필요(사전등록). 미설정 시 no-op.
// eslint-disable-next-line no-unused-vars
async function sendSms(env, to, text) {
  if (!env.SOLAPI_API_KEY || !env.SOLAPI_API_SECRET || !env.SOLAPI_SENDER || !to) { console.log('[sms] 미설정 — 스킵'); return; }
  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const signature = await hmacSha256Hex(env.SOLAPI_API_SECRET, date + salt);
  try {
    const res = await fetch('https://api.solapi.com/messages/v4/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `HMAC-SHA256 apiKey=${env.SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}` },
      body: JSON.stringify({ message: { to, from: env.SOLAPI_SENDER, text } }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); console.error('[sms] 발송 실패:', JSON.stringify(d)); }
  } catch (e) { console.error('[sms] 발송 오류:', e.message); }
}

// GAME_USERS 페이지 파싱
function parseGameUser(page) {
  const p = page.properties || {};
  let gameData = {};
  try { gameData = JSON.parse(p['게임데이터']?.rich_text?.[0]?.plain_text || '{}'); } catch { /* noop */ }
  return {
    id: page.id,
    phone: p['전화번호']?.phone_number || null,
    nickname: p['닉네임']?.rich_text?.[0]?.plain_text || null,
    studentToken: p['연결된 학생 토큰']?.rich_text?.[0]?.plain_text || null,
    gameData,
  };
}

// 전화번호로 게임 계정 find-or-create. 신규면 학생 DB 전화번호 매칭으로 학생 토큰 자동 연결(같은 사람이면 기록 동기화).
async function findOrCreateGameUser(n, phone) {
  const q = await n('POST', `/databases/${GAME_USERS_DB_ID}/query`, {
    filter: { property: '전화번호', phone_number: { equals: phone } }, page_size: 1,
  });
  if (q.results?.[0]) return parseGameUser(q.results[0]);
  let studentToken = null;
  try {
    const sq = await n('POST', `/databases/${STUDENT_DB_ID}/query`, {
      filter: { property: '전화번호', phone_number: { equals: phone } }, page_size: 1,
    });
    studentToken = sq.results?.[0]?.properties?.['예약 코드']?.rich_text?.[0]?.plain_text || null;
  } catch { /* noop */ }
  const userId = crypto.randomUUID();
  const created = await n('POST', '/pages', {
    parent: { database_id: GAME_USERS_DB_ID },
    properties: {
      '유저ID': { title: [{ text: { content: userId } }] },
      '전화번호': { phone_number: phone },
      '가입수단': { select: { name: '휴대폰' } },
      '최종접속': { date: { start: new Date().toISOString() } },
      ...(studentToken ? { '연결된 학생 토큰': { rich_text: [{ text: { content: studentToken } }] } } : {}),
    },
  });
  return parseGameUser(created);
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

  // 중복 신청 마킹 — 차단하지 않고, 같은 전화번호로 최근 7일 내 신청 건수를 세서 강사 ntfy 알림 상단에 표시.
  // 학생은 항상 신청 성공하지만 강사는 푸시 보고 한눈에 중복 여부 판단 가능.
  // Notion 조회 실패 시 0으로 fallback (신청 흐름은 그대로 진행).
  let recentDuplicateCount = 0;
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const n = makeNotion(env.NOTION_TOKEN);
    const dup = await n('POST', `/databases/${dbId}/query`, {
      filter: {
        and: [
          { property: '전화번호', rich_text: { equals: phoneDigits } },
          { timestamp: 'created_time', created_time: { on_or_after: sevenDaysAgo } },
        ],
      },
      page_size: 100,
    });
    if (Array.isArray(dup.results)) recentDuplicateCount = dup.results.length;
  } catch (e) {
    console.error('[consult] 중복 조회 실패 — 0으로 처리:', e);
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
    recentDuplicateCount > 0
      ? `⚠️ 최근 7일 내 동일 번호 ${recentDuplicateCount}건 신청 이력 있음`
      : null,
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

  // ntfy 푸시 알림 (카카오 알림톡과 이중 발송). GitHub Actions 우회라 5~15초 지연 있지만,
  // 카카오 알림톡 템플릿은 솔라피 검수가 필요해서 자유롭게 수정 어려운 점을 ntfy로 보완.
  // sendNtfy 내부에서 try/catch 처리되므로 실패해도 응답 흐름 영향 없음.
  await sendNtfy(env, ntfyMsg, '📩 무료상담 신청');

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

    // 학생페이지 공유 시점 — 강사가 StudentDetailPage에서 "학생 페이지 공유" 버튼을 처음 누를 때
    // PWA(markStudentSharedIfEmpty)가 기록한 학생 DB의 "공유일" 속성.
    // 판다 먹이(수업시간 30분당 1개)는 이 시점 이후의 완료 수업만 카운트.
    // 학생이 페이지를 늦게 본 경우에도 그 사이 수업 시간이 먹이로 누적된다.
    // 공유일이 비어 있으면 → completedMinutes=0 (공유 전에는 먹이가 쌓이지 않음).
    // PandaWidget이 totalFood로 localStorage EXP를 cap하므로 기존 학생 먹이는 자동으로 0으로 리셋된다.
    const nowISO = new Date().toISOString();
    const sharedAt = props?.['공유일']?.date?.start ?? null;

    // 완료된 유료 수업의 시간 합계 (취소·보강 제외, 예정 제외)
    // 분 단위로 누적해 부동소수 오차를 피한다.
    //   completedMinutesAll : 잔여 시간(remainingHours) 계산용 — 전체 기간
    //   completedMinutes    : 팬더 먹이 계산용 — 공유 시점(sharedAt) 이후만 집계
    const paidHours = props?.['결제 시간 회차 합계']?.rollup?.number ?? 0;
    const sharedTs = sharedAt ? new Date(sharedAt).getTime() : null;
    let completedMinutesAll = 0;
    let completedMinutes = 0;
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
        if (!minStr) continue;
        const min = parseInt(minStr, 10);
        completedMinutesAll += min;
        if (sharedTs == null) continue; // 공유 전: 먹이 0
        const dt = cls.properties?.['수업 일시']?.date?.start;
        const dtTs = dt ? new Date(dt).getTime() : null;
        if (dtTs != null && dtTs >= sharedTs) {
          completedMinutes += min;
        }
      }
      classCursor = classRes.has_more ? classRes.next_cursor : undefined;
    } while (classCursor);

    const remainingHours = Math.max(0, paidHours - completedMinutesAll / 60);

    return new Response(JSON.stringify({
      id: page.id,
      name: stripEmoji(rawName),
      phone: props?.['전화번호']?.phone_number ?? '',
      remainingSessions: props?.['잔여 시간 회차']?.formula?.number ?? 0,
      totalSessions: props?.['총 수업 횟수']?.rollup?.number ?? 0,
      remainingHours,
      paidHours,
      completedMinutes,
      sharedAt,
      // 숙제 먹이: 노션 학생 DB rollup이 자동 합산. PWA가 sharedAt 게이팅 적용.
      submittedHomeworkFood: props?.['숙제 제출 먹이']?.rollup?.number ?? 0,
      feedbackSeenHomeworkFood: props?.['피드백 확인 먹이']?.rollup?.number ?? 0,
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
  const fileName = file.name || 'file';
  // Notion이 받는 Content-Type은 표준 MIME이어야 한다.
  // MediaRecorder의 `audio/webm;codecs=opus` 처럼 codec 파라미터가 붙으면 Notion이 거부하고,
  // Windows·iOS 등에서 file.type이 빈 문자열일 때도 확장자 기반으로 보정해야 한다.
  // resolveFileMime이 음성·이미지·PDF 모두 처리한다.
  const mimeType = resolveFileMime(file);
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
    throw new Error(err.message || `Notion 파일 업로드 세션 생성 실패 (${sessionRes.status})`);
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
    // 디버깅 정보 강화 — 다음 재발 시 정확한 거부 사유(MIME/size/format)를 확인할 수 있도록
    // 응답 본문 일부를 메시지에 포함. (PWA 토스트 표시 길이 보호용으로 200자 절단)
    const errBody = await uploadRes.text().catch(() => '');
    throw new Error(`Notion 파일 업로드 실패 (${uploadRes.status}, mime=${mimeType}): ${errBody.slice(0, 200)}`);
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

  // Notion 파일을 attachment 응답으로 스트림 — URL 만료(7일)·소유권 누출 방지를 위해 클라엔
  // Notion 임시 URL을 노출하지 않고 항상 Worker proxy를 통해 다운로드한다.
  async function streamNotionFile(sourceUrl, fileName) {
    const upstream = await fetch(sourceUrl);
    if (!upstream.ok || !upstream.body) {
      return errRes(corsHeaders, 502, '파일을 가져올 수 없습니다.');
    }
    const contentType = upstream.headers.get('Content-Type') || 'application/octet-stream';
    const contentLength = upstream.headers.get('Content-Length');
    // RFC 5987 한글 파일명 인코딩 (ASCII fallback + filename*= UTF-8)
    const asciiName = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
    const dispo = `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
    const headers = {
      ...corsHeaders,
      'Content-Type': contentType,
      'Content-Disposition': dispo,
      'Cache-Control': 'private, no-store',
    };
    if (contentLength) headers['Content-Length'] = contentLength;
    return new Response(upstream.body, { status: 200, headers });
  }

  // POST /homework/upload — 강사용 파일 업로드 (JWT 인증)
  if (url.pathname === '/homework/upload' && request.method === 'POST') {
    const authErr = await requireJwt(request, env, corsHeaders);
    if (authErr) return authErr;
    try {
      const formData = await request.formData();
      const file = formData.get('file');
      // JWT 신뢰하더라도 토큰 탈취·잘못된 클라이언트 발송 대비해 동일 검증.
      const v = validateFileUpload(file);
      if (!v.ok) return errRes(corsHeaders, v.status, v.error);
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

  // GET /homework/:hwId/file?name=&kind=submit|feedback — 강사용 파일 다운로드 (JWT 인증)
  // proxy 방식 — 클라이언트가 Notion 임시 URL을 절대 보지 못하게 항상 Worker 경유.
  const teacherFileMatch = url.pathname.match(/^\/homework\/([^/]+)\/file$/);
  if (teacherFileMatch && request.method === 'GET') {
    const authErr = await requireJwt(request, env, corsHeaders);
    if (authErr) return authErr;
    const homeworkId = teacherFileMatch[1];
    const hv = validatePathToken(NotionPageIdSchema, homeworkId, corsHeaders, '숙제 ID');
    if (!hv.ok) return hv.response;
    const fileName = url.searchParams.get('name') || '';
    const kind = url.searchParams.get('kind');
    if (!fileName || fileName.length > 256) {
      return errRes(corsHeaders, 400, 'name 쿼리 파라미터가 필요합니다.');
    }
    if (kind !== 'submit' && kind !== 'feedback' && kind !== 'assignment') {
      return errRes(corsHeaders, 400, 'kind는 submit / feedback / assignment 이어야 합니다.');
    }
    try {
      const hwPage = await n('GET', `/pages/${homeworkId}`);
      const propName = kind === 'submit' ? '학생 제출 파일'
                     : kind === 'feedback' ? '피드백 파일'
                     : '과제 파일';
      const files = hwPage.properties?.[propName]?.files ?? [];
      const target = files.find(f => f.name === fileName);
      if (!target) return errRes(corsHeaders, 404, '파일을 찾을 수 없습니다.');
      const sourceUrl = target.file?.url || target.external?.url;
      if (!sourceUrl) return errRes(corsHeaders, 500, '파일 URL을 얻을 수 없습니다.');
      return await streamNotionFile(sourceUrl, fileName);
    } catch (e) {
      return errRes(corsHeaders, 500, e.message);
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
      // 익명 라우트라 검증 핵심: size 상한(Notion 20 MiB) + MIME 화이트리스트.
      const v = validateFileUpload(file);
      if (!v.ok) return errRes(corsHeaders, v.status, v.error);
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
    // 피드백완료 후에는 학생 수정 차단 — 파일 추가·삭제 모두 거부.
    const currentStatus = currentPage.properties?.['제출 상태']?.select?.name;
    if (currentStatus === '피드백완료') {
      return new Response(JSON.stringify({ error: '강사 피드백이 완료되어 더 이상 수정할 수 없습니다.' }), {
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
    // 동명 파일 충돌 방지 — 다운로드/미리보기가 파일을 이름으로 식별하므로(노션 files 속성은
    // 동명 파일을 허용) 같은 이름이 둘 이상이면 전부 첫 번째로만 조회되는 버그가 생긴다.
    // 기존 파일 이름은 보존되고(먼저 옴) 새 파일에만 ` (2)` 접미사가 붙어 유일화된다.
    const mergedFiles = [
      ...keptFiles,
      ...newFiles.map(({ fileUploadId, fileName }) => ({
        name: fileName || 'audio.mp3',
        type: 'file_upload',
        file_upload: { id: fileUploadId },
      })),
    ];
    const mergedNames = dedupeFileNames(mergedFiles.map(f => f.name));
    mergedFiles.forEach((f, i) => { f.name = mergedNames[i]; });
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
            files: mergedFiles,
          },
          제출일: totalCount > 0 ? { date: { start: nowIso } } : { date: null },
          // 학생 첫 제출 시점만 기록 — 이후 파일 추가/삭제로는 갱신되지 않아 먹이 중복 지급 방지.
          ...(totalCount > 0 && !currentPage.properties?.['제출 먹이 마크']?.date?.start
            ? { '제출 먹이 마크': { date: { start: nowIso } } }
            : {}),
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

  // GET /homework/student/:token/:hwId/file?name=&kind=submit|feedback — 학생 파일 다운로드 (예약 코드 인증)
  // proxy 방식 — 클라이언트는 Notion 임시 URL을 보지 못함. 소유권(학생-숙제 relation) 검증 필수.
  const studentFileMatch = url.pathname.match(/^\/homework\/student\/([^/]+)\/([^/]+)\/file$/);
  if (studentFileMatch && request.method === 'GET') {
    const token = decodeURIComponent(studentFileMatch[1]);
    const homeworkId = studentFileMatch[2];
    const tv = validatePathToken(StudentTokenSchema, token, corsHeaders, '학생 토큰');
    if (!tv.ok) return tv.response;
    const hv = validatePathToken(NotionPageIdSchema, homeworkId, corsHeaders, '숙제 ID');
    if (!hv.ok) return hv.response;
    const fileName = url.searchParams.get('name') || '';
    const kind = url.searchParams.get('kind');
    if (!fileName || fileName.length > 256) {
      return errRes(corsHeaders, 400, 'name 쿼리 파라미터가 필요합니다.');
    }
    if (kind !== 'submit' && kind !== 'feedback' && kind !== 'assignment') {
      return errRes(corsHeaders, 400, 'kind는 submit / feedback / assignment 이어야 합니다.');
    }
    const studentPage = await findStudentByToken(token);
    if (!studentPage) return errRes(corsHeaders, 404, '등록된 학생이 아닙니다.');
    try {
      const hwPage = await n('GET', `/pages/${homeworkId}`);
      // 소유권: 이 숙제가 그 학생 것인지 relation 검증.
      const hwStudentIds = (hwPage.properties?.['학생']?.relation ?? []).map(r => r.id);
      if (!hwStudentIds.includes(studentPage.id)) {
        return errRes(corsHeaders, 403, '이 숙제에 접근할 권한이 없습니다.');
      }
      const propName = kind === 'submit' ? '학생 제출 파일'
                     : kind === 'feedback' ? '피드백 파일'
                     : '과제 파일';
      const files = hwPage.properties?.[propName]?.files ?? [];
      const target = files.find(f => f.name === fileName);
      if (!target) return errRes(corsHeaders, 404, '파일을 찾을 수 없습니다.');
      const sourceUrl = target.file?.url || target.external?.url;
      if (!sourceUrl) return errRes(corsHeaders, 500, '파일 URL을 얻을 수 없습니다.');
      return await streamNotionFile(sourceUrl, fileName);
    } catch (e) {
      return errRes(corsHeaders, 500, e.message);
    }
  }

  // POST /homework/feedback-seen/:token — 학생이 피드백완료 숙제를 처음 열어본 시점 기록
  // body: { homeworkId } — 두 번째 호출부터는 idempotent하게 스킵 (먹이 중복 방지)
  const feedbackSeenMatch = url.pathname.match(/^\/homework\/feedback-seen\/([^/]+)$/);
  if (feedbackSeenMatch && request.method === 'POST') {
    const token = decodeURIComponent(feedbackSeenMatch[1]);
    const tv = validatePathToken(StudentTokenSchema, token, corsHeaders, '학생 토큰');
    if (!tv.ok) return tv.response;
    const body = await request.json().catch(() => ({}));
    const homeworkId = body.homeworkId;
    const hv = validatePathToken(NotionPageIdSchema, homeworkId, corsHeaders, '숙제 ID');
    if (!hv.ok) return hv.response;
    const studentPage = await findStudentByToken(token);
    if (!studentPage) {
      return new Response(JSON.stringify({ error: '등록된 학생이 아닙니다.' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const hwPage = await n('GET', `/pages/${homeworkId}`);
    const hwStudentIds = (hwPage.properties?.['학생']?.relation ?? []).map(r => r.id);
    if (!hwStudentIds.includes(studentPage.id)) {
      return new Response(JSON.stringify({ error: '이 숙제에 접근할 권한이 없습니다.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const status = hwPage.properties?.['제출 상태']?.select?.name;
    const already = hwPage.properties?.['피드백 확인일']?.date?.start;
    // 피드백완료 상태이고 아직 확인일이 비어있을 때만 기록 (race condition: 동시 호출이 와도 두 번째는 skip)
    if (status === '피드백완료' && !already) {
      await n('PATCH', `/pages/${homeworkId}`, {
        properties: { '피드백 확인일': { date: { start: new Date().toISOString() } } },
      });
      return new Response(JSON.stringify({ ok: true, recorded: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true, recorded: false }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: '요청한 항목을 찾을 수 없습니다.' }), {
    status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ===== 미니게임 베스트 라우트 (학생 토큰 기반 공개 API) =====
//
// GET  /game/best/:token              → 학생의 모든 게임 베스트 [{ gameKey, ... }]
// GET  /game/best/:token/:gameKey     → 특정 게임 베스트 (없으면 null)
// POST /game/best/:token/:gameKey     → 결과 1회 저장 + 베스트 비교
//
// Body (POST): { score, maxCombo, avgMs, meta? } — GameResultSchema로 검증.
// 응답 (POST): { isNewBest: bool, best: { ... } }
//
// 새 게임 추가 절차:
//  1. Notion DB '게임' select에 옵션 추가
//  2. GAME_KEY_TO_NAME / GAME_NAME_TO_KEY 매핑 추가
//  3. GameKeySchema enum에 키 추가
async function handleGameRoutes(request, env, corsHeaders, url) {
  // IP당 분당 60회 rate limit
  if (!(await rateLimitCheck(`game:${clientIp(request)}`, 60, 60))) {
    return errRes(corsHeaders, 429, '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
  }

  const n = makeNotion(env.NOTION_TOKEN);

  // GET /game/tone-words/:difficulty  (공개, 토큰 불필요)
  // 모든 학생에게 동일한 단어 풀이라 Cloudflare 엣지 캐시(1시간)로 거의 모든 요청을 캐시 히트로 처리.
  const toneWordsMatch = url.pathname.match(/^\/game\/tone-words\/([^/]+)$/);
  if (request.method === 'GET' && toneWordsMatch) {
    const difficulty = decodeURIComponent(toneWordsMatch[1]);
    const dv = validatePathToken(ToneDifficultySchema, difficulty, corsHeaders, '난이도');
    if (!dv.ok) return dv.response;

    // 엣지 캐시 — 모든 학생 동일 URL이라 high cache hit rate.
    const cacheUrl = new URL(request.url);
    const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) {
      // CORS는 요청마다 동적이므로 캐시본의 헤더는 그대로 두고 새 응답으로 감싼다.
      const body = await cached.text();
      return new Response(body, {
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
      });
    }

    const difficultyName = TONE_DIFFICULTY_TO_NAME[difficulty];
    const results = await queryAllNotion(n, TONE_WORDS_DB_ID, {
      filter: {
        and: [
          { property: '난이도', select: { equals: difficultyName } },
          { property: '활성', checkbox: { equals: true } },
        ],
      },
    });

    const words = results.map((page) => {
      const p = page.properties || {};
      const hanzi = p['한자']?.title?.[0]?.plain_text ?? '';
      const pinyin = (p['병음']?.rich_text?.[0]?.plain_text ?? '').trim().split(/\s+/).filter(Boolean);
      const tones = (p['성조']?.rich_text?.[0]?.plain_text ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
      const meaning = p['의미']?.rich_text?.[0]?.plain_text ?? '';
      return { hanzi, pinyin, tones, meaning };
    }).filter((w) => w.hanzi && w.pinyin.length > 0 && w.tones.length === w.pinyin.length);

    const body = JSON.stringify(words);
    // 1시간 캐시. 단어 갱신 후엔 캐시 만료까지 기다리거나 별도 무효화 도구 필요.
    const cachedResponse = new Response(body, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
    });
    // 백그라운드 캐시 저장 (응답 지연 방지)
    try { await cache.put(cacheKey, cachedResponse.clone()); } catch { /* noop */ }

    return new Response(body, {
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache': 'MISS' },
    });
  }

  // ===== 게임 계정(독립실행) — 휴대폰 OTP 회원가입/로그인 + 게임데이터 =====
  // POST /game/auth/otp — 휴대폰 → SMS 인증번호 발송
  if (url.pathname === '/game/auth/otp' && request.method === 'POST') {
    const body = await request.json().catch(() => null);
    const phone = normalizePhone(body?.phone);
    if (!phone) return errRes(corsHeaders, 400, '올바른 휴대폰 번호가 아닙니다.');
    const ip = clientIp(request);
    if (!(await rateLimitCheck(`gameotp:ip:${ip}`, 8, 600)) || !(await rateLimitCheck(`gameotp:ph:${phone}`, 5, 600))) {
      return errRes(corsHeaders, 429, '잠시 후 다시 시도해주세요.');
    }
    const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)); // 6자리 (CSPRNG)
    await putGameOtp(phone, code);
    // 카카오 알림톡 인증번호 — 채널명("하늘하늘중국어")으로 발송(발신번호 노출 X). 템플릿 미승인/미설정 시 no-op → 개발은 GAME_OTP_DEBUG.
    await sendKakaoAlert(env, { to: phone, templateId: env.KAKAO_TPL_GAME_OTP, variables: { '#{인증번호}': code } });
    const out = { ok: true };
    if (env.GAME_OTP_DEBUG === '1') out.devCode = code; // 개발 검증용(시크릿 설정 시에만 노출)
    return new Response(JSON.stringify(out), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // POST /game/auth/verify — 휴대폰+코드 검증 → find-or-create → 게임유저 JWT
  if (url.pathname === '/game/auth/verify' && request.method === 'POST') {
    const body = await request.json().catch(() => null);
    const phone = normalizePhone(body?.phone);
    const code = String(body?.code || '').trim();
    if (!phone || !/^\d{6}$/.test(code)) return errRes(corsHeaders, 400, '입력값을 확인해주세요.');
    // 무차별 대입 방지 — 검증 시도도 제한(발송 rate limit과 별개). OTP TTL(180s)과 같은 창에서 전화·IP당 시도 상한.
    // 전화당 5회/180s면 6자리(1M) 추측은 사실상 불가, IP당 20회/180s로 분산(여러 전화) 시도도 차단.
    const vip = clientIp(request);
    if (!(await rateLimitCheck(`gameverify:ph:${phone}`, 5, 180)) || !(await rateLimitCheck(`gameverify:ip:${vip}`, 20, 180))) {
      return errRes(corsHeaders, 429, '잠시 후 다시 시도해주세요.');
    }
    const saved = await getGameOtp(phone);
    if (!saved || saved !== code) return errRes(corsHeaders, 401, '인증번호가 일치하지 않습니다.');
    await clearGameOtp(phone);
    if (!env.JWT_SECRET) return errRes(corsHeaders, 500, '서버 설정 오류입니다.');
    const user = await findOrCreateGameUser(n, phone);
    const token = await createGameToken(env.JWT_SECRET, user.id, 60 * 60 * 24 * 60); // 60일
    return new Response(JSON.stringify({
      token,
      user: { id: user.id, phone, nickname: user.nickname, studentToken: user.studentToken, gameData: user.gameData },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // GET/PUT /game/me — 게임유저 JWT 인증 → 게임데이터 read/write
  if (url.pathname === '/game/me' && (request.method === 'GET' || request.method === 'PUT')) {
    const auth = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const claim = await verifyGameToken(auth, env.JWT_SECRET);
    if (!claim?.sub) return errRes(corsHeaders, 401, '로그인이 필요합니다.');
    const page = await n('GET', `/pages/${claim.sub}`);
    if (!page || page.object === 'error') return errRes(corsHeaders, 404, '계정을 찾을 수 없습니다.');
    if (request.method === 'GET') {
      return new Response(JSON.stringify({ user: parseGameUser(page) }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    // PUT — 게임데이터 갱신(클라이언트 병합 후 최종본 덮어쓰기)
    const body = await request.json().catch(() => null);
    if (body?.gameData == null || typeof body.gameData !== 'object') return errRes(corsHeaders, 400, '게임데이터가 필요합니다.');
    const json = JSON.stringify(body.gameData).slice(0, 1900); // Notion rich_text 2000자 안전
    await n('PATCH', `/pages/${claim.sub}`, {
      properties: {
        '게임데이터': { rich_text: [{ text: { content: json } }] },
        '최종접속': { date: { start: new Date().toISOString() } },
        ...(body.nickname ? { '닉네임': { rich_text: [{ text: { content: String(body.nickname).slice(0, 40) } }] } } : {}),
      },
    });
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  async function findStudentByToken(token) {
    const res = await n('POST', `/databases/${STUDENT_DB_ID}/query`, {
      filter: { property: '예약 코드', rich_text: { equals: token } },
      page_size: 1,
    });
    return res.results?.[0] ?? null;
  }

  function parseBest(page) {
    const p = page.properties || {};
    const gameName = p['게임']?.select?.name || '';
    let meta = {};
    try { meta = JSON.parse(p['메타']?.rich_text?.[0]?.plain_text || '{}'); } catch { /* noop */ }
    return {
      gameKey: GAME_NAME_TO_KEY[gameName] || null,
      gameName,
      bestScore: p['최고 점수']?.number ?? 0,
      playCount: p['플레이 수']?.number ?? 0,
      bestMaxCombo: p['최대 콤보']?.number ?? 0,
      bestAvgSec: p['평균 답변(초)']?.number ?? 0,
      lastPlayedAt: p['최근 플레이']?.date?.start ?? null,
      meta,
      pageId: page.id,
    };
  }

  // GET /game/best/:token  (전체)
  // GET /game/best/:token/:gameKey  (단일)
  const allMatch = url.pathname.match(/^\/game\/best\/([^/]+)$/);
  const oneMatch = url.pathname.match(/^\/game\/best\/([^/]+)\/([^/]+)$/);

  if (request.method === 'GET' && (allMatch || oneMatch)) {
    const token = decodeURIComponent((allMatch || oneMatch)[1]);
    const tv = validatePathToken(StudentTokenSchema, token, corsHeaders, '학생 토큰');
    if (!tv.ok) return tv.response;

    const studentPage = await findStudentByToken(token);
    if (!studentPage) {
      return errRes(corsHeaders, 404, '등록된 학생이 아닙니다.');
    }

    let filter = { property: '학생', relation: { contains: studentPage.id } };
    let gameKeyFilter = null;
    if (oneMatch) {
      gameKeyFilter = decodeURIComponent(oneMatch[2]);
      const gv = validatePathToken(GameKeySchema, gameKeyFilter, corsHeaders, '게임 키');
      if (!gv.ok) return gv.response;
      const gameName = GAME_KEY_TO_NAME[gameKeyFilter];
      filter = {
        and: [
          filter,
          { property: '게임', select: { equals: gameName } },
        ],
      };
    }

    const results = await queryAllNotion(n, GAME_BEST_DB_ID, { filter });
    const bests = results.map(parseBest).filter(b => b.gameKey);

    const payload = oneMatch ? (bests[0] || null) : bests;
    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // POST /game/best/:token/:gameKey
  if (request.method === 'POST' && oneMatch) {
    const token = decodeURIComponent(oneMatch[1]);
    const gameKey = decodeURIComponent(oneMatch[2]);
    const tv = validatePathToken(StudentTokenSchema, token, corsHeaders, '학생 토큰');
    if (!tv.ok) return tv.response;
    const gv = validatePathToken(GameKeySchema, gameKey, corsHeaders, '게임 키');
    if (!gv.ok) return gv.response;

    const body = await request.json().catch(() => ({}));
    const bv = validateBody(GameResultSchema, body, corsHeaders);
    if (!bv.ok) return bv.response;
    const data = bv.data;

    const studentPage = await findStudentByToken(token);
    if (!studentPage) {
      return errRes(corsHeaders, 404, '등록된 학생이 아닙니다.');
    }

    const studentName = stripEmoji(studentPage.properties?.['이름']?.title?.[0]?.plain_text ?? '');
    const gameName = GAME_KEY_TO_NAME[gameKey];
    const titleText = `${studentName || '학생'} - ${gameName}`;

    // 기존 row 검색 (학생 × 게임 = 1 row 보장)
    const existing = await n('POST', `/databases/${GAME_BEST_DB_ID}/query`, {
      filter: {
        and: [
          { property: '학생', relation: { contains: studentPage.id } },
          { property: '게임', select: { equals: gameName } },
        ],
      },
      page_size: 1,
    });
    const existingPage = existing.results?.[0];
    const prev = existingPage
      ? parseBest(existingPage)
      : { bestScore: 0, playCount: 0, bestMaxCombo: 0, bestAvgSec: 0, meta: {} };

    const isNewBest = data.score > prev.bestScore;
    const newAvgSec = Number((data.avgMs / 1000).toFixed(1));
    // 심층 방어 — 입력단(zod)에서 meta를 1800자로 제한하지만, 기존 meta와 병합 누적해도
    // Notion '메타' rich_text(2000자 한도)를 넘지 않도록 최종 가드. 초과 시 이번 meta는 버리고 이전 값 유지(데이터 손상 방지).
    const mergedMeta = { ...(prev.meta || {}), ...(data.meta || {}) };
    const safeMeta = JSON.stringify(mergedMeta).length <= 1900 ? mergedMeta : (prev.meta || {});
    const updated = {
      bestScore: isNewBest ? data.score : prev.bestScore,
      bestMaxCombo: isNewBest ? data.maxCombo : prev.bestMaxCombo,
      bestAvgSec: isNewBest ? newAvgSec : prev.bestAvgSec,
      playCount: (prev.playCount || 0) + 1,
      lastPlayedAt: new Date().toISOString(),
      meta: safeMeta,
    };

    const properties = {
      '이름': { title: [{ text: { content: titleText } }] },
      '학생': { relation: [{ id: studentPage.id }] },
      '게임': { select: { name: gameName } },
      '최고 점수': { number: updated.bestScore },
      '최대 콤보': { number: updated.bestMaxCombo },
      '평균 답변(초)': { number: updated.bestAvgSec },
      '플레이 수': { number: updated.playCount },
      '최근 플레이': { date: { start: updated.lastPlayedAt } },
      '메타': { rich_text: [{ text: { content: JSON.stringify(updated.meta) } }] },
    };

    if (existingPage) {
      await n('PATCH', `/pages/${existingPage.id}`, { properties });
    } else {
      await n('POST', '/pages', {
        parent: { database_id: GAME_BEST_DB_ID },
        properties,
      });
    }

    return new Response(JSON.stringify({
      isNewBest,
      best: { gameKey, gameName, ...updated },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return errRes(corsHeaders, 404, '요청한 항목을 찾을 수 없습니다.');
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

    // 미니게임 베스트 라우트 (학생 토큰 기반 공개)
    if (url.pathname.startsWith('/game/')) {
      return handleGameRoutes(request, env, corsHeaders, url);
    }

    // 무료상담 신청 (공개, 인증 불필요)
    if (url.pathname === '/consult' && request.method === 'POST') {
      return handleConsultRequest(request, env, corsHeaders);
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
        console.error('[보안] JWT_SECRET 미설정 — 로그인 거부. npx wrangler secret put JWT_SECRET 으로 32바이트+ 랜덤 시크릿 등록 필요.');
        return new Response(JSON.stringify({ error: '서버 설정 오류' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // 토큰 유효기간 30일 — localStorage 저장으로 강사 로그인 유지
      const token = await createToken(env.JWT_SECRET, 30 * 24 * 60 * 60);
      return new Response(JSON.stringify({ token }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 나머지 모든 요청: Bearer 토큰 검증
    if (!env.JWT_SECRET) {
      console.error('[보안] JWT_SECRET 미설정 — 인증 요청 거부.');
      return new Response(JSON.stringify({ error: '서버 설정 오류' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const valid = await verifyToken(token, env.JWT_SECRET);
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

    // POST /v1/pages: parent.database_id가 화이트리스트에 있는지 검증.
    // /v1/databases/:id 경로 검증으로는 막을 수 없는 horizontal access를 차단
    // (강사 JWT 탈취 시 NOTION_TOKEN이 접근 가능한 임의 워크스페이스 DB로의 쓰기).
    if (url.pathname === '/v1/pages' && request.method === 'POST' && body) {
      try {
        const parsed = JSON.parse(body);
        const dbId = parsed?.parent?.database_id?.replace(/-/g, '').toLowerCase();
        if (dbId && !ALLOWED_NOTION_DB_IDS.has(dbId)) {
          return new Response(JSON.stringify({ error: '허용되지 않은 DB입니다.' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } catch {
        // JSON 파싱 실패는 Notion API가 400으로 처리하도록 그대로 통과
      }
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
