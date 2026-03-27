// 미수금 알림 스크립트
// GitHub Actions에서 매월 25, 27, 29일 10:00 KST (01:00 UTC)에 자동 실행됨

import { createHmac } from 'crypto';

const TOKEN = process.env.NOTION_TOKEN;
const NTFY_TOPIC = process.env.NTFY_TOPIC;
const NTFY_TOKEN = process.env.NTFY_TOKEN;
const STUDENT_DB_ID = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';

const SOLAPI_API_KEY = process.env.SOLAPI_API_KEY;
const SOLAPI_API_SECRET = process.env.SOLAPI_API_SECRET;
const KAKAO_PFID = process.env.KAKAO_PFID;
const MY_PHONE = process.env.MY_PHONE;
const KAKAO_TPL_UNPAID = process.env.KAKAO_TPL_UNPAID;

if (!TOKEN) {
  console.error('NOTION_TOKEN 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

async function notion(method, path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function sendNtfy(title, message, priority = 4) {
  if (!NTFY_TOPIC) return;
  const headers = { 'Content-Type': 'application/json' };
  if (NTFY_TOKEN) headers['Authorization'] = `Bearer ${NTFY_TOKEN}`;
  try {
    const res = await fetch('https://ntfy.sh', {
      method: 'POST',
      headers,
      body: JSON.stringify({ topic: NTFY_TOPIC, title, message, priority }),
    });
    if (!res.ok) console.error(`ntfy 전송 실패 (${res.status}): ${await res.text()}`);
    else console.log(`ntfy 알림 전송 완료: ${title}`);
  } catch (e) {
    console.error('ntfy 전송 오류:', e.message);
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

function stripEmoji(name) {
  return name.replace(/^[🟢🟡⚫]\s/, '');
}

async function main() {
  console.log(`[${new Date().toISOString()}] 미수금 학생 조회 시작`);

  // 수강중 + 일시중단 학생 중 미수금이 있는 학생 조회
  const students = [];
  let cursor = undefined;

  while (true) {
    const body = {
      filter: {
        and: [
          {
            or: [
              { property: '상태', select: { equals: '🟢 수강중' } },
              { property: '상태', select: { equals: '🟡 일시중단' } },
            ],
          },
          {
            property: '미수금 합계',
            rollup: { number: { greater_than: 0 } },
          },
        ],
      },
      sorts: [{ property: '미수금 합계', direction: 'descending' }],
    };
    if (cursor) body.start_cursor = cursor;

    const res = await notion('POST', `/databases/${STUDENT_DB_ID}/query`, body);
    students.push(...res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }

  console.log(`미수금 학생 ${students.length}명 조회 완료`);

  if (students.length === 0) {
    console.log('미수금 학생 없음 - 알림 생략');
    return;
  }

  let totalUnpaid = 0;
  const lines = students.map(p => {
    const rawName = p.properties['이름']?.title?.[0]?.plain_text ?? '?';
    const name = stripEmoji(rawName);
    const amount = p.properties['미수금 합계']?.rollup?.number ?? 0;
    totalUnpaid += amount;
    return `• ${name}: ${amount.toLocaleString('ko-KR')}원`;
  });

  const message = [
    `미수금 학생 ${students.length}명 / 합계 ${totalUnpaid.toLocaleString('ko-KR')}원`,
    '',
    ...lines,
  ].join('\n');

  await sendNtfy('💸 미수금 알림', message, 4);
  await sendKakao(MY_PHONE, KAKAO_TPL_UNPAID, {
    '#{건수}': String(students.length),
    '#{합계}': totalUnpaid.toLocaleString('ko-KR'),
    '#{목록}': lines.join('\n'),
  });
}

main().catch(err => {
  console.error('오류:', err.message);
  process.exit(1);
});
