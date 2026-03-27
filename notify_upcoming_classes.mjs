// 내일 수업 알림 스크립트
// GitHub Actions에서 매일 21:00 KST (12:00 UTC)에 자동 실행됨

import { createHmac } from 'crypto';

const TOKEN = process.env.NOTION_TOKEN;
const NTFY_TOPIC = process.env.NTFY_TOPIC;
const NTFY_TOKEN = process.env.NTFY_TOKEN;
const CLASS_DB_ID = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';

const SOLAPI_API_KEY = process.env.SOLAPI_API_KEY;
const SOLAPI_API_SECRET = process.env.SOLAPI_API_SECRET;
const KAKAO_PFID = process.env.KAKAO_PFID;
const MY_PHONE = process.env.MY_PHONE;
const KAKAO_TPL_UPCOMING = process.env.KAKAO_TPL_UPCOMING;

if (!TOKEN) {
  console.error('NOTION_TOKEN 환경변수가 설정되지 않았습니다.');
  process.exit(1);
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

async function sendNtfy(title, message, priority = 3) {
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

// KST 기준 내일 날짜 범위 계산
function getTomorrowKST() {
  const now = new Date();
  const kstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);

  const tomorrow = new Date(kstDate);
  tomorrow.setUTCDate(kstDate.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);

  const dayAfter = new Date(tomorrow);
  dayAfter.setUTCDate(tomorrow.getUTCDate() + 1);

  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  const dayAfterStr = dayAfter.toISOString().split('T')[0];

  return { tomorrowStr, dayAfterStr };
}

const studentCache = {};
async function getStudentNames(relation) {
  if (!relation || relation.length === 0) return [];
  const names = [];
  for (const { id } of relation) {
    if (!studentCache[id]) {
      const page = await notion('GET', `/pages/${id}`);
      studentCache[id] = page.properties['이름']?.title?.[0]?.plain_text ?? '?';
    }
    names.push(studentCache[id]);
  }
  return names;
}

async function main() {
  const { tomorrowStr, dayAfterStr } = getTomorrowKST();
  console.log(`[${new Date().toISOString()}] 내일 수업 조회: ${tomorrowStr}`);

  const res = await notion('POST', `/databases/${CLASS_DB_ID}/query`, {
    filter: {
      and: [
        { property: '수업 일시', date: { on_or_after: `${tomorrowStr}T00:00:00+09:00` } },
        { property: '수업 일시', date: { before: `${dayAfterStr}T00:00:00+09:00` } },
      ],
    },
    sorts: [{ property: '수업 일시', direction: 'ascending' }],
  });

  // 취소된 수업 제외
  const classes = res.results.filter(
    p => p.properties['특이사항']?.select?.name !== '🚫 취소'
  );

  console.log(`내일 수업 ${classes.length}개 (취소 제외)`);

  if (classes.length === 0) {
    console.log('내일 수업 없음 - 알림 생략');
    return;
  }

  const lines = [];
  for (const p of classes) {
    const dateVal = p.properties['수업 일시']?.date?.start;
    const duration = p.properties['수업 시간(분)']?.select?.name;
    const 특이사항 = p.properties['특이사항']?.select?.name;
    const studentRelation = p.properties['학생']?.relation;

    const studentNames = await getStudentNames(studentRelation);
    const timeStr = new Date(dateVal).toLocaleTimeString('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
    });

    const note = 특이사항 ? ` ${특이사항}` : '';
    const names = studentNames.length > 0 ? studentNames.join(', ') : '미지정';
    lines.push(`${timeStr} ${names} (${duration}분)${note}`);
  }

  const message = `총 ${classes.length}개 수업\n\n${lines.join('\n')}`;
  await sendNtfy('📅 내일 수업 안내', message, 3);
  await sendKakao(MY_PHONE, KAKAO_TPL_UPCOMING, {
    '#{건수}': String(classes.length),
    '#{목록}': lines.join('\n'),
  });
}

main().catch(err => {
  console.error('오류:', err.message);
  process.exit(1);
});
