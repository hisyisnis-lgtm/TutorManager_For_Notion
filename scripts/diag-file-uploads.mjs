// 숙제 제출 실패 진단 — Notion 파일 업로드 세션 목록 조회 (읽기 전용)
//
// 워커의 uploadFileToNotion 은 ① file_uploads 세션 생성 → ② upload_url 로 파일 전송
// 2단계로 동작한다. ②에서 거부되면 세션 객체는 남되 uploaded 로 넘어가지 못한다.
// 이 스크립트는 그 세션 목록을 시간순으로 뽑아 파일명·크기·상태를 보여준다.
// 제출 실패 원인(특히 크기 초과)을 사후에 확인하는 용도.
//
// 실행:
//   export PATH="/c/Program Files/nodejs:$PATH"
//   NOTION_TOKEN=ntn_... node scripts/diag-file-uploads.mjs
//   NOTION_TOKEN=ntn_... node scripts/diag-file-uploads.mjs --days 7

const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) {
  console.error('NOTION_TOKEN 환경변수가 필요합니다.');
  process.exit(1);
}

const daysArg = process.argv.indexOf('--days');
const DAYS = daysArg >= 0 ? Number(process.argv[daysArg + 1]) || 3 : 3;

// Notion 무료 워크스페이스의 파일당 상한. 유료는 5 GiB.
const FREE_PLAN_LIMIT = 5 * 1024 * 1024;

async function listFileUploads() {
  const out = [];
  let cursor;
  do {
    const url = new URL('https://api.notion.com/v1/file_uploads');
    url.searchParams.set('page_size', '100');
    if (cursor) url.searchParams.set('start_cursor', cursor);
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Notion-Version': '2022-06-28',
      },
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`조회 실패 (${res.status}): ${data.message || JSON.stringify(data).slice(0, 300)}`);
      process.exit(1);
    }
    out.push(...(data.results ?? []));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return out;
}

const kst = (iso) =>
  iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '-';
const mb = (bytes) =>
  Number.isFinite(Number(bytes)) ? `${(Number(bytes) / 1024 / 1024).toFixed(2)} MB` : '?';

const all = await listFileUploads();
const since = Date.now() - DAYS * 86400 * 1000;
const recent = all
  .filter((f) => new Date(f.created_time).getTime() >= since)
  .sort((a, b) => new Date(a.created_time) - new Date(b.created_time));

console.log(`\n총 ${all.length}건 조회 · 최근 ${DAYS}일 ${recent.length}건\n`);

if (recent.length === 0) {
  console.log('최근 기록이 없습니다. (Notion이 오래된 업로드 세션을 이미 정리했을 수 있습니다)');
} else {
  console.log('생성시각(KST)              상태       크기         파일명');
  console.log('─'.repeat(90));
  for (const f of recent) {
    const over = Number(f.content_length) > FREE_PLAN_LIMIT ? '  ← 5MiB 초과' : '';
    console.log(
      `${kst(f.created_time).padEnd(26)}${String(f.status).padEnd(11)}${mb(f.content_length).padStart(10)}   ${f.filename ?? '(파일명 없음)'}${over}`
    );
  }

  const byStatus = recent.reduce((acc, f) => {
    acc[f.status] = (acc[f.status] || 0) + 1;
    return acc;
  }, {});
  console.log('\n상태별:', byStatus);

  const failed = recent.filter((f) => f.status !== 'uploaded');
  const overLimit = recent.filter((f) => Number(f.content_length) > FREE_PLAN_LIMIT);
  console.log(`uploaded 아님: ${failed.length}건 · 5MiB 초과: ${overLimit.length}건`);
  if (overLimit.length > 0) {
    console.log('\n※ 5MiB 초과 파일이 있습니다 — 무료 워크스페이스면 Notion이 거부하는 크기입니다.');
  }
}
