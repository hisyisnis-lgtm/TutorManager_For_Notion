// 학생 DB에 "공유일" date 속성 추가 (idempotent — 이미 있으면 스킵)
// 사용법: NOTION_TOKEN=ntn_... node add_share_date_property.mjs
// Windows bash: export PATH="/c/Program Files/nodejs:$PATH" 먼저 실행

const STUDENT_DB_ID = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';
const PROPERTY_NAME = '공유일';
const NOTION_TOKEN = process.env.NOTION_TOKEN;

if (!NOTION_TOKEN) {
  console.error('❌ NOTION_TOKEN 환경변수가 설정되어 있지 않습니다.');
  console.error('   사용 예: NOTION_TOKEN=ntn_... node add_share_date_property.mjs');
  process.exit(1);
}

async function notion(method, path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Notion API ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

console.log('학생 DB 스키마 조회 중...');
const db = await notion('GET', `/databases/${STUDENT_DB_ID}`);

if (db.properties[PROPERTY_NAME]) {
  const existing = db.properties[PROPERTY_NAME];
  if (existing.type === 'date') {
    console.log(`✅ "${PROPERTY_NAME}" 속성이 이미 date 타입으로 존재합니다. (스킵)`);
    process.exit(0);
  }
  console.error(`❌ "${PROPERTY_NAME}" 속성이 다른 타입(${existing.type})으로 이미 존재합니다. 수동 확인 필요.`);
  process.exit(1);
}

console.log(`"${PROPERTY_NAME}" date 속성 추가 중...`);
await notion('PATCH', `/databases/${STUDENT_DB_ID}`, {
  properties: {
    [PROPERTY_NAME]: { date: {} },
  },
});

console.log(`✅ 학생 DB에 "${PROPERTY_NAME}" date 속성을 추가했습니다.`);
