// 미수금 알림 스크립트
// GitHub Actions에서 매월 25, 27, 29일 10:00 KST (01:00 UTC)에 자동 실행됨

import { createNotionClient, createNtfyClient, runWithAlert, stripEmoji } from './notion_utils.mjs';

const TOKEN = process.env.NOTION_TOKEN;
const NTFY_TOPIC = process.env.NTFY_TOPIC;
const NTFY_TOKEN = process.env.NTFY_TOKEN;
const STUDENT_DB_ID = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';

if (!TOKEN) {
  console.error('NOTION_TOKEN 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const { notion } = createNotionClient(TOKEN);
const sendNtfy = createNtfyClient(NTFY_TOPIC, NTFY_TOKEN);

async function main() {
  console.log(`[${new Date().toISOString()}] 미수금 학생 조회 시작`);

  // 수강중 + 일시중단 학생 중 미수금이 있는 학생 조회
  const students = [];
  let cursor = undefined;

  while (true) {
    const body = {
      filter: {
        and: [
          {
            or: [
              { property: '상태', select: { equals: '🟢 수강중' } },
              { property: '상태', select: { equals: '🟡 일시중단' } },
            ],
          },
          {
            property: '미수금 합계',
            rollup: { number: { greater_than: 0 } },
          },
        ],
      },
      sorts: [{ property: '미수금 합계', direction: 'descending' }],
    };
    if (cursor) body.start_cursor = cursor;

    const res = await notion('POST', `/databases/${STUDENT_DB_ID}/query`, body);
    students.push(...res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }

  console.log(`미수금 학생 ${students.length}명 조회 완료`);

  if (students.length === 0) {
    console.log('미수금 학생 없음 - 알림 생략');
    return;
  }

  let totalUnpaid = 0;
  const lines = students.map(p => {
    const rawName = p.properties['이름']?.title?.[0]?.plain_text ?? '?';
    const name = stripEmoji(rawName);
    const amount = p.properties['미수금 합계']?.rollup?.number ?? 0;
    totalUnpaid += amount;
    return `• ${name}: ${amount.toLocaleString('ko-KR')}원`;
  });

  const message = [
    `미수금 학생 ${students.length}명 / 합계 ${totalUnpaid.toLocaleString('ko-KR')}원`,
    '',
    ...lines,
  ].join('\n');

  await sendNtfy('💸 미수금 알림', message, 4);
}

runWithAlert('notify_unpaid.mjs', main);
