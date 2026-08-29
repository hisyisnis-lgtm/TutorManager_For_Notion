// 학생 수업 당일 리마인더 — **전날 D-1 알림 실패의 이월(carryover) 경로**
//
// 평소에는 아무것도 보내지 않는다. 어제 저녁 D-1 알림이 실패했을 때만:
//  - 학생 D-1(notify_student_tomorrow) 실패 → 오늘 수업 학생에게 당일 리마인더 발송
//  - 상담 D-1(notify_consult_tomorrow) 실패 → 강사 ntfy로 "직접 연락 필요" 알림
//    (무료상담은 당일용 승인 템플릿이 없어 카톡 대체가 불가 — 강사가 직접 연락한다)
//
// 깨우는 쪽: 워커 cron(KST 8~12시, 어제 D-1 실패 감지 시) + 백업 schedule 09:30 KST.
// 수동 실행(workflow_dispatch)은 당일 리마인더를 강제 발송한다.
//
// 새벽 발송 금지 원칙과의 관계: D-1 재시도는 21시(KST)에서 끊긴다. 그 밤에는 아무것도
// 울리지 않고, 다음날 아침 이 스크립트가 "오늘 수업" 리마인더로 메꾼다.

import {
  createNotionClient,
  createSolapiClient,
  createNtfyClient,
  runWithAlert,
  stripEmoji,
  maskPhone,
  shouldSkipBackupRun,
  workflowSucceededBetween,
  kstDayStr,
} from './notion_utils.mjs';

const TOKEN = process.env.NOTION_TOKEN;
const CLASS_DB_ID = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';
const LESSON_TYPE_DB_ID = '314838fa-f2a6-81c3-b4e4-da87c48f9b43';

const SOLAPI_API_KEY = process.env.SOLAPI_API_KEY;
const SOLAPI_API_SECRET = process.env.SOLAPI_API_SECRET;
const KAKAO_PFID = process.env.KAKAO_PFID;
const KAKAO_TPL_STU_TODAY = process.env.KAKAO_TPL_STU_TODAY;
const NTFY_TOPIC = process.env.NTFY_TOPIC;
const NTFY_TOKEN = process.env.NTFY_TOKEN;
const BOOKING_BASE_URL = 'https://tiantian-chinese.pages.dev/#/book/';

