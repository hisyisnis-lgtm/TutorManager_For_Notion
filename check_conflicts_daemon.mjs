const TOKEN = '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';
const CLASS_DB = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5분마다 체크
const RECENT_WINDOW_MS = POLL_INTERVAL_MS + 30 * 1000; // 5분 30초 (여유)

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
  // 한국 시간 기준 오늘 날짜 (YYYY-MM-DD)
  const todayKST = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

  const pages = await queryAll(CLASS_DB, {
    and: [
      { property: '상태', select: { does_not_equal: '🚫 취소' } },
      { property: '수업 일시', date: { on_or_after: todayKST } },
    ],
  });

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

  const conflictIds = new Set();
  for (let i = 0; i < classes.length; i++) {
    for (let j = i + 1; j < classes.length; j++) {
      const a = classes[i], b = classes[j];
      if (a.start < b.end && b.start < a.end) {
        conflictIds.add(a.id);
        conflictIds.add(b.id);
      }
    }
  }

  for (const c of classes) {
    await api('PATCH', `/pages/${c.id}`, {
      properties: { '충돌': { checkbox: conflictIds.has(c.id) } },
    });
  }

  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  if (conflictIds.size === 0) {
    console.log(`[${now}] 충돌 없음`);
  } else {
    const fmt = d => d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    console.log(`[${now}] [WARNING] 충돌 ${conflictIds.size}건`);
    for (const c of classes) {
      if (conflictIds.has(c.id)) {
        console.log(`  !! ${c.title} (${fmt(c.start)} ~ ${fmt(c.end)})`);
      }
    }
  }
}

async function poll() {
  try {
    const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();

    // 최근에 수정된 수업이 있는지만 빠르게 확인
    const recent = await api('POST', `/databases/${CLASS_DB}/query`, {
      filter: {
        and: [
          { timestamp: 'last_edited_time', last_edited_time: { on_or_after: since } },
          { property: '상태', select: { does_not_equal: '🚫 취소' } },
        ],
      },
      page_size: 1,
    });

    if (recent.results.length > 0) {
      const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
      console.log(`[${now}] 수업 변경 감지 → 충돌 체크 실행`);
      await checkConflicts();
    }
  } catch (err) {
    const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    console.error(`[${now}] 오류:`, err.message);
  }
}

console.log('TutorManager 충돌 감지 데몬 시작 (5분 간격)');

// 시작 시 즉시 한 번 체크
await poll();

// 이후 5분마다 반복
setInterval(poll, POLL_INTERVAL_MS);
