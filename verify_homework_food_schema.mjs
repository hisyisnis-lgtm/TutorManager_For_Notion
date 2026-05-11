// 숙제 먹이 시스템을 위한 노션 DB 속성 검증 스크립트 (read-only)
// 사용법: NOTION_TOKEN=ntn_... node verify_homework_food_schema.mjs

const STUDENT_DB_ID  = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';
const HOMEWORK_DB_ID = '5ce7d5ef-7b80-4795-843f-325f4ca868e2';
const NOTION_TOKEN = process.env.NOTION_TOKEN;

if (!NOTION_TOKEN) {
  console.error('❌ NOTION_TOKEN 환경변수가 설정되어 있지 않습니다.');
  process.exit(1);
}

async function getDb(id) {
  const res = await fetch(`https://api.notion.com/v1/databases/${id}`, {
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function check(label, ok, detail) {
  const icon = ok ? '✅' : '❌';
  console.log(`${icon} ${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

let allOk = true;

console.log('\n=== 숙제 DB 검사 ===');
const hwDb = await getDb(HOMEWORK_DB_ID);
const hwProps = hwDb.properties;

// 1) 제출 먹이 마크 — date
{
  const p = hwProps['제출 먹이 마크'];
  allOk &= check('제출 먹이 마크: 존재 + date', p?.type === 'date', p ? `현재 타입 ${p.type}` : '속성 없음');
}

// 2) 피드백 확인일 — date
{
  const p = hwProps['피드백 확인일'];
  allOk &= check('피드백 확인일: 존재 + date', p?.type === 'date', p ? `현재 타입 ${p.type}` : '속성 없음');
}

// 3) 제출 먹이 — formula  if(empty(prop("제출 먹이 마크")), 0, 1)
{
  const p = hwProps['제출 먹이'];
  const expr = p?.formula?.expression?.replace(/\s+/g, '') ?? '';
  const expected = 'if(empty(prop("제출 먹이 마크")),0,1)';
  const ok = p?.type === 'formula' && expr === expected;
  allOk &= check('제출 먹이: formula 식 일치', ok, p ? `식: ${p.formula?.expression}` : '속성 없음');
}

// 4) 피드백 먹이 — formula  if(empty(prop("피드백 확인일")), 0, 1)
{
  const p = hwProps['피드백 먹이'];
  const expr = p?.formula?.expression?.replace(/\s+/g, '') ?? '';
  const expected = 'if(empty(prop("피드백 확인일")),0,1)';
  const ok = p?.type === 'formula' && expr === expected;
  allOk &= check('피드백 먹이: formula 식 일치', ok, p ? `식: ${p.formula?.expression}` : '속성 없음');
}

console.log('\n=== 학생 DB 검사 ===');
const stDb = await getDb(STUDENT_DB_ID);
const stProps = stDb.properties;

// 5) 숙제 제출 먹이 — rollup (관계: 숙제, 대상: 제출 먹이, sum)
{
  const p = stProps['숙제 제출 먹이'];
  const r = p?.rollup;
  const ok = p?.type === 'rollup'
    && r?.relation_property_name === '숙제'
    && r?.rollup_property_name === '제출 먹이'
    && r?.function === 'sum';
  allOk &= check('숙제 제출 먹이: rollup 설정', ok, p ? `relation=${r?.relation_property_name}, target=${r?.rollup_property_name}, func=${r?.function}` : '속성 없음');
}

// 6) 피드백 확인 먹이 — rollup (관계: 숙제, 대상: 피드백 먹이, sum)
{
  const p = stProps['피드백 확인 먹이'];
  const r = p?.rollup;
  const ok = p?.type === 'rollup'
    && r?.relation_property_name === '숙제'
    && r?.rollup_property_name === '피드백 먹이'
    && r?.function === 'sum';
  allOk &= check('피드백 확인 먹이: rollup 설정', ok, p ? `relation=${r?.relation_property_name}, target=${r?.rollup_property_name}, func=${r?.function}` : '속성 없음');
}

console.log('');
if (allOk) {
  console.log('🎉 모든 속성이 올바르게 설정되었습니다.');
  process.exit(0);
} else {
  console.log('⚠️  일부 속성이 누락되었거나 설정이 다릅니다. 위 ❌ 항목을 확인해 주세요.');
  process.exit(1);
}
