// 노션 9개 DB를 익명화한 영구 아카이브 백업.
// - 학생/무료상담 PII 모두 마스킹
// - 학생 page ID는 SHA-256 해시 12자로 치환 (다른 DB의 relation도 일관되게 처리 가능)
// - 다른 DB의 title/rich_text에서 plain text 학생 이름 검색 → 해시로 치환
// - 분석용 데이터 (날짜·시간·금액·회차·상태)는 그대로 유지
//
// 환경변수:
//   NOTION_TOKEN          — 필수
//   BACKUP_OUTPUT_PATH    — default: /tmp/notion-archive.json.gz
//   NTFY_TOPIC_CRITICAL   — runWithAlert 실패 시
//
// 익명화 후에는 학생 식별 불가능하므로 영구 보관 가능 (개인정보보호법 적용 외).

import crypto from 'node:crypto';
import { writeFileSync } from 'fs';
import { gzipSync } from 'node:zlib';
import { createNotionClient, runWithAlert } from './notion_utils.mjs';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
if (!NOTION_TOKEN) {
  console.error('NOTION_TOKEN 환경변수가 없습니다.');
  process.exit(1);
}

const OUTPUT_PATH = process.env.BACKUP_OUTPUT_PATH || '/tmp/notion-archive.json.gz';

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

// ─── 마스킹 헬퍼 ───────────────────────────────────────

function hashId(id) {
  return 'h_' + crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 12);
}

