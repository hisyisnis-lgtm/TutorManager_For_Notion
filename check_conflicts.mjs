const TOKEN = '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';
const CLASS_DB = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';

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

async function queryAll(dbId, filter) {
  const pages = [];
  let cursor;
  while (true) {
    const res = await api('POST', `/databases/${dbId}/query`, {
      ...(filter && { filter }),
      ...(cursor && { start_cursor: cursor }),
      page_size: 100,
    });
    pages.push(...res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return pages;
}

async function checkConflicts() {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(`\n[수업 충돌 체크] ${now}`);

  // 한국 시간 기준 오늘 날짜 이후 수업만 조회 (과거 수업 무시)
  const todayKST = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const pages = await queryAll(CLASS_DB, {
    and: [
      { property: '상태', select: { does_not_equal: '🚫 취소' } },
      { property: '수업 일시', date: { on_or_after: todayKST } },
    ],
  });

  // 수업 정보 파싱
  const classes = pages
    .map(p => {
      const props = p.properties;
      const dateStart = props['수업 일시']?.date?.start;
      const minutesStr = props['수업 시간(분)']?.select?.name;
      const title = props['제목']?.title?.map(t => t.plain_text).join('') || '(제목 없음)';

      if (!dateStart || !minutesStr) return null;

      const start = new Date(dateStart);
      const minutes = parseInt(minutesStr, 10);
      if (isNaN(minutes)) return null;
      const end = new Date(start.getTime() + minutes * 60 * 1000);

      return { id: p.id, title, start, end };
    })
    .filter(Boolean);

  // 충돌하는 ID 집합
  const conflictIds = new Set();
  for (let i = 0; i < classes.length; i++) {
    for (let j = i + 1; j < classes.length; j++) {
      const a = classes[i];
      const b = classes[j];
      if (a.start < b.end && b.start < a.end) {
        conflictIds.add(a.id);
        conflictIds.add(b.id);
      }
    }
  }

  // 모든 수업의 충돌 체크박스 업데이트
  for (const c of classes) {
    const hasConflict = conflictIds.has(c.id);
    await api('PATCH', `/pages/${c.id}`, {
      properties: { '충돌': { checkbox: hasConflict } },
    });
  }

  if (conflictIds.size === 0) {
    console.log('충돌하는 수업 없음');
  } else {
    const fmt = d =>
      d.toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    console.log(`[WARNING] 충돌 표시된 수업: ${conflictIds.size}건`);
    for (const c of classes) {
      if (conflictIds.has(c.id)) {
        console.log(`  !! ${c.title} (${fmt(c.start)} ~ ${fmt(c.end)})`);
      }
    }
  }
}

checkConflicts().catch(console.error);
