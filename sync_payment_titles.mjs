// 수강료 결제 내역 타이틀 자동 동기화 스크립트
// 타이틀(타이틀)가 비어 있고 학생이 입력된 결제 내역에 학생 타이틀을 자동 채움
// GitHub Actions에서 30분마다 자동 실행됨

const TOKEN = process.env.NOTION_TOKEN;
const PAYMENT_DB_ID = '314838fa-f2a6-8154-935b-edd3d2fbea83';
const STUDENT_DB_ID = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';

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

const STATUS_EMOJIS = ['🟢', '🟡', '⚫'];
function stripEmoji(name) {
  for (const emoji of STATUS_EMOJIS) {
    if (name.startsWith(emoji + ' ')) {
      return name.slice(emoji.length + 1);
    }
  }
  return name;
}

const studentCache = {};
async function getStudentName(id) {
  if (studentCache[id]) return studentCache[id];
  const page = await notion('GET', `/pages/${id}`);
  const raw = page.properties['이름']?.title?.[0]?.plain_text ?? '?';
  studentCache[id] = stripEmoji(raw);
  return studentCache[id];
}

async function main() {
  console.log(`[${new Date().toISOString()}] 결제 내역 타이틀 동기화 시작`);

  const pages = [];
  let cursor = undefined;

  while (true) {
    const body = {
      filter: {
        and: [
          { property: '타이틀', title: { is_empty: true } },
          { property: '학생', relation: { is_not_empty: true } },
        ],
      },
    };
    if (cursor) body.start_cursor = cursor;

    const res = await notion('POST', `/databases/${PAYMENT_DB_ID}/query`, body);
    pages.push(...res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }

  console.log(`타이틀 미입력 결제 내역 ${pages.length}개 조회`);

  let updated = 0;
  for (const page of pages) {
    const relation = page.properties['학생']?.relation ?? [];

    const names = [];
    for (const { id } of relation) {
      names.push(await getStudentName(id));
    }

    const title = names.join(', ');

    await notion('PATCH', `/pages/${page.id}`, {
      properties: {
        타이틀: { title: [{ text: { content: title } }] },
      },
    });

    console.log(`  타이틀 설정: "${title}"`);
    updated++;
  }

  if (updated === 0) {
    console.log('변경 사항 없음 - 모든 결제 내역 타이틀가 입력되어 있습니다.');
  } else {
    console.log(`완료: ${updated}개 결제 내역 타이틀 자동 설정됨`);
  }
}

main().catch(err => {
  console.error('오류:', err.message);
  process.exit(1);
});
