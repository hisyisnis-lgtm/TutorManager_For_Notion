// 노션 9개 DB를 모두 query하여 JSON으로 직렬화 + gzip 압축 → BACKUP_OUTPUT_PATH 에 저장.
// R2 업로드는 워크플로우 다음 step에서 wrangler CLI로 처리 (이 스크립트는 압축 파일 생성까지만 담당).
//
// 환경변수:
//   NOTION_TOKEN          — Notion API 토큰 (필수)
//   BACKUP_OUTPUT_PATH    — 출력 파일 경로 (default: /tmp/notion-backup.json.gz)
//   NTFY_TOPIC_CRITICAL   — runWithAlert가 실패 시 발송할 토픽
//
// 백업 데이터: properties + 페이지 메타데이터 (raw 페이지 객체 그대로).
// 페이지 본문(blocks)은 미포함 — 본문까지 필요해지면 별도 fetchBlocks 추가.

import { writeFileSync } from 'fs';
import { gzipSync } from 'node:zlib';
import { createNotionClient, runWithAlert } from './notion_utils.mjs';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
if (!NOTION_TOKEN) {
  console.error('NOTION_TOKEN 환경변수가 없습니다.');
  process.exit(1);
}

const OUTPUT_PATH = process.env.BACKUP_OUTPUT_PATH || '/tmp/notion-backup.json.gz';

// 백업 대상 DB 9개 (architecture.md 참조 — snapshot_schema.mjs는 6개만이라 별도 정의)
const DBS = {
  '학생': '314838fa-f2a6-8143-a6c7-e59c50f3bbdb',
  '수업_캘린더': '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb',
  '수업_유형_설정': '314838fa-f2a6-81c3-b4e4-da87c48f9b43',
  '할인_이벤트': '314838fa-f2a6-81d3-9ce4-c628edab065b',
  '수강료_결제_내역': '314838fa-f2a6-8154-935b-edd3d2fbea83',
  '수업_일지': '318838fa-f2a6-81f1-9b9c-fd379b1026ed',
  '예약_불가_날짜': '31e838fa-f2a6-81d3-b034-c47a4f0e5f3e',
  '무료상담_신청': '324838fa-f2a6-815d-99a7-ff165e8f78aa',
  '숙제': '5ce7d5ef-7b80-4795-843f-325f4ca868e2',
};

async function main() {
  const { queryAll } = createNotionClient(NOTION_TOKEN);

  const backup = {
    backup_at: new Date().toISOString(),
    schema_version: 1,
    db_count: Object.keys(DBS).length,
    databases: {},
  };

  let totalPages = 0;
  for (const [name, id] of Object.entries(DBS)) {
    process.stdout.write(`📥 ${name} 페이지 조회 중...`);
    const pages = await queryAll(id);
    backup.databases[name] = {
      id,
      page_count: pages.length,
      pages,
    };
    totalPages += pages.length;
    console.log(` ✅ ${pages.length}개`);
  }

  const json = JSON.stringify(backup);
  const compressed = gzipSync(Buffer.from(json));
  writeFileSync(OUTPUT_PATH, compressed);

  const rawKB = (json.length / 1024).toFixed(1);
  const gzKB = (compressed.length / 1024).toFixed(1);
  const ratio = ((1 - compressed.length / json.length) * 100).toFixed(1);

  console.log(`\n✅ 백업 완료`);
  console.log(`   - 출력 경로: ${OUTPUT_PATH}`);
  console.log(`   - DB 수: ${Object.keys(DBS).length}`);
  console.log(`   - 총 페이지: ${totalPages}`);
  console.log(`   - 원본 JSON: ${rawKB} KB`);
  console.log(`   - 압축 후: ${gzKB} KB (${ratio}% 감소)`);

  // GitHub Actions output 변수로 전달 (다음 step에서 사용 가능)
  if (process.env.GITHUB_OUTPUT) {
    const fs = await import('fs');
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `total_pages=${totalPages}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `compressed_size=${compressed.length}\n`);
  }
}

runWithAlert('backup_to_r2.mjs', main);
