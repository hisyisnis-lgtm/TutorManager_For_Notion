const TOKEN = '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';
const STUDENT_DB      = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';
const CLASS_HISTORY_DB = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';

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

async function getAllStudents() {
  const pages = [];
  let cursor = undefined;
  do {
    const res = await api('POST', `/databases/${STUDENT_DB}/query`, {
      start_cursor: cursor,
      page_size: 100,
    });
    pages.push(...res.results);
    cursor = res.next_cursor;
  } while (cursor);
  return pages;
}

// 학생의 수업 이력 조회 (최신순 정렬)
async function getClassHistory(studentPageId) {
  const res = await api('POST', `/databases/${CLASS_HISTORY_DB}/query`, {
    filter: {
      property: '학생',
      relation: { contains: studentPageId },
    },
    sorts: [{ property: '수업 일시', direction: 'descending' }],
  });
  return res.results;
}

/**
 * 상태 판단 우선순위:
 * 1. 🔵 예정 수업 있음          → 🟢 수강중
 * 2. 잔여 시간 회차 = 0         → ⚫ 수강종료
 * 3. 마지막 완료 수업 > 1달 전  → 🟡 일시중단
 * 4. 그 외                      → 🟢 수강중
 */
function determineStatus(student, classHistory) {
  // 1. 예정 수업이 하나라도 있으면 수강중
  const hasUpcoming = classHistory.some(
    r => r.properties['상태']?.select?.name === '🔵 예정'
  );
  if (hasUpcoming) return '🟢 수강중';

  // 2. 잔여 시간 회차 0 → 수강종료
  const remaining = student.properties['잔여 시간 회차']?.formula?.number ?? 0;
  if (remaining <= 0) return '⚫ 수강종료';

  // 3. 마지막 완료 수업이 1달 초과 → 일시중단
  const lastCompleted = classHistory.find(
    r => r.properties['상태']?.select?.name === '🟢 완료'
  );
  if (lastCompleted) {
    const lastDate = new Date(lastCompleted.properties['수업 일시']?.date?.start);
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    if (lastDate < oneMonthAgo) return '🟡 일시중단';
  }

  // 4. 그 외 → 수강중
  return '🟢 수강중';
}

async function main() {
  console.log('학생 상태 자동 업데이트 시작...\n');

  const students = await getAllStudents();
  console.log(`총 ${students.length}명 조회\n`);

  let updated = 0;
  let unchanged = 0;

  for (const student of students) {
    const name = student.properties['이름']?.title?.map(t => t.plain_text).join('') ?? '(이름없음)';
    const currentStatus = student.properties['상태']?.select?.name ?? '(없음)';

    const classHistory = await getClassHistory(student.id);
    const newStatus = determineStatus(student, classHistory);

    if (currentStatus === newStatus) {
      console.log(`  - ${name}: ${currentStatus} (변경 없음)`);
      unchanged++;
    } else {
      await api('PATCH', `/pages/${student.id}`, {
        properties: {
          '상태': { select: { name: newStatus } },
        },
      });
      console.log(`  ✓ ${name}: ${currentStatus} → ${newStatus}`);
      updated++;
    }
  }

  console.log(`\n완료! 업데이트: ${updated}명 / 변경 없음: ${unchanged}명`);
}

main().catch(console.error);