if (!TOKEN) {
  console.error('NOTION_TOKEN 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const { notion, queryAll } = createNotionClient(TOKEN);
const sendKakao = createSolapiClient({
  apiKey: SOLAPI_API_KEY,
  apiSecret: SOLAPI_API_SECRET,
  pfId: KAKAO_PFID,
});
const sendNtfy = createNtfyClient(NTFY_TOPIC, NTFY_TOKEN);

// 오늘 KST 범위의 수업 조회 (취소 제외, 시간 오름차순)
async function fetchTodayClasses() {
  const results = await queryAll(
    CLASS_DB_ID,
    {
      and: [
        { property: '수업 일시', date: { on_or_after: `${kstDayStr(0)}T00:00:00+09:00` } },
        { property: '수업 일시', date: { before: `${kstDayStr(1)}T00:00:00+09:00` } },
      ],
    },
    [{ property: '수업 일시', direction: 'ascending' }]
  );
  return results.filter((p) => p.properties['특이사항']?.select?.name !== '🚫 취소');
}

const timeOf = (iso) =>
  new Date(iso).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// ── 학생 D-1 실패 이월: 오늘 수업 학생에게 당일 리마인더 ──
async function sendDayOfReminders(classes, classTypeMap) {
  // D-1과 같은 기준으로 무료상담·원데이는 제외 — 학생 DB에 없는 수신자(무료상담)이거나
  // 전용 안내가 따로 있던 대상이라, 당일 일반 템플릿과 문구가 맞지 않는다.
  const targets = classes.filter((p) => {
    const typeId = p.properties['수업 유형']?.relation?.[0]?.id ?? '';
    const title = classTypeMap.get(typeId) ?? classTypeMap.get(typeId.replace(/-/g, '')) ?? '';
    return !title.includes('무료상담') && !title.includes('원데이클래스');
  });
  if (targets.length === 0) {
    console.log('오늘 일반 수업 없음 - 당일 리마인더 생략');
    return 0;
  }

  const studentCache = {};
  async function getStudent(id) {
    if (studentCache[id]) return studentCache[id];
    const page = await notion('GET', `/pages/${id}`);
    const props = page.properties;
    studentCache[id] = {
      name: stripEmoji(props['이름']?.title?.[0]?.plain_text ?? ''),
      phone: props['전화번호']?.phone_number ?? '',
      token: props['예약 코드']?.rich_text?.[0]?.plain_text ?? '',
    };
    return studentCache[id];
  }

  let sent = 0;
  for (const p of targets) {
    const dateVal = p.properties['수업 일시']?.date?.start;
    const duration = p.properties['수업 시간(분)']?.select?.name ?? '?';
    const studentRelation = p.properties['학생']?.relation ?? [];
    if (!dateVal || studentRelation.length === 0) continue;

    for (const { id } of studentRelation) {
      const student = await getStudent(id);
      if (!student.phone) {
        console.log(`  전화번호 없음 (${student.name}) - 건너뜀`);
        continue;
      }
      const bookingUrl = student.token ? `${BOOKING_BASE_URL}${student.token}` : BOOKING_BASE_URL;
      console.log(`  발송 → ${maskPhone(student.phone)} (${student.name}, ${timeOf(dateVal)})`);
      await sendKakao(
        student.phone,
        KAKAO_TPL_STU_TODAY,
        {
          '#{이름}': student.name,
          '#{시간}': timeOf(dateVal),
          '#{분}': duration,
        },
        [
          {
            buttonType: 'WL',
            buttonName: '예약 페이지',
            linkMo: bookingUrl,
            linkPc: bookingUrl,
          },
        ]
      );
      sent++;
    }
  }
  console.log(`당일 리마인더 ${sent}건 발송`);
  return sent;
}

// ── 상담 D-1 실패 이월: 강사에게 오늘 일정 알림 (직접 연락용) ──
async function alertConsultsToTeacher(classes, classTypeMap) {
  const lines = [];
  for (const p of classes) {
    const typeId = p.properties['수업 유형']?.relation?.[0]?.id ?? '';
    const title = classTypeMap.get(typeId) ?? classTypeMap.get(typeId.replace(/-/g, '')) ?? '';
    const isConsult = title.includes('무료상담');
    const isOneDay = title.includes('원데이클래스');
    if (!isConsult && !isOneDay) continue;
    const dateVal = p.properties['수업 일시']?.date?.start;
    const name = p.properties['제목']?.title?.[0]?.plain_text ?? '고객';
    const phone = p.properties['전화번호']?.rich_text?.[0]?.plain_text ?? '';
    lines.push(`• ${dateVal ? timeOf(dateVal) : '??:??'} [${isConsult ? '무료상담' : '원데이'}] ${name}${phone ? ` (${maskPhone(phone)})` : ''}`);
  }
  if (lines.length === 0) {
    console.log('오늘 무료상담/원데이 없음 - 강사 알림 생략');
    return;
  }
  await sendNtfy(
    '🚨 상담 안내 미발송 — 직접 연락 필요',
    [
      '어제 저녁 무료상담/원데이 D-1 안내가 발송되지 못했습니다.',
      '오늘 일정 (전화번호는 Notion에서 확인):',
      ...lines,
    ].join('\n'),
    5
  );
  console.log(`강사 알림 발송 (상담/원데이 ${lines.length}건)`);
}

async function main() {
  // 오늘 이미 성공한 실행이 있으면 종료 (워커 재시도·백업 schedule 중복 방지)
  // alertOnMiss:false — 이 스크립트는 "이월할 게 없어서 안 보낸 날"이 대부분이다.
  // 지각 실행마다 미발송 오탐 알림이 뜨면 안 된다 (실제 D-1 실패는 이미 어제 critical로 알려졌다).
  if (await shouldSkipBackupRun({ workflow: 'notify-student-today.yml', latestHourKST: 12, alertOnMiss: false })) return;

  const y0 = `${kstDayStr(-1)}T00:00:00+09:00`;
  const y1 = `${kstDayStr(0)}T00:00:00+09:00`;
  const event = process.env.GITHUB_EVENT_NAME ?? '';
  const isManual = event !== 'schedule' && event !== 'repository_dispatch';

  // 어제 저녁 D-1 두 개의 성공 여부. null(조회 불가)이면 이월하지 **않는다** —
  // 조회 장애 때문에 멀쩡히 D-1을 받은 학생에게 매일 아침 중복 카톡이 가면 안 된다.
  // (실제 D-1 실패는 runWithAlert critical로 이미 운영자에게 알려져 있다.)
  const stuOk = isManual ? false : await workflowSucceededBetween('notify-student-tomorrow.yml', y0, y1);
  const conOk = isManual ? true : await workflowSucceededBetween('notify-consult-tomorrow.yml', y0, y1);

  const doDayOf = isManual || stuOk === false;
  const doConsultAlert = conOk === false;

  if (!doDayOf && !doConsultAlert) {
    console.log(`어제 D-1 정상 (학생=${stuOk}, 상담=${conOk}) - 이월 불필요`);
    return;
  }
  console.log(`이월 실행: 당일리마인더=${doDayOf} (수동=${isManual}), 상담알림=${doConsultAlert}`);

  const [classes, typeResults] = await Promise.all([fetchTodayClasses(), queryAll(LESSON_TYPE_DB_ID)]);
  const classTypeMap = new Map();
  for (const p of typeResults) {
    const title = p.properties['타이틀']?.title?.[0]?.plain_text ?? '';
    classTypeMap.set(p.id, title);
    classTypeMap.set(p.id.replace(/-/g, ''), title);
  }
  console.log(`오늘 수업 ${classes.length}건 (취소 제외)`);

  if (doDayOf) await sendDayOfReminders(classes, classTypeMap);
  if (doConsultAlert) await alertConsultsToTeacher(classes, classTypeMap);
}

runWithAlert('notify_student_today.mjs', main);
