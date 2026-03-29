// 잔여 회차 부족 학생 결제 독려 알림 스크립트
// GitHub Actions에서 매일 10:00 KST (01:00 UTC)에 자동 실행됨

const TOKEN = process.env.NOTION_TOKEN;
const NTFY_TOPIC = process.env.NTFY_TOPIC;
const NTFY_TOKEN = process.env.NTFY_TOKEN;
const STUDENT_DB_ID = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';

// 잔여 시간 회차가 이 값 이하인 학생에게 알림 (1 = 1시간 분량)
const THRESHOLD = 1;

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

function stripEmoji(name) {
  return name.replace(/^[🟢🟡⚫]\s/, '');
}

async function main() {
  console.log(`[${new Date().toISOString()}] 잔여 회차 부족 학생 조회 시작`);

  // 수강중 학생 전체 조회
  const students = [];
  let cursor = undefined;

  while (true) {
    const body = {
      filter: {
        property: '상태',
        select: { equals: '🟢 수강중' },
      },
    };
    if (cursor) body.start_cursor = cursor;

    const res = await notion('POST', `/databases/${STUDENT_DB_ID}/query`, body);
    students.push(...res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }

  console.log(`수강중 학생 ${students.length}명 조회 완료`);

  // 잔여 시간 회차 ≤ THRESHOLD 인 학생 필터링
  const lowStudents = students
    .map(p => {
      const props = p.properties;
      const rawName = props['이름']?.title?.[0]?.plain_text ?? '?';
      const name = stripEmoji(rawName);
      const remaining = props['잔여 시간 회차']?.formula?.number ?? Infinity;
      return { name, remaining };
    })
    .filter(s => s.remaining <= THRESHOLD)
    .sort((a, b) => a.remaining - b.remaining);

  console.log(`잔여 회차 부족 학생 ${lowStudents.length}명`);

  if (lowStudents.length === 0) {
    console.log('해당 학생 없음 - 알림 생략');
    return;
  }

  const lines = lowStudents.map(s => {
    const r = s.remaining;
    const label =
      r <= 0 ? `${r}회차 (초과)` :
      r === 0.5 ? '0.5회차 남음' :
      `${r}회차 남음`;
    return `• ${s.name}: ${label}`;
  });

  const message = `결제 요청이 필요한 학생 ${lowStudents.length}명\n\n${lines.join('\n')}`;
  await sendNtfy('💳 잔여 회차 부족 알림', message, 4);
}

main().catch(err => {
  console.error('오류:', err.message);
  process.exit(1);
});
