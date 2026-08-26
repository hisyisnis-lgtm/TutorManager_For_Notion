// 잔여 시간 부족 학생 결제 독려 알림 스크립트
// GitHub Actions에서 매일 10:00 KST (01:00 UTC)에 자동 실행됨

import { createNotionClient, createNtfyClient, runWithAlert, stripEmoji } from './notion_utils.mjs';

const TOKEN = process.env.NOTION_TOKEN;
const NTFY_TOPIC = process.env.NTFY_TOPIC;
const NTFY_TOKEN = process.env.NTFY_TOKEN;
const STUDENT_DB_ID = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';
const PAYMENTS_DB = '314838fa-f2a6-8154-935b-edd3d2fbea83';

// 잔여 시간 회차가 이 값 이하인 학생에게 알림 (1 = 1시간 분량)
const THRESHOLD = 1;

if (!TOKEN) {
  console.error('NOTION_TOKEN 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const { queryAll } = createNotionClient(TOKEN);
const sendNtfy = createNtfyClient(NTFY_TOPIC, NTFY_TOKEN);


// 학생별 결제 시간 회차 합계 — 학생 DB의 '결제 시간 회차 합계' rollup은 결제 행이 연결된
// 시점 값에 고정돼 이후 환불을 반영하지 않는다(2026-08-25 검증). 결제 행의 '유효 시간 회차'는
// 정확하므로 결제 DB를 직접 훑어 합산한다. PWA payments.js remainingSessionsOf와 같은 계산.
async function loadPaidSessions(queryAll) {
  const paidByStudent = new Map();
  for (const pay of await queryAll(PAYMENTS_DB)) {
    const sessions = pay.properties['유효 시간 회차']?.formula?.number ?? 0;
    for (const rel of pay.properties['학생']?.relation ?? []) {
      paidByStudent.set(rel.id, (paidByStudent.get(rel.id) ?? 0) + sessions);
    }
  }
  return paidByStudent;
}

async function main() {
  console.log(`[${new Date().toISOString()}] 잔여 시간 부족 학생 조회 시작`);

  // 수강중 학생 전체 조회
  const students = await queryAll(STUDENT_DB_ID, {
    property: '상태',
    select: { equals: '🟢 수강중' },
  });

  console.log(`수강중 학생 ${students.length}명 조회 완료`);

  // 잔여 시간 회차 ≤ THRESHOLD 인 학생 필터링
  const paidByStudent = await loadPaidSessions(queryAll);
  const lowStudents = students
    .map(p => {
      const props = p.properties;
      const rawName = props['이름']?.title?.[0]?.plain_text ?? '?';
      const name = stripEmoji(rawName);
      const used = props['사용 시간 회차']?.rollup?.number ?? 0;
      const remaining = (paidByStudent.get(p.id) ?? 0) - used;
      return { name, remaining };
    })
    .filter(s => s.remaining <= THRESHOLD)
    .sort((a, b) => a.remaining - b.remaining);

  console.log(`잔여 시간 부족 학생 ${lowStudents.length}명`);

  if (lowStudents.length === 0) {
    console.log('해당 학생 없음 - 알림 생략');
    return;
  }

  const lines = lowStudents.map(s => {
    const r = s.remaining;
    const label =
      r <= 0 ? `${r}시간 (초과)` :
      r === 0.5 ? '0.5시간 남음' :
      `${r}시간 남음`;
    return `• ${s.name}: ${label}`;
  });

  const message = `결제 요청이 필요한 학생 ${lowStudents.length}명\n\n${lines.join('\n')}`;
  await sendNtfy('💳 잔여 시간 부족 알림', message, 4);
}

runWithAlert('notify_low_sessions.mjs', main);
