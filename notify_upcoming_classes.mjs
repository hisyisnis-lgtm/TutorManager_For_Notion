// 내일 수업 알림 스크립트
// GitHub Actions에서 매일 21:00 KST (12:00 UTC)에 자동 실행됨

import { createNotionClient, createNtfyClient, runWithAlert } from './notion_utils.mjs';

const TOKEN = process.env.NOTION_TOKEN;
const NTFY_TOPIC = process.env.NTFY_TOPIC;
const NTFY_TOKEN = process.env.NTFY_TOKEN;
const CLASS_DB_ID = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';

if (!TOKEN) {
  console.error('NOTION_TOKEN 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const { notion } = createNotionClient(TOKEN);
const sendNtfy = createNtfyClient(NTFY_TOPIC, NTFY_TOKEN);

// KST 기준 내일 날짜 범위 계산
function getTomorrowKST() {
  const now = new Date();
  const kstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);

  const tomorrow = new Date(kstDate);
  tomorrow.setUTCDate(kstDate.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);

  const dayAfter = new Date(tomorrow);
  dayAfter.setUTCDate(tomorrow.getUTCDate() + 1);

  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  const dayAfterStr = dayAfter.toISOString().split('T')[0];

  return { tomorrowStr, dayAfterStr };
}

const studentCache = {};
async function getStudentNames(relation) {
  if (!relation || relation.length === 0) return [];
  const names = [];
  for (const { id } of relation) {
    if (!studentCache[id]) {
      const page = await notion('GET', `/pages/${id}`);
      studentCache[id] = page.properties['이름']?.title?.[0]?.plain_text ?? '?';
    }
    names.push(studentCache[id]);
  }
  return names;
}

async function main() {
  const { tomorrowStr, dayAfterStr } = getTomorrowKST();
  console.log(`[${new Date().toISOString()}] 내일 수업 조회: ${tomorrowStr}`);

  const res = await notion('POST', `/databases/${CLASS_DB_ID}/query`, {
    filter: {
      and: [
        { property: '수업 일시', date: { on_or_after: `${tomorrowStr}T00:00:00+09:00` } },
        { property: '수업 일시', date: { before: `${dayAfterStr}T00:00:00+09:00` } },
      ],
    },
    sorts: [{ property: '수업 일시', direction: 'ascending' }],
  });

  // 취소된 수업 제외
  const classes = res.results.filter(
    p => p.properties['특이사항']?.select?.name !== '🚫 취소'
  );

  console.log(`내일 수업 ${classes.length}개 (취소 제외)`);

  if (classes.length === 0) {
    console.log('내일 수업 없음 - 알림 생략');
    return;
  }

  const lines = [];
  for (const p of classes) {
    const dateVal = p.properties['수업 일시']?.date?.start;
    const duration = p.properties['수업 시간(분)']?.select?.name;
    const 특이사항 = p.properties['특이사항']?.select?.name;
    const studentRelation = p.properties['학생']?.relation;

    const studentNames = await getStudentNames(studentRelation);
    const timeStr = new Date(dateVal).toLocaleTimeString('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
    });

    const note = 특이사항 ? ` ${특이사항}` : '';
    const names = studentNames.length > 0 ? studentNames.join(', ') : '미지정';
    lines.push(`${timeStr} ${names} (${duration}분)${note}`);
  }

  const message = `총 ${classes.length}개 수업\n\n${lines.join('\n')}`;
  await sendNtfy('📅 내일 수업 안내', message, 3);
}

runWithAlert('notify_upcoming_classes.mjs', main);
