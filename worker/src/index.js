const CLASS_DB_ID = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';
const STUDENT_DB_ID = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';

// 학생 이름 앞 상태 이모지(🟢🟡⚫) 제거
const STATUS_EMOJIS = ['🟢', '🟡', '⚫'];
function stripEmoji(name) {
  for (const emoji of STATUS_EMOJIS) {
    if (name.startsWith(emoji + ' ')) return name.slice(emoji.length + 1);
  }
  return name;
}

// Notion ID 정규화 (웹훅은 하이픈 없이 보낼 수 있음)
function normalizeId(id) {
  return (id || '').replace(/-/g, '');
}

// 수업 페이지 제목이 비어있고 학생이 연결돼 있으면 제목 자동 설정
async function syncClassTitle(pageId, notionToken) {
  const notionFetch = (method, path, body) =>
    fetch(`https://api.notion.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(r => r.json());

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
  const notionFetch = (method, path, body) =>
    fetch(`https://api.notion.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(r => r.json());

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
  'https://tutor-manager-pwa.pages.dev', // Cloudflare Pages (프로젝트명 변경 시 수정)
  'http://localhost:5173',
  'http://localhost:4173',
]);

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
  if (env.NOTION_WEBHOOK_SECRET) {
    const sigHeader = request.headers.get('X-Notion-Signature') || '';
    const expected = 'v0=' + (await hmacSha256Hex(env.NOTION_WEBHOOK_SECRET, body));
    if (expected !== sigHeader) {
      return new Response('Unauthorized', { status: 401 });
    }
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Notion 웹훅은 CORS/인증 체크 없이 별도 처리
    if (url.pathname === '/notion-webhook' && request.method === 'POST') {
      return handleNotionWebhook(request, env, ctx);
    }

    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.has(origin) || (env.ALLOWED_ORIGIN && origin === env.ALLOWED_ORIGIN);

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
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 로그인 엔드포인트: POST /auth/login
    if (url.pathname === '/auth/login' && request.method === 'POST') {
      const { password } = await request.json().catch(() => ({}));
      if (!env.AUTH_PASSWORD || password !== env.AUTH_PASSWORD) {
        return new Response(JSON.stringify({ error: '비밀번호가 틀렸습니다.' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
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
  },
};
