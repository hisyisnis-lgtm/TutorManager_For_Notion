// 월별 수납 현황 페이지 자동 갱신
// 결제 상태가 "완료" 또는 "초과금"인 항목의 실제 결제 금액을 월별로 집계

const TOKEN = process.env.NOTION_TOKEN;
const NTFY_TOPIC = process.env.NTFY_TOPIC;
const PAYMENT_DB_ID = '314838fa-f2a6-8154-935b-edd3d2fbea83';
const SUMMARY_PAGE_ID = '316838fa-f2a6-810b-a382-c567536334de';

if (!TOKEN) {
  console.error('NOTION_TOKEN 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

async function sendNtfy(title, message, priority = 3) {
  if (!NTFY_TOPIC) return;
  try {
    const res = await fetch('https://ntfy.sh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: NTFY_TOPIC, title, message, priority }),
    });
    if (!res.ok) console.error(`ntfy 전송 실패 (${res.status}): ${await res.text()}`);
    else console.log(`ntfy 알림 전송 완료: ${title}`);
  } catch (e) {
    console.error('ntfy 전송 오류:', e.message);
  }
}

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

// 전체 결제 내역 조회 (페이지네이션)
async function getAllPayments() {
  const records = [];
  let cursor = null;
  do {
    const res = await api('POST', `/databases/${PAYMENT_DB_ID}/query`, {
      ...(cursor ? { start_cursor: cursor } : {}),
      page_size: 100,
    });
    records.push(...res.results);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return records;
}

// 페이지의 최상위 블록 전체 삭제
async function clearPageBlocks() {
  const res = await api('GET', `/blocks/${SUMMARY_PAGE_ID}/children`);
  for (const block of res.results) {
    await api('DELETE', `/blocks/${block.id}`);
  }
}

(async () => {
  console.log('결제 내역 조회 중...');
  let records;
  try {
    records = await getAllPayments();
  } catch (e) {
    await sendNtfy('❌ 수납 현황 갱신 실패', `결제 내역 조회 오류: ${e.message}`, 4);
    throw e;
  }
  console.log(`총 ${records.length}건 조회`);

  // 결제일 기준 실제 결제 금액 월별 집계 (결제 상태 무관, 전체 포함)
  const monthly = {};
  for (const r of records) {
    const p = r.properties;
    const dateStart = p['결제일']?.date?.start;
    if (!dateStart) continue;

    const amount = p['실제 결제 금액']?.number ?? 0;
    const month = dateStart.slice(0, 7); // "2026-01"
    monthly[month] = (monthly[month] ?? 0) + amount;
  }

  const months = Object.keys(monthly).sort();
  console.log('월별 집계:', monthly);

  // 기존 페이지 내용 초기화
  console.log('기존 내용 삭제 중...');
  await clearPageBlocks();

  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  // 콜아웃 블록 추가
  await api('PATCH', `/blocks/${SUMMARY_PAGE_ID}/children`, {
    children: [{
      object: 'block', type: 'callout',
      callout: {
        icon: { type: 'emoji', emoji: '💡' },
        rich_text: [{ type: 'text', text: { content: `결제일 기준 실제 결제 금액 합산 (전체 상태 포함)  |  마지막 업데이트: ${now}` } }],
        color: 'gray_background'
      }
    }]
  });

  if (months.length === 0) {
    console.log('집계할 데이터가 없습니다.');
    return;
  }

  // 테이블 블록 추가 (table.children 구조)
  const headerRow = {
    object: 'block', type: 'table_row',
    table_row: {
      cells: [
        [{ type: 'text', text: { content: '월' }, annotations: { bold: true } }],
        [{ type: 'text', text: { content: '실제 수납액 합계' }, annotations: { bold: true } }],
      ]
    }
  };

  const dataRows = months.map(m => {
    const [y, mo] = m.split('-');
    return {
      object: 'block', type: 'table_row',
      table_row: {
        cells: [
          [{ type: 'text', text: { content: `${y}년 ${parseInt(mo)}월` } }],
          [{ type: 'text', text: { content: monthly[m].toLocaleString('ko-KR') + '원' } }],
        ]
      }
    };
  });

  await api('PATCH', `/blocks/${SUMMARY_PAGE_ID}/children`, {
    children: [{
      object: 'block', type: 'table',
      table: {
        table_width: 2,
        has_column_header: true,
        has_row_header: false,
        children: [headerRow, ...dataRows]
      }
    }]
  });

  const summary = months.map(m => {
    const mo = m.split('-')[1];
    return `${parseInt(mo)}월 ${monthly[m].toLocaleString('ko-KR')}원`;
  }).join(' / ');
  await sendNtfy('✅ 월별 수납 현황 갱신 완료', summary || '집계 데이터 없음', 2);
  console.log('✅ 월별 수납 현황 업데이트 완료');
})().catch(async (e) => {
  console.error('오류:', e.message);
  await sendNtfy('❌ 수납 현황 갱신 실패', e.message, 4);
  process.exit(1);
});
