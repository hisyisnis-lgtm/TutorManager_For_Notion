// 학생 수업 전날 리마인더 알림 스크립트
// Worker 17:00 KST dispatch와 21시까지 재시도, GitHub 19:30 백업으로 실행.

import { createNotionClient, createSolapiClient, runWithAlert, stripEmoji, shouldSkipBackupRun, kstDayStr } from './notion_utils.mjs';
import { createNotificationLedger, notificationDeliveryKey } from './notification_ledger.mjs';
import { sendNotificationBatch } from './notification_batch.mjs';

const TOKEN = process.env.NOTION_TOKEN;
const CLASS_DB_ID = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';
const STUDENT_DB_ID = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';
const LESSON_TYPE_DB_ID = '314838fa-f2a6-81c3-b4e4-da87c48f9b43';

const SOLAPI_API_KEY = process.env.SOLAPI_API_KEY;
const SOLAPI_API_SECRET = process.env.SOLAPI_API_SECRET;
const KAKAO_PFID = process.env.KAKAO_PFID;
const KAKAO_TPL_STU_TOMORROW = process.env.KAKAO_TPL_STU_TOMORROW;

if (!TOKEN) {
  console.error('NOTION_TOKEN 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const { notion } = createNotionClient(TOKEN);
const sendKakao = createSolapiClient({
  apiKey: SOLAPI_API_KEY,
  apiSecret: SOLAPI_API_SECRET,
  pfId: KAKAO_PFID,
});

// Worker의 정시 발송 창 시작 시각(KST). 지연 실행의 대상일 보정 기준.
const SCHEDULED_HOUR_KST = 17;

// "내일"(D-1 알림 대상일)을 계산하되, GitHub Actions cron 지연이 KST 자정을 넘겨도
// 대상일이 하루 밀리지 않도록 보정한다.
// - 정상/당일 지연: 실행 시각이 예정 시각(17시) 이후 → 저녁 배치가 돌아야 했던 "의도일" = 오늘
// - 자정 넘긴 지연: 실행 시각이 예정 시각보다 이른 KST 새벽(0~16시) → 의도일 = 어제
//   (어제 저녁 배치가 지연 실행된 것으로 간주 → 그날 기준 "내일" 수업을 정상 발송)
function getTomorrowKST() {
  const now = new Date();
  const kstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const intendedDay = new Date(kstDate);
  intendedDay.setUTCHours(0, 0, 0, 0);
  if (kstDate.getUTCHours() < SCHEDULED_HOUR_KST) {
    intendedDay.setUTCDate(intendedDay.getUTCDate() - 1);
  }
  const tomorrow = new Date(intendedDay);
  tomorrow.setUTCDate(intendedDay.getUTCDate() + 1);
  const dayAfter = new Date(tomorrow);
  dayAfter.setUTCDate(tomorrow.getUTCDate() + 1);
  return {
    intendedDayStr: intendedDay.toISOString().split('T')[0],
    tomorrowStr: tomorrow.toISOString().split('T')[0],
    dayAfterStr: dayAfter.toISOString().split('T')[0],
  };
}

const DAY_KR = ['일', '월', '화', '수', '목', '금', '토'];

// 수업 유형 DB 조회 → Map<pageId, 타이틀>
async function fetchClassTypeMap() {
  const map = new Map();
  let cursor;
  do {
    const res = await notion('POST', `/databases/${LESSON_TYPE_DB_ID}/query`, {
      start_cursor: cursor,
      page_size: 100,
    });
    for (const p of res.results) {
      const title = p.properties['타이틀']?.title?.[0]?.plain_text ?? '';
      map.set(p.id, title);
      map.set(p.id.replace(/-/g, ''), title);
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return map;
}

async function main() {
  const { intendedDayStr, tomorrowStr, dayAfterStr } = getTomorrowKST();
  // 서명 시작을 남긴 뒤 성공한 자동 실행은 이력 복원 전에 생략한다.
  // 실제 발송·수동 재실행은 기존 수신자 이력을 복원해 중복과 결과 불명 재발송을 막는다.
  const ledger = await createNotificationLedger({
    workflow: 'notify-student-tomorrow.yml', day: intendedDayStr, historyUntilDay: kstDayStr(), secret: SOLAPI_API_SECRET,
    shouldSkip: () => shouldSkipBackupRun({ workflow: 'notify-student-tomorrow.yml', earliestHourKST: 17, latestHourKST: 21, failOnMiss: true }),
  });
  if (!ledger) return;

  console.log(`[${new Date().toISOString()}] 내일(${tomorrowStr}) 수업 있는 학생 알림 시작`);

  // 수업 유형 맵 (무료상담/원데이클래스는 notify_consult_tomorrow에서 별도 템플릿으로 발송하므로 여기서 제외)
  const classTypeMap = await fetchClassTypeMap();

  // 내일 수업 조회 (취소 제외)
  const res = await notion('POST', `/databases/${CLASS_DB_ID}/query`, {
    filter: {
      and: [
        { property: '수업 일시', date: { on_or_after: `${tomorrowStr}T00:00:00+09:00` } },
        { property: '수업 일시', date: { before: `${dayAfterStr}T00:00:00+09:00` } },
      ],
    },
    sorts: [{ property: '수업 일시', direction: 'ascending' }],
  });

  const classes = res.results.filter(p => {
    if (p.properties['특이사항']?.select?.name === '🚫 취소') return false;
    const classTypeId = p.properties['수업 유형']?.relation?.[0]?.id ?? '';
    const classTypeTitle = classTypeMap.get(classTypeId) ?? classTypeMap.get(classTypeId.replace(/-/g, '')) ?? '';
    // 무료상담/원데이클래스는 notify_consult_tomorrow에서 전용 템플릿으로 발송
    if (classTypeTitle.includes('무료상담') || classTypeTitle.includes('원데이클래스')) return false;
    return true;
  });

  console.log(`내일 수업 ${classes.length}개 (취소·원데이·상담 제외)`);

  if (classes.length === 0) {
    console.log('내일 수업 없음 - 알림 생략');
    return;
  }

  // 학생 정보 캐시
  const studentCache = {};
  async function getStudent(id) {
    if (studentCache[id]) return studentCache[id];
    const page = await notion('GET', `/pages/${id}`);
    const props = page.properties;
    studentCache[id] = {
      name: stripEmoji(props['이름']?.title?.[0]?.plain_text ?? ''),
      phone: props['전화번호']?.phone_number ?? '',
    };
    return studentCache[id];
  }

  // 중복 없는 학생 ID 수집 후 병렬 조회 (N+1 쿼리 최적화)
  const allStudentIds = new Set(
    classes.flatMap(p => p.properties['학생']?.relation?.map(r => r.id) ?? [])
  );
  await Promise.all([...allStudentIds].map(id => getStudent(id)));

  const notifications = [];
  for (const p of classes) {
    const dateVal = p.properties['수업 일시']?.date?.start;
    const duration = p.properties['수업 시간(분)']?.select?.name ?? '?';
    const studentRelation = p.properties['학생']?.relation ?? [];

    if (!dateVal || studentRelation.length === 0) continue;

    const classDate = new Date(dateVal);
    const month = classDate.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric' }).replace('월', '');
    const day = classDate.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', day: 'numeric' }).replace('일', '');
    const dayOfWeek = DAY_KR[classDate.getDay()];
    const timeStr = classDate.toLocaleTimeString('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
    });

    for (const { id } of studentRelation) {
      const student = await getStudent(id);
      const phone = student.phone.replace(/\D/g, '').replace(/^82/, '0');
      notifications.push({
        key: notificationDeliveryKey(['student-tomorrow', p.id, classDate.toISOString(), id, phone, KAKAO_TPL_STU_TOMORROW || ''], SOLAPI_API_SECRET),
        to: phone,
        templateId: KAKAO_TPL_STU_TOMORROW,
        variables: {
          '#{이름}': student.name,
          '#{날짜}': `${month}월 ${day}일`,
          '#{요일}': dayOfWeek,
          '#{시간}': timeStr,
          '#{분}': duration,
        },
      });
    }
  }

  await sendNotificationBatch({ notifications, ledger, sendKakao });
}

runWithAlert('notify_student_tomorrow.mjs', main);
