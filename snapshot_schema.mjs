// 노션 DB 스키마 스냅샷 스크립트
// GitHub Actions에서 주 1회 실행 → notion_schema/ 에 JSON 저장 → git 변경 감지

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
if (!NOTION_TOKEN) {
  console.error('NOTION_TOKEN 환경변수가 없습니다.');
  process.exit(1);
}

const DBS = {
  '학생': '314838fa-f2a6-8143-a6c7-e59c50f3bbdb',
  '수업_캘린더': '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb',
  '수업_유형_설정': '314838fa-f2a6-81c3-b4e4-da87c48f9b43',
  '할인_이벤트': '314838fa-f2a6-81d3-9ce4-c628edab065b',
  '수강료_결제_내역': '314838fa-f2a6-8154-935b-edd3d2fbea83',
  '수업_일지': '318838fa-f2a6-81f1-9b9c-fd379b1026ed',
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, 'notion_schema');

async function fetchDB(dbId) {
  const res = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DB 조회 실패 (${dbId}): ${res.status} ${text}`);
  }
  return res.json();
}

function extractSchema(db) {
  return {
    id: db.id,
    title: db.title?.map(t => t.plain_text).join('') ?? '',
    url: db.url,
    properties: Object.fromEntries(
      Object.entries(db.properties).map(([name, prop]) => [
        name,
        summarizeProperty(prop),
      ])
    ),
  };
}

function summarizeProperty(prop) {
  const base = { type: prop.type, id: prop.id };

  switch (prop.type) {
    case 'select':
      return { ...base, options: prop.select.options.map(o => ({ name: o.name, color: o.color })) };
    case 'multi_select':
      return { ...base, options: prop.multi_select.options.map(o => ({ name: o.name, color: o.color })) };
    case 'relation':
      return { ...base, database_id: prop.relation.database_id, type: prop.relation.type ?? 'single_property' };
    case 'rollup':
      return { ...base, relation_property_name: prop.rollup.relation_property_name, rollup_property_name: prop.rollup.rollup_property_name, function: prop.rollup.function };
    case 'formula':
      return { ...base, expression: prop.formula.expression };
    case 'number':
      return { ...base, format: prop.number.format };
    default:
      return base;
  }
}

mkdirSync(OUTPUT_DIR, { recursive: true });

let hasError = false;
for (const [name, id] of Object.entries(DBS)) {
  try {
    process.stdout.write(`📥 ${name} 스키마 조회 중...`);
    const db = await fetchDB(id);
    const schema = extractSchema(db);
    const filePath = join(OUTPUT_DIR, `${name}.json`);
    writeFileSync(filePath, JSON.stringify(schema, null, 2) + '\n', 'utf8');
    console.log(` ✅ 저장 완료 → notion_schema/${name}.json`);
  } catch (err) {
    console.error(` ❌ ${err.message}`);
    hasError = true;
  }
}

// 스냅샷 메타 파일 (마지막 실행 시각)
const meta = {
  snapshot_at: new Date().toISOString(),
  dbs: Object.keys(DBS),
};
writeFileSync(join(OUTPUT_DIR, '_meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');

if (hasError) {
  console.error('\n일부 DB 조회에 실패했습니다.');
  process.exit(1);
}
console.log('\n✅ 모든 스키마 스냅샷 완료');
