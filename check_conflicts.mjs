// 수업 캘린더 충돌 감지 스크립트
// GitHub Actions에서 10분마다 자동 실행됨

import { createHmac } from 'crypto';

const TOKEN = process.env.NOTION_TOKEN;
const NTFY_TOPIC = process.env.NTFY_TOPIC;
const DB_ID = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';

const SOLAPI_API_KEY = process.env.SOLAPI_API_KEY;
const SOLAPI_API_SECRET = process.env.SOLAPI_API_SECRET;
const KAKAO_PFID = process.env.KAKAO_PFID;
const MY_PHONE = process.env.MY_PHONE;
const KAKAO_TPL_CONFLICT = process.env.KAKAO_TPL_CONFLICT;

if (!TOKEN) {
  console.error('NOTION_TOKEN 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

async function sendNtfy(title, message, priority = 3) {
  if (!NTFY_TOPIC) return;
  try {
    await fetch('https://ntfy.sh/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: NTFY_TOPIC, title, message, priority }),
    });
    console.log(`ntfy 알림 전송 완료: ${title}`);
  } catch (e) {
    console.error('ntfy 전송 실패:', e.message);
  }
}

async function sendKakao(to, templateId, variables) {
  if (!SOLAPI_API_KEY || !SOLAPI_API_SECRET || !KAKAO_PFID || !templateId || !to) return;
  const date = new Date().toISOString();
  const salt = Math.random().toString(36).substring(2, 18);
  const signature = createHmac('sha256', SOLAPI_API_SECRET).update(date + salt).digest('hex');
  try {
    const res = await fetch('https://api.solapi.com/messages/v4/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `HMAC-SHA256 apiKey=${SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}`,
      },
      body: JSON.stringify({ message: { to, kakaoOptions: { pfId: KAKAO_PFID, templateId, variables } } }),
    });
    const data = await res.json();
    if (!res.ok) console.error('카카오 발송 실패:', JSON.stringify(data));
    else console.log(`카카오 알림톡 발송 완료: ${to}`);
  } catch (e) {
    console.error('카카오 발송 오류:', e.message);
  }
}

async function notion(method, path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function getAllPages() {
  const pages = [];
  let cursor = undefined;

  while (true) {
    const res = await notion('POST', `/databases/${DB_ID}/query`, {
      start_cursor: cursor,
      filter: {
        property: '수업 일시',
        date: { is_not_empty: true },
      },
    });
    pages.push(...res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }

  return pages;
}

async function main() {
  console.log(`[${new Date().toISOString()}] 충돌 감지 시작`);

  const pages = await getAllPages();
  console.log(`전체 수업 ${pages.length}개 조회`);

  // 취소된 수업 제외하고 파싱
  const classes = pages
    .map(p => {
      const dateVal = p.properties['수업 일시']?.date;
      const duration = p.properties['수업 시간(분)']?.select?.name;
      const 특이사항 = p.properties['특이사항']?.select?.name;
      const currentConflict = p.properties['충돌_감지']?.checkbox ?? false;

      if (!dateVal?.start || !duration) return null;
      if (특이사항 === '🚫 취소') return null;

      const start = new Date(dateVal.start);
      const end = new Date(start.getTime() + parseInt(duration) * 60 * 1000);

      return { id: p.id, start, end, currentConflict };
    })
    .filter(Boolean);

  console.log(`유효 수업 ${classes.length}개 (취소 제외)`);

  // 충돌 감지
  const conflictIds = new Set();

  for (let i = 0; i < classes.length; i++) {
    for (let j = i + 1; j < classes.length; j++) {
      const a = classes[i];
      const b = classes[j];

      // A.start < B.end && B.start < A.end → 겹침
      if (a.start < b.end && b.start < a.end) {
        conflictIds.add(a.id);
        conflictIds.add(b.id);
      }
    }
  }

  // 변경이 필요한 항목만 업데이트
  let updated = 0;
  let newConflicts = 0;
  for (const cls of classes) {
    const shouldConflict = conflictIds.has(cls.id);

    if (shouldConflict !== cls.currentConflict) {
      if (shouldConflict) newConflicts++;
      await notion('PATCH', `/pages/${cls.id}`, {
        properties: {
          '충돌_감지': { checkbox: shouldConflict },
        },
      });
      console.log(`  ${cls.id}: 충돌 ${shouldConflict ? '✅ 표시' : '⬜ 해제'} (${cls.start.toISOString()})`);
      updated++;
    }
  }

  console.log(`완료: ${conflictIds.size}개 충돌 감지, ${updated}개 업데이트`);

  if (newConflicts > 0) {
    const msg = `충돌 수업 ${newConflicts}건이 새로 발견되었습니다.\n노션에서 확인해 주세요.`;
    await sendNtfy('⚠️ 수업 충돌 감지', msg, 4);
    await sendKakao(MY_PHONE, KAKAO_TPL_CONFLICT, {
      '#{건수}': String(newConflicts),
    });
  }
}

main().catch(async err => {
  console.error('오류:', err.message);
  await sendNtfy('❌ 충돌 감지 스크립트 오류', err.message, 4);
  await sendKakao(MY_PHONE, KAKAO_TPL_CONFLICT, {
    '#{건수}': '0',
    '#{오류}': err.message,
  });
  process.exit(1);
});
