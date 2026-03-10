const CLASS_DB_ID = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';
const STUDENT_DB_ID = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';

// ===== 예약 시스템 DB =====
const SLOTS_DB_ID = '31e838fa-f2a6-814e-8ee5-d5774366964e';
const BLOCKED_DATES_DB_ID = '31e838fa-f2a6-81d3-b034-c47a4f0e5f3e';
const BOOKINGS_DB_ID = '31e838fa-f2a6-813b-ada3-ffb8961f5a5a';

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

// ===== 알림톡 발송 (Solapi 준비 전 no-op placeholder) =====
async function sendAlimtalk(env, { to, templateCode, variables }) {
  // TODO: Solapi API 키 준비되면 구현
  // env.SOLAPI_API_KEY, env.SOLAPI_API_SECRET, env.KAKAO_CHANNEL_ID 필요
  console.log(`[알림톡 placeholder] to=${to} template=${templateCode}`, JSON.stringify(variables));
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
  const addMinutes = (t, min) => minToTime(timeToMin(t) + min);

  // 예약 불가 날짜 파싱 & isBlocked 함수 생성 (공통)
  const buildIsBlocked = (blockedResults) => {
    const blockedDates = (blockedResults ?? []).map(p => {
      const props = p.properties;
      const d = props?.['날짜']?.date;
      const type = props?.['반복 유형']?.select?.name;
      const days = (props?.['반복 요일']?.multi_select ?? []).map(o => o.name);
      return { type, days, start: d?.start, end: d?.end || d?.start };
    }).filter(b => b.type === '반복' ? b.days.length > 0 : b.start);
    return (dateStr) => {
      const dayKR = DAY_KR[new Date(dateStr + 'T00:00:00+09:00').getDay()];
      return blockedDates.some(b => {
        if (b.type === '반복') {
          if (!b.days.includes(dayKR)) return false;
          if (b.start && dateStr < b.start) return false;
          if (b.end && dateStr > b.end) return false;
          return true;
        }
        return b.start && dateStr >= b.start && dateStr <= (b.end || b.start);
      });
    };
  };

  // GET /booking/slots?from=YYYY-MM-DD&to=YYYY-MM-DD
  if (url.pathname === '/booking/slots' && request.method === 'GET') {
    // KST 기준 오늘 (UTC+9)
    const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const minDate = new Date(nowKST);
    minDate.setUTCDate(minDate.getUTCDate() + 2); // 오늘+2일부터 예약 가능
    const minDateStr = minDate.toISOString().slice(0, 10);

    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');
    const from = !fromParam || fromParam < minDateStr ? minDateStr : fromParam;
    const to = toParam || (() => {
      const d = new Date(minDate);
      d.setUTCDate(d.getUTCDate() + 30);
      return d.toISOString().slice(0, 10);
    })();

    const [slotsRes, blockedRes, bookingsRes] = await Promise.all([
      n('POST', `/databases/${SLOTS_DB_ID}/query`, {
        filter: { property: '활성화', checkbox: { equals: true } },
        page_size: 100,
      }),
      n('POST', `/databases/${BLOCKED_DATES_DB_ID}/query`, { page_size: 100 }),
      n('POST', `/databases/${BOOKINGS_DB_ID}/query`, {
        filter: {
          and: [
            { property: '예약 날짜', date: { on_or_after: from } },
            { property: '예약 날짜', date: { on_or_before: to } },
            { property: '상태', select: { equals: '확정' } },
          ],
        },
        page_size: 100,
      }),
    ]);

    const slots = slotsRes.results ?? [];

    // 예약 불가 날짜 파싱 (일회성 날짜범위 + 반복 요일 모두 지원)
    const isBlocked = buildIsBlocked(blockedRes.results);

    // 이미 확정된 예약 (날짜|시간 키)
    const bookedKeys = new Set(
      (bookingsRes.results ?? []).map(p => {
        const d = p.properties?.['예약 날짜']?.date?.start;
        const t = p.properties?.['시작 시간']?.rich_text?.[0]?.plain_text;
        return d && t ? `${d}|${t}` : null;
      }).filter(Boolean)
    );

    // 날짜 범위 순회하며 슬롯 생성
    const result = [];
    const cur = new Date(from + 'T00:00:00Z');
    const end = new Date(to + 'T00:00:00Z');

    while (cur <= end) {
      const dateStr = cur.toISOString().slice(0, 10);
      const dayKr = DAY_KR[cur.getUTCDay()];

      if (!isBlocked(dateStr)) {
        for (const slot of slots) {
          const props = slot.properties;
          const type = props?.['슬롯 유형']?.select?.name;
          const startTime = props?.['시작 시간']?.rich_text?.[0]?.plain_text;
          const durationMin = props?.['수업 시간(분)']?.select?.name;

          if (!startTime || !durationMin) continue;

          const matches =
            type === '정기'
              ? props?.['요일']?.select?.name === dayKr
              : type === '일회성'
                ? props?.['날짜']?.date?.start === dateStr
                : false;

          if (matches && !bookedKeys.has(`${dateStr}|${startTime}`)) {
            result.push({ date: dateStr, startTime, durationMin: Number(durationMin) });
          }
        }
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    result.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

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

    const dayKR = DAY_KR[new Date(date + 'T00:00:00+09:00').getDay()];

    const [slotsRes2, blockedRes2, bookingsRes2] = await Promise.all([
      n('POST', `/databases/${SLOTS_DB_ID}/query`, {
        filter: { property: '활성화', checkbox: { equals: true } },
        page_size: 100,
      }),
      n('POST', `/databases/${BLOCKED_DATES_DB_ID}/query`, { page_size: 100 }),
      n('POST', `/databases/${BOOKINGS_DB_ID}/query`, {
        filter: {
          and: [
            { property: '예약 날짜', date: { equals: date } },
            { property: '상태', select: { equals: '확정' } },
          ],
        },
        page_size: 100,
      }),
    ]);

    if (buildIsBlocked(blockedRes2.results)(date)) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // SLOTS_DB 항목으로 이용 가능한 30분 원자 슬롯 생성
    const availableSet = new Set();
    for (const slot of slotsRes2.results ?? []) {
      const props = slot.properties;
      const type = props?.['슬롯 유형']?.select?.name;
      const st = props?.['시작 시간']?.rich_text?.[0]?.plain_text;
      const dur = Number(props?.['수업 시간(분)']?.select?.name);
      if (!st || !dur) continue;
      const matches =
        type === '정기' ? props?.['요일']?.select?.name === dayKR :
        type === '일회성' ? props?.['날짜']?.date?.start === date : false;
      if (!matches) continue;
      let elapsed = 0;
      while (elapsed < dur) {
        availableSet.add(addMinutes(st, elapsed));
        elapsed += 30;
      }
    }

    // 이미 확정된 예약의 시간 슬롯 제거
    const bookedSet = new Set();
    for (const p of bookingsRes2.results ?? []) {
      const props = p.properties;
      const bt = props?.['시작 시간']?.rich_text?.[0]?.plain_text;
      const bd = Number(props?.['수업 시간(분)']?.select?.name);
      if (!bt || !bd) continue;
      let elapsed = 0;
      while (elapsed < bd) {
        bookedSet.add(addMinutes(bt, elapsed));
        elapsed += 30;
      }
    }

    const available = [...availableSet].filter(t => !bookedSet.has(t)).sort();
    return new Response(JSON.stringify(available), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // POST /booking/reserve
  if (url.pathname === '/booking/reserve' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const { date, startTime, endTime, studentName, phone } = body;

    if (!date || !startTime || !endTime || !studentName || !phone) {
      return new Response(JSON.stringify({ error: '필수 항목이 누락되었습니다.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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

    // Race condition 방지: 같은 날짜의 확정 예약과 시간 겹침 확인
    const existingRes = await n('POST', `/databases/${BOOKINGS_DB_ID}/query`, {
      filter: {
        and: [
          { property: '예약 날짜', date: { equals: date } },
          { property: '상태', select: { equals: '확정' } },
        ],
      },
      page_size: 100,
    });

    const startMin = timeToMin(startTime);
    const endMin = timeToMin(endTime);
    const hasOverlap = (existingRes.results ?? []).some(p => {
      const bt = p.properties?.['시작 시간']?.rich_text?.[0]?.plain_text;
      const bd = Number(p.properties?.['수업 시간(분)']?.select?.name);
      if (!bt || !bd) return false;
      const bStart = timeToMin(bt);
      const bEnd = bStart + bd;
      return startMin < bEnd && bStart < endMin;
    });

    if (hasOverlap) {
      return new Response(JSON.stringify({ error: '방금 다른 분이 예약했습니다. 다른 시간을 선택해주세요.' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = crypto.randomUUID();

    // 예약 DB에 저장
    await n('POST', '/pages', {
      parent: { database_id: BOOKINGS_DB_ID },
      properties: {
        '제목': { title: [{ text: { content: `${date} ${startTime} - ${studentName}` } }] },
        '학생 이름': { rich_text: [{ text: { content: studentName } }] },
        '연락처': { phone_number: phone },
        '예약 날짜': { date: { start: date } },
        '시작 시간': { rich_text: [{ text: { content: startTime } }] },
        '수업 시간(분)': { select: { name: String(durationMin) } },
        '상태': { select: { name: '확정' } },
        '예약 토큰': { rich_text: [{ text: { content: token } }] },
      },
    });

    // 수업 캘린더 DB에도 등록 (학생 이름으로 학생 DB 검색 후 relation 연결)
    try {
      const studentRes = await n('POST', `/databases/${STUDENT_DB_ID}/query`, {
        filter: { property: '이름', title: { contains: studentName } },
        page_size: 5,
      });
      const studentPage = (studentRes.results ?? []).find(p => {
        const raw = p.properties?.['이름']?.title?.[0]?.plain_text ?? '';
        return stripEmoji(raw) === studentName;
      });

      const classDatetime = `${date}T${startTime}:00+09:00`;
      const classProps = {
        '제목': { title: [{ text: { content: `${studentName} ${date}` } }] },
        '수업 일시': { date: { start: classDatetime } },
        '수업 시간(분)': { select: { name: String(durationMin) } },
      };
      if (studentPage) {
        classProps['학생'] = { relation: [{ id: studentPage.id }] };
      }
      await n('POST', '/pages', {
        parent: { database_id: CLASS_DB_ID },
        properties: classProps,
      });
    } catch (e) {
      console.error('[reserve] 수업 캘린더 등록 실패:', e);
      // 수업 캘린더 등록 실패해도 예약 자체는 성공으로 처리
    }

    await sendAlimtalk(env, {
      to: phone,
      templateCode: 'BOOKING_CONFIRMED',
      variables: { name: studentName, date, startTime },
    });

    return new Response(JSON.stringify({ token, date, startTime, endTime, durationMin }), {
      status: 201,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // GET /booking/status/:token
  const statusMatch = url.pathname.match(/^\/booking\/status\/([^/]+)$/);
  if (statusMatch && request.method === 'GET') {
    const token = decodeURIComponent(statusMatch[1]);
    const res = await n('POST', `/databases/${BOOKINGS_DB_ID}/query`, {
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
    return new Response(JSON.stringify({
      status: props['상태']?.select?.name,
      date: props['예약 날짜']?.date?.start,
      startTime: props['시작 시간']?.rich_text?.[0]?.plain_text,
      durationMin: Number(props['수업 시간(분)']?.select?.name),
      studentName: props['학생 이름']?.rich_text?.[0]?.plain_text,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // GET /booking/list (강사용 예약 목록, 인증 필요)
  if (url.pathname === '/booking/list' && request.method === 'GET') {
    const authHeader = request.headers.get('Authorization') || '';
    const jwtToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!(await verifyToken(jwtToken, env.JWT_SECRET || env.AUTH_PASSWORD))) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const res = await n('POST', `/databases/${BOOKINGS_DB_ID}/query`, {
      sorts: [{ property: '예약 날짜', direction: 'ascending' }],
      page_size: 100,
    });

    const bookings = (res.results ?? []).map(p => {
      const props = p.properties;
      return {
        id: p.id,
        studentName: props['학생 이름']?.rich_text?.[0]?.plain_text,
        phone: props['연락처']?.phone_number,
        date: props['예약 날짜']?.date?.start,
        startTime: props['시작 시간']?.rich_text?.[0]?.plain_text,
        durationMin: Number(props['수업 시간(분)']?.select?.name),
        status: props['상태']?.select?.name,
      };
    });

    return new Response(JSON.stringify(bookings), {
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
      return {
        id: p.id,
        type: props?.['반복 유형']?.select?.name || '일회성',
        days: (props?.['반복 요일']?.multi_select ?? []).map(o => o.name),
        start: d?.start,
        end: d?.end,
        memo: props?.['메모']?.title?.[0]?.plain_text || '',
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
    const { type, days, start, end, memo } = body;

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

    const autoMemo = type === '반복' ? `매주 ${(days ?? []).join('·')}` : start;
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

  // DELETE /booking/:id (강사용 예약 취소, 인증 필요)
  const cancelMatch = url.pathname.match(/^\/booking\/([^/]+)$/);
  if (cancelMatch && request.method === 'DELETE') {
    const authHeader = request.headers.get('Authorization') || '';
    const jwtToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!(await verifyToken(jwtToken, env.JWT_SECRET || env.AUTH_PASSWORD))) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const bookingId = cancelMatch[1];
    const pageRes = await n('GET', `/pages/${bookingId}`);
    const props = pageRes.properties;
    const phone = props?.['연락처']?.phone_number;
    const studentName = props?.['학생 이름']?.rich_text?.[0]?.plain_text;
    const date = props?.['예약 날짜']?.date?.start;
    const startTime = props?.['시작 시간']?.rich_text?.[0]?.plain_text;

    await n('PATCH', `/pages/${bookingId}`, {
      properties: { '상태': { select: { name: '취소' } } },
    });

    if (phone) {
      await sendAlimtalk(env, {
        to: phone,
        templateCode: 'BOOKING_CANCELLED',
        variables: { name: studentName, date, startTime },
      });
    }

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

    // 예약 시스템 라우트 (공개 + 강사 인증 혼재, 내부에서 분기)
    if (url.pathname.startsWith('/booking')) {
      return handleBookingRoutes(request, env, corsHeaders, url);
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
