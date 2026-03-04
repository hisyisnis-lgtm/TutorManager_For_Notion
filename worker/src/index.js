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

  // GitHub Actions repository_dispatch 트리거 (백그라운드)
  if (env.GITHUB_PAT) {
    ctx.waitUntil(
      fetch('https://api.github.com/repos/hisyisnis-lgtm/TutorManager_For_Notion/dispatches', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GITHUB_PAT}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'tutor-manager-proxy',
        },
        body: JSON.stringify({ event_type: 'session-shortage-check' }),
      }),
    );
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
