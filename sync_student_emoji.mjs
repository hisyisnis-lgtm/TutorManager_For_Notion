// 학생 상태에 따라 이름 앞 이모지를 자동 동기화하는 스크립트
// GitHub Actions에서 매시간 자동 실행됨

const TOKEN = process.env.NOTION_TOKEN;
const STUDENT_DB_ID = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';

const STATUS_EMOJI = {
  '🟢 수강중': '🟢',
  '🟡 일시중단': '🟡',
  '⚫ 수강종료': '⚫',
};
const ALL_EMOJIS = Object.values(STATUS_EMOJI);

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

async function fetchAllStudents() {
  const students = [];
  let cursor = undefined;

  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const res = await notion('POST', `/databases/${STUDENT_DB_ID}/query`, body);
    students.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  return students;
}

function stripEmoji(name) {
  for (const emoji of ALL_EMOJIS) {
    if (name.startsWith(emoji + ' ')) {
      return name.slice(emoji.length + 1);
    }
  }
  return name;
}

async function syncEmojis() {
  console.log('학생 목록 조회 중...');
  const students = await fetchAllStudents();
  console.log(`총 ${students.length}명 조회 완료`);

  let updatedCount = 0;

  for (const student of students) {
    const titleArr = student.properties['이름']?.title ?? [];
    const currentName = titleArr.map(t => t.plain_text).join('');
    const status = student.properties['상태']?.select?.name ?? null;
    const targetEmoji = status ? STATUS_EMOJI[status] : null;

    const baseName = stripEmoji(currentName);
    const expectedName = targetEmoji ? `${targetEmoji} ${baseName}` : baseName;

    if (currentName === expectedName) continue;

    console.log(`업데이트: "${currentName}" → "${expectedName}"`);
    await notion('PATCH', `/pages/${student.id}`, {
      properties: {
        이름: {
          title: [{ text: { content: expectedName } }],
        },
      },
    });
    updatedCount++;
  }

  if (updatedCount === 0) {
    console.log('변경 사항 없음 - 모든 이모지가 최신 상태입니다.');
  } else {
    console.log(`완료: ${updatedCount}명 이름 업데이트됨`);
  }
}

syncEmojis().catch(err => {
  console.error('오류 발생:', err.message);
  process.exit(1);
});
