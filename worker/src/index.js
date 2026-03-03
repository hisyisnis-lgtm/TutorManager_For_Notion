const ALLOWED_ORIGINS = new Set([
  'https://hisyisnis-lgtm.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
]);

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.has(origin) || (env.ALLOWED_ORIGIN && origin === env.ALLOWED_ORIGIN);

    const corsHeaders = {
      'Access-Control-Allow-Origin': allowed ? origin : '',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type',
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

    const url = new URL(request.url);
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
