// 일회성 복구 스크립트 — 숙제 파일 속성의 동명 파일 이름을 유일화한다.
//
// 배경: 다운로드/미리보기 라우트가 파일을 "이름"으로 식별하는데(노션 files 속성은 동명 파일을
// 허용), 서로 다른 파일이 같은 이름을 가지면 전부 첫 번째 파일로만 조회되는 버그가 있었다.
// (강세희 이미지 3장 동일, 배은빈 녹음 중복 등) 코드는 worker/lib/upload.js dedupeFileNames 로
// 재발 방지했고, 이 스크립트는 **이미 저장된** 동명 파일의 이름만 ` (2)`, ` (3)` 으로 갈라준다.
// 파일 바이트(notion-hosted)는 그대로 두고 name 만 바꾼다 — 복구이지 재업로드가 아니다.
//
// SDK 의존성 없이 Notion REST API 를 fetch 로 직접 호출한다 (@notionhq/client 버전 무관).
//
// 실행 (PowerShell):
//   $env:NOTION_TOKEN = "ntn_..."
//   $env:DRY_RUN = "1"            # 미리보기 (변경 안 함)
//   node fix_duplicate_homework_filenames.mjs
//   # 실제 적용:
//   $env:DRY_RUN = ""
//   node fix_duplicate_homework_filenames.mjs

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DRY_RUN = !!process.env.DRY_RUN;
const HOMEWORK_DB = '5ce7d5ef-7b80-4795-843f-325f4ca868e2';
const NOTION_VERSION = '2022-06-28';

// 검사 대상 file 속성 3종
const FILE_PROPS = ['학생 제출 파일', '피드백 파일', '과제 파일'];

if (!NOTION_TOKEN) {
  console.error('NOTION_TOKEN 환경변수가 필요합니다.');
  process.exit(1);
}

async function notion(method, path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${res.status} ${path}: ${data.message || JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

// worker/lib/upload.js dedupeFileNames 와 동일 로직 (대소문자 무시, 확장자 보존)
function dedupeFileNames(names) {
  const used = new Set();
  const out = [];
  for (const raw of Array.isArray(names) ? names : []) {
    const name = (typeof raw === 'string' && raw) ? raw : 'file';
    let candidate = name;
    if (used.has(candidate.toLowerCase())) {
      const dot = name.lastIndexOf('.');
      const hasExt = dot > 0 && dot < name.length - 1;
      const base = hasExt ? name.slice(0, dot) : name;
      const ext = hasExt ? name.slice(dot) : '';
      let n = 2;
      do {
        candidate = `${base} (${n})${ext}`;
        n += 1;
      } while (used.has(candidate.toLowerCase()));
    }
    used.add(candidate.toLowerCase());
    out.push(candidate);
  }
  return out;
}

async function queryAll() {
  const pages = [];
  let cursor;
  do {
    const res = await notion('POST', `/databases/${HOMEWORK_DB}/query`, {
      start_cursor: cursor,
      page_size: 100,
    });
    pages.push(...(res.results || []));
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return pages;
}

function titleOf(page) {
  const t = page.properties?.['제목']?.title ?? [];
  return t.map((x) => x.plain_text).join('') || '(제목 없음)';
}

async function main() {
  console.log(`\n=== 숙제 동명 파일 복구 ${DRY_RUN ? '(DRY RUN — 변경 안 함)' : '(실제 적용)'} ===\n`);
  const pages = await queryAll();
  console.log(`숙제 ${pages.length}건 검사\n`);

  let affectedPages = 0;
  let renamedFiles = 0;

  for (const page of pages) {
    const propsToUpdate = {};
    let pageChanged = false;
    const logLines = [];

    for (const prop of FILE_PROPS) {
      const files = page.properties?.[prop]?.files;
      if (!Array.isArray(files) || files.length < 2) continue;

      const oldNames = files.map((f) => f.name);
      const newNames = dedupeFileNames(oldNames);

      const changed = oldNames.some((n, i) => n !== newNames[i]);
      if (!changed) continue;

      // notion-hosted/external 파일 객체를 그대로 두고 name 만 교체.
      const rebuilt = files.map((f, i) => {
        const copy = { name: newNames[i], type: f.type };
        if (f.type === 'file') copy.file = f.file;
        else if (f.type === 'external') copy.external = f.external;
        else if (f.type === 'file_upload') copy.file_upload = f.file_upload;
        return copy;
      });
      propsToUpdate[prop] = { files: rebuilt };
      pageChanged = true;

      oldNames.forEach((n, i) => {
        if (n !== newNames[i]) {
          renamedFiles += 1;
          logLines.push(`      [${prop}] "${n}" → "${newNames[i]}"`);
        }
      });
    }

    if (!pageChanged) continue;
    affectedPages += 1;
    console.log(`  • ${titleOf(page)}  (${page.id})`);
    logLines.forEach((l) => console.log(l));

    if (!DRY_RUN) {
      await notion('PATCH', `/pages/${page.id}`, { properties: propsToUpdate });
      console.log('      ✓ 적용 완료');
    }
  }

  console.log(`\n=== 요약 ===`);
  console.log(`영향받은 숙제: ${affectedPages}건`);
  console.log(`이름 변경된 파일: ${renamedFiles}개`);
  if (DRY_RUN) console.log(`\nDRY RUN 모드였습니다. 실제 적용하려면 $env:DRY_RUN = "" 후 다시 실행하세요.`);
  else console.log(`\n복구 완료. 학생/강사 앱에서 새로고침하면 각 파일이 따로 보입니다.`);
}

main().catch((e) => {
  console.error('오류:', e.message);
  process.exit(1);
});
