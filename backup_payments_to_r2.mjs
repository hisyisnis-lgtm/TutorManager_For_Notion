// 수강료 결제 내역 DB만 별도 백업 → R2 영구 5년 보관 (세법 의무 5년).
// 다른 DB들은 weekly-backup.yml(1년) 또는 monthly-archive.yml(영구 익명화)로 처리.
//
// raw 데이터 그대로 저장 — 거래 증빙으로 활용 가능해야 익명화 안 함.
// 결제 DB만이라 PII 노출은 학생 relation ID 정도 (이름·전화 직접 포함 안 함).
// 만약 결제 메모(rich_text)에 학생 이름이 plain text로 들어있다면 그건 노출됨 — 이건 세법 의무 우선.
//
// 환경변수:
//   NOTION_TOKEN          — 필수
//   BACKUP_OUTPUT_PATH    — default: /tmp/notion-payments.json.gz

import { writeFileSync } from 'fs';
import { gzipSync } from 'node:zlib';
import { createNotionClient, runWithAlert } from './notion_utils.mjs';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
if (!NOTION_TOKEN) {
  console.error('NOTION_TOKEN 환경변수가 없습니다.');
  process.exit(1);
}

const OUTPUT_PATH = process.env.BACKUP_OUTPUT_PATH || '/tmp/notion-payments.json.gz';
const PAYMENTS_DB_ID = '314838fa-f2a6-8154-935b-edd3d2fbea83';

async function main() {
  const { queryAll } = createNotionClient(NOTION_TOKEN);

  process.stdout.write('📥 수강료 결제 내역 DB 조회 중...');
  const pages = await queryAll(PAYMENTS_DB_ID);
  console.log(` ✅ ${pages.length}개`);

  const backup = {
    backup_at: new Date().toISOString(),
    purpose: 'tax-compliance-5year',
    schema_version: 1,
    note: '한국 세법 부가가치세법/소득세법 5년 보존 의무 대응. 거래 증빙 raw 데이터.',
    db: {
      name: '수강료_결제_내역',
      id: PAYMENTS_DB_ID,
      page_count: pages.length,
      pages,
    },
  };

  const json = JSON.stringify(backup);
  const compressed = gzipSync(Buffer.from(json));
  writeFileSync(OUTPUT_PATH, compressed);

  console.log(`\n✅ 결제 백업 완료`);
  console.log(`   - 출력: ${OUTPUT_PATH}`);
  console.log(`   - 결제 건수: ${pages.length}`);
  console.log(`   - 원본 JSON: ${(json.length / 1024).toFixed(1)} KB`);
  console.log(`   - 압축 후: ${(compressed.length / 1024).toFixed(1)} KB`);

  if (process.env.GITHUB_OUTPUT) {
    const fs = await import('fs');
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `payment_count=${pages.length}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `compressed_size=${compressed.length}\n`);
  }
}

runWithAlert('backup_payments_to_r2.mjs', main);