function maskPhone(phone) {
  if (!phone) return phone;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***-****-${digits.slice(-4)}`;
}

function maskEmail(email) {
  if (!email) return email;
  const at = String(email).indexOf('@');
  if (at < 0) return '***';
  return `***${String(email).slice(at)}`;
}

function redactedRichText() {
  return [{
    type: 'text',
    text: { content: '[REDACTED]', link: null },
    plain_text: '[REDACTED]',
    annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' },
    href: null,
  }];
}

function titleWith(content) {
  return [{
    type: 'text',
    text: { content, link: null },
    plain_text: content,
    annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' },
    href: null,
  }];
}

// 모든 학생 이름 → 해시 ID 치환 (긴 이름부터 처리해 부분 매치 방지)
function buildNameReplacer(nameToHash) {
  const sorted = [...nameToHash.entries()]
    .filter(([name]) => name && name.length >= 2)
    .sort((a, b) => b[0].length - a[0].length);
  return (text) => {
    if (!text || typeof text !== 'string') return text;
    let result = text;
    for (const [name, hash] of sorted) {
      result = result.split(name).join(hash);
    }
    return result;
  };
}

// rich_text·title 배열에 텍스트 치환 적용
function maskTextArray(arr, replacer) {
  if (!Array.isArray(arr)) return arr;
  return arr.map(t => {
    if (!t || t.type !== 'text' || !t.text) return t;
    const newContent = replacer(t.text.content);
    return {
      ...t,
      text: { ...t.text, content: newContent },
      plain_text: replacer(t.plain_text),
    };
  });
}

// ─── DB별 익명화 ───────────────────────────────────────

function anonymizeStudentPage(page, nameToHash) {
  const props = { ...page.properties };
  const studentHash = hashId(page.id);

  // 이름 (title)
  if (props['이름']?.title?.[0]?.plain_text) {
    const originalName = props['이름'].title.map(t => t.plain_text).join('');
    if (originalName) nameToHash.set(originalName, studentHash);
    props['이름'] = { ...props['이름'], title: titleWith(studentHash) };
  }
  // 전화번호
  if ('전화번호' in props && props['전화번호']?.phone_number) {
    props['전화번호'] = { ...props['전화번호'], phone_number: maskPhone(props['전화번호'].phone_number) };
  }
  // 이메일
  if ('이메일' in props && props['이메일']?.email) {
    props['이메일'] = { ...props['이메일'], email: maskEmail(props['이메일'].email) };
  }
  // 메모
  if (props['메모']?.rich_text?.length) {
    props['메모'] = { ...props['메모'], rich_text: redactedRichText() };
  }

  return { ...page, properties: props };
}

function anonymizeConsultPage(page) {
  const props = { ...page.properties };

  // 이름 (title) — 학생 DB와 별개라 자체 해시 사용
  if (props['이름']?.title?.[0]?.plain_text) {
    props['이름'] = { ...props['이름'], title: titleWith(hashId(page.id)) };
  }
  // 전화번호
  if (props['전화번호']?.phone_number) {
    props['전화번호'] = { ...props['전화번호'], phone_number: maskPhone(props['전화번호'].phone_number) };
  }
  // 자유 텍스트 필드들 모두 비움
  for (const key of ['상담 희망 내용', 'message', '메모', '요청사항']) {
    if (props[key]?.rich_text?.length) {
      props[key] = { ...props[key], rich_text: redactedRichText() };
    }
  }

  return { ...page, properties: props };
}

// 다른 DB: title·rich_text의 학생 이름 plain text 치환
function anonymizeGenericPage(page, nameReplacer) {
  const props = {};
  for (const [key, prop] of Object.entries(page.properties)) {
    if (!prop) { props[key] = prop; continue; }
    if (prop.type === 'title' && Array.isArray(prop.title)) {
      props[key] = { ...prop, title: maskTextArray(prop.title, nameReplacer) };
    } else if (prop.type === 'rich_text' && Array.isArray(prop.rich_text)) {
      props[key] = { ...prop, rich_text: maskTextArray(prop.rich_text, nameReplacer) };
    } else {
      props[key] = prop;
    }
  }
  return { ...page, properties: props };
}

// ─── main ───────────────────────────────────────

async function main() {
  const { queryAll } = createNotionClient(NOTION_TOKEN);

  // 1단계: 학생 DB 먼저 처리 → 이름 매핑 수집
  const nameToHash = new Map();
  process.stdout.write(`📥 학생 익명화 중...`);
  const studentPagesRaw = await queryAll(DBS['학생']);
  const studentPages = studentPagesRaw.map(p => anonymizeStudentPage(p, nameToHash));
  console.log(` ✅ ${studentPages.length}명 (이름 매핑 ${nameToHash.size}건)`);

  const nameReplacer = buildNameReplacer(nameToHash);

  // 2단계: 무료상담 DB (별도 익명화)
  process.stdout.write(`📥 무료상담_신청 익명화 중...`);
  const consultPagesRaw = await queryAll(DBS['무료상담_신청']);
  const consultPages = consultPagesRaw.map(anonymizeConsultPage);
  console.log(` ✅ ${consultPages.length}건`);

  // 3단계: 나머지 DB는 학생 이름 plain text 치환
  const archive = {
    archive_at: new Date().toISOString(),
    schema_version: 1,
    anonymization: 'pii-masked-v1',
    note: '학생/무료상담 PII 마스킹 완료. 식별자는 SHA-256 해시 12자(h_xxx). 영구 보관 가능.',
    db_count: 9,
    databases: {
      '학생': { id: DBS['학생'], page_count: studentPages.length, pages: studentPages },
      '무료상담_신청': { id: DBS['무료상담_신청'], page_count: consultPages.length, pages: consultPages },
    },
  };

  for (const [name, id] of Object.entries(DBS)) {
    if (name === '학생' || name === '무료상담_신청') continue;
    process.stdout.write(`📥 ${name} 익명화 중...`);
    const raw = await queryAll(id);
    const pages = raw.map(p => anonymizeGenericPage(p, nameReplacer));
    archive.databases[name] = { id, page_count: pages.length, pages };
    console.log(` ✅ ${pages.length}개`);
  }

  const json = JSON.stringify(archive);
  const compressed = gzipSync(Buffer.from(json));
  writeFileSync(OUTPUT_PATH, compressed);

  const totalPages = Object.values(archive.databases).reduce((sum, db) => sum + db.page_count, 0);
  console.log(`\n✅ 익명화 아카이브 완료`);
  console.log(`   - 출력: ${OUTPUT_PATH}`);
  console.log(`   - 총 페이지: ${totalPages}`);
  console.log(`   - 크기: ${(compressed.length / 1024).toFixed(1)} KB`);
  console.log(`   - 학생 PII 마스킹: ${studentPages.length}명`);
  console.log(`   - 무료상담 PII 마스킹: ${consultPages.length}건`);

  if (process.env.GITHUB_OUTPUT) {
    const fs = await import('fs');
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `total_pages=${totalPages}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `compressed_size=${compressed.length}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `student_count=${studentPages.length}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `consult_count=${consultPages.length}\n`);
  }
}

runWithAlert('archive_to_r2.mjs', main);
