const TOKEN = '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';
const CLASS_HISTORY_DB = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';
const UNIT_PRICE_DB    = '314838fa-f2a6-81c3-b4e4-da87c48f9b43';

async function api(method, path, body) {
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

// 페이지의 title 속성 값 반환
async function getPageTitle(pageId) {
  const page = await api('GET', `/pages/${pageId}`);
  for (const val of Object.values(page.properties)) {
    if (val.type === 'title' && val.title.length > 0) {
      return val.title.map(t => t.plain_text).join('');
    }
  }
  return '';
}

// 수업 이력 DB 전체 페이지 조회 (pagination 처리)
async function getAllPages() {
  const pages = [];
  let cursor = undefined;
  do {
    const res = await api('POST', `/databases/${CLASS_HISTORY_DB}/query`, {
      start_cursor: cursor,
      page_size: 100,
    });
    pages.push(...res.results);
    cursor = res.next_cursor;
  } while (cursor);
  return pages;
}

// Step 1: 수업 단가 relation 속성 추가
async function addUnitPriceRelation() {
  console.log('[1/2] 수업 이력 DB에 "수업 단가" relation 추가 중...');
  try {
    await api('PATCH', `/databases/${CLASS_HISTORY_DB}`, {
      properties: {
        '수업 단가': {
          relation: {
            database_id: UNIT_PRICE_DB,
            single_property: {},
          },
        },
      },
    });
    console.log('  ✓ "수업 단가" relation 추가 완료\n');
  } catch (e) {
    // 이미 존재하는 경우 계속 진행
    if (e.message.includes('already exists') || e.message.includes('conflict')) {
      console.log('  ℹ "수업 단가" relation 이미 존재 → 건너뜀\n');
    } else {
      throw e;
    }
  }
}

// Step 2: 타이틀 동기화
async function syncTitles() {
  console.log('[2/2] 수업 이력 타이틀 동기화 중...');
  const pages = await getAllPages();
  console.log(`  총 ${pages.length}개 레코드 발견\n`);

  let updated = 0;
  let skipped = 0;

  for (const page of pages) {
    const props = page.properties;

    // 수업 단가 relation
    const unitPriceRels = props['수업 단가']?.relation ?? [];
    if (unitPriceRels.length === 0) {
      skipped++;
      continue; // 수업 단가 미설정 레코드는 건너뜀
    }

    // 학생 relation
    const studentRels = props['학생']?.relation ?? [];
    const studentName = studentRels.length > 0
      ? await getPageTitle(studentRels[0].id)
      : '';

    // 수업 단가 title (비고)
    const unitPriceName = await getPageTitle(unitPriceRels[0].id);

    // 수업 시간(분) (select 타입)
    const minutes = props['수업 시간(분)']?.select?.name ?? '0';

    // 타이틀 조합: [단가명_학생명_60분]
    const newTitle = `${unitPriceName}_${studentName}_${minutes}분`;

    await api('PATCH', `/pages/${page.id}`, {
      properties: {
        '제목': {
          title: [{ type: 'text', text: { content: newTitle } }],
        },
      },
    });

    console.log(`  ✓ ${newTitle}`);
    updated++;
  }

  console.log(`\n완료! 업데이트: ${updated}개 / 건너뜀(수업 단가 미설정): ${skipped}개`);
}

async function main() {
  await addUnitPriceRelation();
  await syncTitles();
}

main().catch(console.error);
