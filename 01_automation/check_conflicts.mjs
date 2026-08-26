// 수업 캘린더 충돌 감지 스크립트
// GitHub Actions에서 10분마다 자동 실행됨

import { createNotionClient, createNtfyClient, runWithAlert, sleep } from './notion_utils.mjs';

const TOKEN = process.env.NOTION_TOKEN;
const NTFY_TOPIC = process.env.NTFY_TOPIC;
const NTFY_TOKEN = process.env.NTFY_TOKEN;
const DB_ID = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';

if (!TOKEN) {
  console.error('NOTION_TOKEN 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const { notion } = createNotionClient(TOKEN);
const sendNtfy = createNtfyClient(NTFY_TOPIC, NTFY_TOKEN);

async function getAllPages() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const pages = [];
      let cursor = undefined;

      while (true) {
        const body = {
          page_size: 100,
          filter: {
            and: [
              { property: '수업 일시', date: { is_not_empty: true } },
              { property: '특이사항', select: { does_not_equal: '🚫 취소' } },
            ],
          },
        };
        if (cursor) body.start_cursor = cursor;

        const res = await notion('POST', `/databases/${DB_ID}/query`, body);
        pages.push(...res.results);
        if (!res.has_more) break;
        cursor = res.next_cursor;
      }

      return pages;
    } catch (e) {
      if (attempt < 3) {
        console.warn(`DB 조회 실패 (${attempt}회) — 처음부터 재시도:`, e.message);
        await sleep(2000);
      } else {
        throw e;
      }
    }
  }
}

async function main() {
  console.log(`[${new Date().toISOString()}] 충돌 감지 시작`);

  const pages = await getAllPages();
  console.log(`전체 수업 ${pages.length}개 조회`);

  // 취소된 수업 제외하고 파싱
  const classes = pages
    .map(p => {
      const dateVal = p.properties['수업 일시']?.date;
      const duration = p.properties['수업 시간(분)']?.select?.name;
      const 특이사항 = p.properties['특이사항']?.select?.name;
      const currentConflict = p.properties['충돌_감지']?.checkbox ?? false;

      if (!dateVal?.start || !duration) return null;
      if (특이사항 === '🚫 취소') return null;

      const start = new Date(dateVal.start);
      const end = new Date(start.getTime() + parseInt(duration) * 60 * 1000);

      return { id: p.id, start, end, currentConflict };
    })
    .filter(Boolean);

  console.log(`유효 수업 ${classes.length}개 (취소 제외)`);

  // 충돌 감지
  const conflictIds = new Set();

  for (let i = 0; i < classes.length; i++) {
    for (let j = i + 1; j < classes.length; j++) {
      const a = classes[i];
      const b = classes[j];

      // A.start < B.end && B.start < A.end → 겹침
      if (a.start < b.end && b.start < a.end) {
        conflictIds.add(a.id);
        conflictIds.add(b.id);
      }
    }
  }

  // 변경이 필요한 항목만 업데이트
  let updated = 0;
  let newConflicts = 0;
  for (const cls of classes) {
    const shouldConflict = conflictIds.has(cls.id);

    if (shouldConflict !== cls.currentConflict) {
      if (shouldConflict) newConflicts++;
      await notion('PATCH', `/pages/${cls.id}`, {
        properties: {
          '충돌_감지': { checkbox: shouldConflict },
        },
      });
      console.log(`  ${cls.id}: 충돌 ${shouldConflict ? '✅ 표시' : '⬜ 해제'} (${cls.start.toISOString()})`);
      updated++;
      await sleep(350); // Notion API Rate Limit 대응 (초당 3회)
    }
  }

  console.log(`완료: ${conflictIds.size}개 충돌 감지, ${updated}개 업데이트`);

  if (newConflicts > 0) {
    const msg = `충돌 수업 ${newConflicts}건이 새로 발견되었습니다.\n노션에서 확인해 주세요.`;
    await sendNtfy('⚠️ 수업 충돌 감지', msg, 4);
  }
}

runWithAlert('check_conflicts.mjs', main);
