const CLASS_DB_ID = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';
const STUDENT_DB_ID = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';

// ===== 예약 시스템 DB =====
const BLOCKED_DATES_DB_ID = '31e838fa-f2a6-81d3-b034-c47a4f0e5f3e';

// ===== 무료상담 신청 DB =====
const CONSULT_DB_ID = '324838fa-f2a6-815d-99a7-ff165e8f78aa';

const DAY_KR = ['일', '월', '화', '수', '목', '금', '토'];

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
  'https://tiantian-chinese.pages.dev',
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

// ===== ntfy 강사 알림 발송 =====
async function sendNtfy(env, message, title = '무료상담 신청') {
  const topic = env.NTFY_TOPIC;
  if (!topic) return;
  await fetch(`https://ntfy.sh/${topic}`, {
    method: 'POST',
    headers: { Title: title, Priority: 'high', 'Content-Type': 'text/plain' },
    body: message,
  }).catch(() => {});
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

  const { name, phone, level, preferredDays, preferredTime, concerns, reasons, reasonOther, message } = body;

  const VALID_LEVELS = ['완전 처음이에요', '조금 배운 적 있어요', '어느 정도 배웠는데 막혀있어요'];
  const VALID_DAYS = ['월', '화', '수', '목', '금', '토', '일'];
  const VALID_TIMES = ['오전 (9-12시)', '오후 (12-18시)', '저녁 (18-21시)'];
  const VALID_CONCERNS = ['발음이 이상한 것 같아요', '배웠는데 막상 말이 안 나와요', '방향을 못 잡겠어요'];
  const VALID_REASONS = ['여행', '드라마&콘텐츠', '업무&비즈니스', '중국인 지인&가족', '그냥 관심이 생겨서', '기타 (직접 입력)'];

  if (!name?.trim() || !phone?.trim()) {
    return new Response(JSON.stringify({ error: '이름과 전화번호는 필수입니다.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 길이 제한
  if (name.trim().length > 50) {
    return new Response(JSON.stringify({ error: '이름이 너무 깁니다.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (message && message.trim().length > 500) {
    return new Response(JSON.stringify({ error: '상담 내용은 500자 이내로 입력해주세요.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 전화번호 형식 검증 (숫자만, 10~11자리)
  const phoneDigits = phone.replace(/\D/g, '');
  if (phoneDigits.length < 10 || phoneDigits.length > 11) {
    return new Response(JSON.stringify({ error: '전화번호 형식이 올바르지 않습니다.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 선택값 화이트리스트 검증
  if (level && !VALID_LEVELS.includes(level)) {
    return new Response(JSON.stringify({ error: '잘못된 수준 값입니다.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (preferredTime && !VALID_TIMES.includes(preferredTime)) {
    return new Response(JSON.stringify({ error: '잘못된 시간대 값입니다.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (Array.isArray(preferredDays) && preferredDays.some(d => !VALID_DAYS.includes(d))) {
    return new Response(JSON.stringify({ error: '잘못된 요일 값입니다.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (Array.isArray(concerns) && concerns.some(c => !VALID_CONCERNS.includes(c))) {
    return new Response(JSON.stringify({ error: '잘못된 고민 값입니다.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (Array.isArray(reasons) && reasons.some(r => !VALID_REASONS.includes(r))) {
    return new Response(JSON.stringify({ error: '잘못된 이유 값입니다.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

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
        '수준': level ? { select: { name: level } } : undefined,
        '희망 요일': Array.isArray(preferredDays) && preferredDays.length > 0
          ? { multi_select: preferredDays.map(d => ({ name: d })) }
          : undefined,
        '희망 시간대': preferredTime ? { select: { name: preferredTime } } : undefined,
        '상담 내용': fullContent
          ? { rich_text: [{ text: { content: fullContent } }] }
          : undefined,
        '상태': { select: { name: '신청됨' } },
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

  // 강사에게 ntfy 알림
  const concernsText = Array.isArray(concerns) && concerns.length > 0 ? concerns.join(', ') : '미기재';
  const reasonsText = Array.isArray(reasons) && reasons.length > 0
    ? reasons.map(r => r === '기타 (직접 입력)' && reasonOther?.trim() ? `기타: ${reasonOther.trim()}` : r).join(', ')
    : '미기재';
  const ntfyMsg = [
    `이름: ${name.trim()}`,
    `전화: ${phoneDigits}`,
    `수준: ${level || '미기재'}`,
    `고민: ${concernsText}`,
    `이유: ${reasonsText}`,
    `희망 요일: ${daysText}`,
    `희망 시간대: ${preferredTime || '미기재'}`,
    message?.trim() ? `상담 내용: ${message.trim()}` : null,
  ].filter(Boolean).join('\n');

  await sendNtfy(env, ntfyMsg, '📩 무료상담 신청');

  // 카카오 알림톡 발송 (강사에게)
  if (env.KAKAO_TPL_CONSULT && env.MY_PHONE) {
    await sendKakaoAlert(env, {
      to: env.MY_PHONE,
      templateId: env.KAKAO_TPL_CONSULT,
      variables: {
        name: name.trim(),
        phone: phoneDigits,
        level: level || '미기재',
        days: daysText,
        time: preferredTime || '미기재',
        message: message?.trim() || '없음',
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
  const n = (method, path, body) =>
    fetch(`https://api.notion.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(r => r.json());

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

    // 최소 예약 가능 날짜 (오늘+2) 체크
    const nowKST2 = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const minDate2 = new Date(nowKST2);
    minDate2.setUTCDate(minDate2.getUTCDate() + 2);
    if (date < minDate2.toISOString().slice(0, 10)) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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

    // 09:00 ~ 21:30 전체 30분 슬롯 생성 (22:00은 종료시간으로만 사용)
    const allSlots = new Set();
    for (let m = 9 * 60; m < 22 * 60; m += 30) allSlots.add(minToTime(m));

    // 기존 수업(CLASS_DB) 점유 슬롯 제거 (취소 제외)
    const busySet = new Set();
    for (const p of classRes.results ?? []) {
      const props = p.properties;
      if (props?.['특이사항']?.select?.name === '🚫 취소') continue;
      const dtStr = props?.['수업 일시']?.date?.start;
      const dur = Number(props?.['수업 시간(분)']?.select?.name);
      if (!dtStr || !dur) continue;
      const timeMatch = dtStr.match(/T(\d{2}):(\d{2})/);
      if (!timeMatch) continue;
      const classStartMin = Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
      for (let elapsed = 0; elapsed < dur; elapsed += 30) busySet.add(minToTime(classStartMin + elapsed));
    }

    // 개별 차단 시간 슬롯 제거
    for (const t of getBlockedTimes(date)) busySet.add(t);

    const available = [...allSlots].filter(t => !busySet.has(t)).sort();
    return new Response(JSON.stringify(available), {
      status: 200,
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
        return startMin < bEnd && bStart < endMin;
      });

    if (hasOverlap) {
      return new Response(JSON.stringify({ error: '방금 다른 분이 예약했습니다. 다른 시간을 선택해주세요.' }), {
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
      '수업 유형': { relation: [{ id: '314838fa-f2a6-8070-82ad-e2494a9d7281' }] },
      '예약 토큰': { rich_text: [{ text: { content: token } }] },
    };
    if (mode) classProps['수업 장소'] = { select: { name: mode } };

    await n('POST', '/pages', {
      parent: { database_id: CLASS_DB_ID },
      properties: classProps,
    });

    await sendAlimtalk(env, {
      to: phone,
      templateCode: 'BOOKING_CONFIRMED',
      variables: { name: studentName, date, startTime },
    });

    return new Response(JSON.stringify({ token, date, startTime, endTime, durationMin, studentName }), {
      status: 201,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // GET /booking/student/:token (공개, 학생 예약 코드로 학생 정보 조회)
  const studentLookupMatch = url.pathname.match(/^\/booking\/student\/([^/]+)$/);
  if (studentLookupMatch && request.method === 'GET') {
    const token = decodeURIComponent(studentLookupMatch[1]);
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
    return new Response(JSON.stringify({
      id: page.id,
      name: stripEmoji(rawName),
      phone: props?.['전화번호']?.phone_number ?? '',
      remainingSessions: props?.['잔여 시간 회차']?.formula?.number ?? 0,
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

    const res = await n('POST', `/databases/${CLASS_DB_ID}/query`, {
      filter: classFilter,
      sorts: [{ property: '수업 일시', direction: 'descending' }],
      page_size: 100,
    });
    const classes = (res.results ?? []).map(p => {
      const props = p.properties;
      const dtStr = props['수업 일시']?.date?.start ?? '';
      const date = dtStr.slice(0, 10);
      const tm = dtStr.match(/T(\d{2}):(\d{2})/);
      const startTime = tm ? `${tm[1]}:${tm[2]}` : '';
      return {
        id: p.id,
        date,
        startTime,
        durationMin: Number(props['수업 시간(분)']?.select?.name) || 0,
        location: props['수업 장소']?.select?.name ?? null,
        isCancelled: props['특이사항']?.select?.name === '🚫 취소',
      };
    });
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
      return new Response(JSON.stringify({ error: '인증 실패.' }), {
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
    const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
      return new Response(JSON.stringify({ error: '인증 실패.' }), {
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
    const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (!classDate || classDate <= todayKST) {
      return new Response(JSON.stringify({ error: '과거 수업은 복구할 수 없습니다.' }), {
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
    const authHeader = request.headers.get('Authorization') || '';
    const jwtToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!(await verifyToken(jwtToken, env.JWT_SECRET || env.AUTH_PASSWORD))) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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
    const authHeader = request.headers.get('Authorization') || '';
    const jwtToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!(await verifyToken(jwtToken, env.JWT_SECRET || env.AUTH_PASSWORD))) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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
    const authHeader = request.headers.get('Authorization') || '';
    const jwtToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!(await verifyToken(jwtToken, env.JWT_SECRET || env.AUTH_PASSWORD))) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await n('PATCH', `/pages/${blockedDeleteMatch[1]}`, { archived: true });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response('Not Found', { status: 404, headers: corsHeaders });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Notion 웹훅은 CORS/인증 체크 없이 별도 처리
    if (url.pathname === '/notion-webhook' && request.method === 'POST') {
      return handleNotionWebhook(request, env, ctx);
    }

    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.has(origin) || (env.ALLOWED_ORIGIN && origin === env.ALLOWED_ORIGIN) || /^https:\/\/[a-z0-9-]+\.tiantian-chinese\.pages\.dev$/.test(origin);

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

    // 예약 시스템 라우트 (공개 + 강사 인증 혼재, 내부에서 분기)
    if (url.pathname.startsWith('/booking')) {
      return handleBookingRoutes(request, env, corsHeaders, url);
    }

    // 무료상담 신청 (공개, 인증 불필요)
    if (url.pathname === '/consult' && request.method === 'POST') {
      return handleConsultRequest(request, env, corsHeaders);
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
      if (!env.JWT_SECRET) {
        console.warn('[보안 경고] JWT_SECRET 미설정. AUTH_PASSWORD를 JWT 서명 키로 사용 중. npx wrangler secret put JWT_SECRET 실행 권장.');
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

    // Notion API 프록시 경로 화이트리스트 (실제 사용 경로만 허용)
    const ALLOWED_NOTION_PATHS = ['/v1/databases/', '/v1/pages', '/v1/pages/'];
    const isAllowedPath = ALLOWED_NOTION_PATHS.some(prefix => url.pathname === prefix || url.pathname.startsWith(prefix));
    if (!isAllowedPath) {
      return new Response(JSON.stringify({ error: 'Not allowed' }), {
        status: 403,
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
