// 수업 캘린더 제목 자동 동기화 스크립트
// 제목이 비어 있는 수업에 "이름 M/D HH:MM" 형식으로 자동 채움
// GitHub Actions에서 30분마다 자동 실행됨

const TOKEN = process.env.NOTION_TOKEN;
const CLASS_DB_ID = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';

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

function stripEmoji(name) {
  return name.replace(/^[🟢🟡⚫]\s/, '');
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
  console.log(`[${new Date().toISOString()}] 수업 제목 동기화 시작`);

  // 제목이 비어 있고, 수업 일시와 학생이 입력된 수업 조회
  const pages = [];
  let cursor = undefined;

  while (true) {
    const body = {
      filter: {
        and: [
          { property: '제목', title: { is_empty: true } },
          { property: '수업 일시', date: { is_not_empty: true } },
          { property: '학생', relation: { is_not_empty: true } },
        ],
      },
    };
    if (cursor) body.start_cursor = cursor;

    const res = await notion('POST', `/databases/${CLASS_DB_ID}/query`, body);
    pages.push(...res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }

  console.log(`제목 미입력 수업 ${pages.length}개 조회`);

  let updated = 0;
  for (const page of pages) {
    const relation = page.properties['학생']?.relation ?? [];
    const dateVal = page.properties['수업 일시']?.date?.start;
    if (!dateVal) continue;

    // 학생 이름 조회 (2:1 수업이면 "이름1, 이름2")
    const names = [];
    for (const { id } of relation) {
      names.push(await getStudentName(id));
    }

    // KST 기준 날짜/시간 포맷
    const date = new Date(dateVal);
    const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    const month = kst.getUTCMonth() + 1;
    const day = kst.getUTCDate();
    const hour = String(kst.getUTCHours()).padStart(2, '0');
    const min = String(kst.getUTCMinutes()).padStart(2, '0');

    const title = `${names.join(', ')} ${month}/${day} ${hour}:${min}`;

    await notion('PATCH', `/pages/${page.id}`, {
      properties: {
        제목: { title: [{ text: { content: title } }] },
      },
    });

    console.log(`  제목 설정: "${title}"`);
    updated++;
  }

  if (updated === 0) {
    console.log('변경 사항 없음 - 모든 제목이 입력되어 있습니다.');
  } else {
    console.log(`완료: ${updated}개 제목 자동 설정됨`);
  }
}

main().catch(err => {
  console.error('오류:', err.message);
  process.exit(1);
});
