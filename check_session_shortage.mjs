// check_session_shortage.mjs
// 학생별 결제 잔여 회차를 계산하여, 날짜 순으로 정렬된 예정 수업 중
// 잔여 회차를 초과하는 수업에만 '회차부족_감지' 체크박스를 설정합니다.
//
// 동작 규칙:
// - 완료 수업: 항상 false (경고 표시 안 함)
// - 취소(🚫)·보강(🟠) 수업: 항상 false
// - 무료 수업(1인 단가 = 0): 항상 false
// - 예정 수업: 날짜 순으로 누적하여 잔여 초과 시 true

const TOKEN = process.env.NOTION_TOKEN;
const CLASSES_DB = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';
const STUDENTS_DB = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';

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

async function queryAll(dbId, filter, sorts) {
  const results = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (filter) body.filter = filter;
    if (sorts) body.sorts = sorts;
    if (cursor) body.start_cursor = cursor;
    const data = await api('POST', `/databases/${dbId}/query`, body);
    results.push(...data.results);
    cursor = data.next_cursor;
  } while (cursor);
  return results;
}

async function main() {
  const now = new Date();

  // 1. 전체 학생 조회 → studentId: paid 맵
  const studentPages = await queryAll(STUDENTS_DB);
  const studentPaid = new Map(); // studentId → 결제 시간 회차 합계
  for (const s of studentPages) {
    const paid = s.properties['결제 시간 회차 합계']?.rollup?.number ?? 0;
    studentPaid.set(s.id, paid);
  }
  console.log(`학생 ${studentPaid.size}명 조회 완료`);

  // 2. 전체 수업 조회 (수업 일시 오름차순)
  const allSessions = await queryAll(
    CLASSES_DB,
    undefined,
    [{ property: '수업 일시', direction: 'ascending' }]
  );
  console.log(`수업 ${allSessions.length}개 조회 완료`);

  // 3. 학생별 세션 목록 구성 (학생 → 수업 목록)
  const studentSessions = new Map(); // studentId → Session[]
  for (const session of allSessions) {
    const studentIds = session.properties['학생']?.relation?.map(r => r.id) ?? [];
    for (const sid of studentIds) {
      if (!studentSessions.has(sid)) studentSessions.set(sid, []);
      studentSessions.get(sid).push(session);
    }
  }

  // 4. 학생별 overflow 계산 → sessionId: shouldWarn 집계
  const sessionWarnings = new Map(); // sessionId → boolean

  for (const [studentId, paid] of studentPaid) {
    const sessions = studentSessions.get(studentId) ?? [];

    // 유효 세션 필터: 수업 일시·수업 시간(분) 있고, 취소·보강·무료 아닌 것
    const validSessions = sessions.filter(s => {
      const p = s.properties;
      const notes = p['특이사항']?.select?.name;
      const dt = p['수업 일시']?.date?.start;
      const duration = p['수업 시간(분)']?.select?.name;
      const isFree = (p['무료 수업']?.rollup?.number ?? 0) === 0;
      return (
        notes !== '🚫 취소' &&
        notes !== '🟠 보강' &&
        dt &&
        duration &&
        !isFree
      );
    });

    // 완료 vs 예정 분리
    const completedSessions = validSessions.filter(
      s => new Date(s.properties['수업 일시'].date.start) <= now
    );
    const upcomingSessions = validSessions
      .filter(s => new Date(s.properties['수업 일시'].date.start) > now)
      .sort((a, b) =>
        new Date(a.properties['수업 일시'].date.start) -
        new Date(b.properties['수업 일시'].date.start)
      );

    // 완료 시간 합산
    const completedHours = completedSessions.reduce((sum, s) => {
      const dur = parseInt(s.properties['수업 시간(분)'].select.name);
      return sum + dur / 60;
    }, 0);

    // 잔여 회차 = 결제 - 완료
    let remaining = paid - completedHours;

    // 예정 수업을 날짜 순으로 누적 처리
    for (const session of upcomingSessions) {
      const dur = parseInt(session.properties['수업 시간(분)'].select.name);
      const sessionHours = dur / 60;
      const shouldWarn = remaining < sessionHours;
      remaining -= sessionHours;

      // 여러 학생이 연결된 수업(2:1)은 OR 집계: 한 명이라도 부족하면 경고
      if (!sessionWarnings.has(session.id)) {
        sessionWarnings.set(session.id, shouldWarn);
      } else if (shouldWarn) {
        sessionWarnings.set(session.id, true);
      }
    }
  }

  // 5. 체크박스 업데이트 (변경 필요한 항목만)
  let updated = 0;
  for (const session of allSessions) {
    const p = session.properties;
    const dt = p['수업 일시']?.date?.start;
    const notes = p['특이사항']?.select?.name;
    const isFree = (p['무료 수업']?.rollup?.number ?? 0) === 0;
    const isCompleted = dt && new Date(dt) <= now;
    const isCancelledOrMakeup = notes === '🚫 취소' || notes === '🟠 보강';

    // 예정 + 유료 + 수업 일시 있는 경우만 경고 가능
    const shouldWarn =
      !isCompleted && !isCancelledOrMakeup && !isFree && dt
        ? (sessionWarnings.get(session.id) ?? false)
        : false;

    const current = p['회차부족_감지']?.checkbox ?? false;
    if (shouldWarn !== current) {
      await api('PATCH', `/pages/${session.id}`, {
        properties: { '회차부족_감지': { checkbox: shouldWarn } },
      });
      updated++;
    }
  }

  console.log(`✅ 완료: ${updated}개 수업 업데이트`);
}

main().catch(e => {
  console.error('❌ 오류:', e.message);
  process.exit(1);
});
