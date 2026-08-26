// 수업 일지 자동 생성 스크립트
// 완료된 수업 중 수업 일지가 없는 항목에 빈 일지를 자동 생성
// GitHub Actions에서 1시간마다 자동 실행됨

import { createNotionClient, runWithAlert, stripEmoji } from './notion_utils.mjs';

const TOKEN = process.env.NOTION_TOKEN;
const CLASS_DB_ID = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';
const LOG_DB_ID = '318838fa-f2a6-81f1-9b9c-fd379b1026ed'; // 수업 일지 DB

// 최근 N일 이내 완료된 수업만 대상 (너무 오래된 수업은 소급 생성 제외)
const LOOKBACK_DAYS = 7;

if (!TOKEN) {
  console.error('NOTION_TOKEN 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const { notion } = createNotionClient(TOKEN);

const studentCache = {};
async function getStudentName(id) {
  if (studentCache[id]) return studentCache[id];
  const page = await notion('GET', `/pages/${id}`);
  const raw = page.properties['이름']?.title?.[0]?.plain_text ?? '?';
  studentCache[id] = stripEmoji(raw);
  return studentCache[id];
}

async function main() {
  const now = new Date();
  const lookbackDate = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  console.log(`[${now.toISOString()}] 수업 일지 자동 생성 시작`);
  console.log(`대상 기간: ${lookbackDate.toISOString().split('T')[0]} ~ 현재`);

  // 완료된 수업 중 일지가 없는 항목 조회
  // 조건: 수업 일시 있음 + 이미 지남 + 최근 N일 이내 + 수업 일지 비어있음 + 취소 아님
  const pages = [];
  let cursor = undefined;

  while (true) {
    const body = {
      filter: {
        and: [
          { property: '수업 일시', date: { is_not_empty: true } },
          { property: '수업 일시', date: { on_or_before: now.toISOString() } },
          { property: '수업 일시', date: { on_or_after: lookbackDate.toISOString() } },
          { property: '수업 일지', relation: { is_empty: true } },
          {
            or: [
              { property: '특이사항', select: { is_empty: true } },
              { property: '특이사항', select: { does_not_equal: '🚫 취소' } },
            ],
          },
        ],
      },
      sorts: [{ property: '수업 일시', direction: 'ascending' }],
    };
    if (cursor) body.start_cursor = cursor;

    const res = await notion('POST', `/databases/${CLASS_DB_ID}/query`, body);
    pages.push(...res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }

  console.log(`일지 미작성 수업 ${pages.length}개`);

  if (pages.length === 0) {
    console.log('생성할 일지 없음 - 종료');
    return;
  }

  let created = 0;
  for (const page of pages) {
    const studentRelation = page.properties['학생']?.relation ?? [];
    const dateVal = page.properties['수업 일시']?.date?.start;
    if (!dateVal) continue;

    // 학생 이름 조회
    const names = [];
    for (const { id } of studentRelation) {
      names.push(await getStudentName(id));
    }

    // KST 기준 날짜 포맷 (제목용)
    const date = new Date(dateVal);
    const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    const month = kst.getUTCMonth() + 1;
    const day = kst.getUTCDate();

    const title =
      names.length > 0
        ? `${names.join(', ')} ${month}/${day}`
        : `수업 ${month}/${day}`;

    // 수업 일지 레코드 생성 (내용 필드는 비워둠 - 직접 작성)
    await notion('POST', '/pages', {
      parent: { database_id: LOG_DB_ID },
      properties: {
        '제목': { title: [{ text: { content: title } }] },
        '수업': { relation: [{ id: page.id }] },
        '학생': { relation: studentRelation.map(r => ({ id: r.id })) },
      },
    });

    console.log(`  일지 생성: "${title}"`);
    created++;
  }

  console.log(`완료: ${created}개 일지 생성됨`);
}

runWithAlert('create_lesson_logs.mjs', main);
