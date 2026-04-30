// 무료상담/원데이클래스 전날 리마인더 알림 스크립트
// GitHub Actions에서 매일 특정 시간에 자동 실행됨
// - 무료상담: 수업 자체의 "전화번호" 속성으로 발송 (신규 방문자 대상)
// - 원데이클래스: 수업에 연결된 학생의 전화번호로 발송 (등록된 학생만 예약 가능)
// 수업 유형에 따라 다른 템플릿 사용: 무료상담 → KAKAO_TPL_CONSULT_TOMORROW, 원데이클래스 → KAKAO_TPL_ONEDAY_TOMORROW

import { createNotionClient, createSolapiClient, runWithAlert, stripEmoji } from './notion_utils.mjs';

const TOKEN = process.env.NOTION_TOKEN;
const CLASS_DB_ID = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';
const LESSON_TYPE_DB_ID = '314838fa-f2a6-81c3-b4e4-da87c48f9b43';
const STUDENT_DB_ID = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';

const SOLAPI_API_KEY = process.env.SOLAPI_API_KEY;
const SOLAPI_API_SECRET = process.env.SOLAPI_API_SECRET;
const KAKAO_PFID = process.env.KAKAO_PFID;
const KAKAO_TPL_CONSULT_TOMORROW = process.env.KAKAO_TPL_CONSULT_TOMORROW;
const KAKAO_TPL_ONEDAY_TOMORROW = process.env.KAKAO_TPL_ONEDAY_TOMORROW;

if (!TOKEN) {
  console.error('NOTION_TOKEN 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const { queryAll } = createNotionClient(TOKEN);
const sendKakao = createSolapiClient({
  apiKey: SOLAPI_API_KEY,
  apiSecret: SOLAPI_API_SECRET,
  pfId: KAKAO_PFID,
});

function getTomorrowKST() {
  const now = new Date();
  const kstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const tomorrow = new Date(kstDate);
  tomorrow.setUTCDate(kstDate.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  const dayAfter = new Date(tomorrow);
  dayAfter.setUTCDate(tomorrow.getUTCDate() + 1);
  return {
    tomorrowStr: tomorrow.toISOString().split('T')[0],
    dayAfterStr: dayAfter.toISOString().split('T')[0],
  };
}

const DAY_KR = ['일', '월', '화', '수', '목', '금', '토'];

// 수업 유형 DB 조회 → Map<pageId, 타이틀>
async function fetchClassTypeMap() {
  const map = new Map();
  const results = await queryAll(LESSON_TYPE_DB_ID);
  for (const p of results) {
    const title = p.properties['타이틀']?.title?.[0]?.plain_text ?? '';
    // 하이픈 유무 모두 등록 (Notion ID 형식 불일치 대비)
    map.set(p.id, title);
    map.set(p.id.replace(/-/g, ''), title);
  }
  return map;
}

// 학생 DB 조회 → Map<pageId, { name, phone }>
async function fetchStudentMap() {
  const map = new Map();
  const results = await queryAll(STUDENT_DB_ID);
  for (const p of results) {
    const rawName = p.properties['이름']?.title?.[0]?.plain_text ?? '';
    const name = stripEmoji(rawName);
    const phone = p.properties['전화번호']?.phone_number ?? '';
    const value = { name, phone };
    map.set(p.id, value);
    map.set(p.id.replace(/-/g, ''), value);
  }
  return map;
}

async function main() {
  const { tomorrowStr, dayAfterStr } = getTomorrowKST();
  console.log(`[${new Date().toISOString()}] 내일(${tomorrowStr}) D-1 알림 시작 (무료상담/원데이클래스)`);

  // 수업 유형 맵 + 학생 맵 미리 조회
  const [classTypeMap, studentMap] = await Promise.all([
    fetchClassTypeMap(),
    fetchStudentMap(),
  ]);
  console.log(`수업 유형 ${classTypeMap.size / 2}개, 학생 ${studentMap.size / 2}명 로드 완료`);

  // 내일 수업 전체 조회
  const allResults = await queryAll(
    CLASS_DB_ID,
    {
      and: [
        { property: '수업 일시', date: { on_or_after: `${tomorrowStr}T00:00:00+09:00` } },
        { property: '수업 일시', date: { before: `${dayAfterStr}T00:00:00+09:00` } },
      ],
    },
    [{ property: '수업 일시', direction: 'ascending' }],
  );

  // 취소 수업 제외
  const candidates = allResults.filter(
    p => p.properties['특이사항']?.select?.name !== '🚫 취소'
  );

  console.log(`내일 수업 ${candidates.length}건 (취소 제외) — 무료상담/원데이클래스 대상 선별`);

  let sent = 0;
  for (const p of candidates) {
    const dateVal = p.properties['수업 일시']?.date?.start;
    if (!dateVal) continue;

    // 수업 유형 판별 — 무료상담/원데이클래스만 처리 (일반 수업은 notify_student_tomorrow에서 발송)
    const classTypeId = p.properties['수업 유형']?.relation?.[0]?.id ?? '';
    const classTypeTitle = classTypeMap.get(classTypeId) ?? classTypeMap.get(classTypeId.replace(/-/g, '')) ?? '';
    const isOneDay = classTypeTitle.includes('원데이클래스');
    const isConsult = classTypeTitle.includes('무료상담');
    if (!isOneDay && !isConsult) continue;

    // 수신자(전화번호·이름) 결정
    // - 원데이클래스: 연결된 학생 relation → 학생 DB의 전화번호·이름
    // - 무료상담: 수업 자체의 "전화번호" 속성 + "제목"
    const recipients = [];
    if (isOneDay) {
      const studentIds = p.properties['학생']?.relation?.map(r => r.id) ?? [];
      for (const sid of studentIds) {
        const student = studentMap.get(sid) ?? studentMap.get(sid.replace(/-/g, ''));
        if (student?.phone) {
          recipients.push({ phone: student.phone, name: student.name || '고객' });
        }
      }
      // fallback: 구 레코드(학생 relation 없이 수업 전화번호만 있는 경우)
      if (recipients.length === 0) {
        const phone = p.properties['전화번호']?.rich_text?.[0]?.plain_text;
        const title = p.properties['제목']?.title?.[0]?.plain_text ?? '고객';
        if (phone) recipients.push({ phone, name: title });
      }
    } else {
      const phone = p.properties['전화번호']?.rich_text?.[0]?.plain_text;
      const title = p.properties['제목']?.title?.[0]?.plain_text ?? '고객';
      if (phone) recipients.push({ phone, name: title });
    }

    if (recipients.length === 0) continue;

    const templateId = isOneDay ? KAKAO_TPL_ONEDAY_TOMORROW : KAKAO_TPL_CONSULT_TOMORROW;
    const typeLabel = isOneDay ? '원데이클래스' : '무료상담';

    const classDate = new Date(dateVal);
    const month = classDate.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric' }).replace('월', '');
    const day = classDate.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', day: 'numeric' }).replace('일', '');
    const dayOfWeek = DAY_KR[classDate.getDay()];
    const timeStr = classDate.toLocaleTimeString('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
    });

    for (const { phone, name } of recipients) {
      console.log(`  발송 → ${phone} [${typeLabel}] (${name}, ${month}월 ${day}일 ${timeStr})`);
      await sendKakao(
        phone,
        templateId,
        {
          '#{이름}': name,
          '#{날짜}': `${month}월 ${day}일`,
          '#{요일}': dayOfWeek,
          '#{시간}': timeStr,
        }
      );
      sent++;
    }
  }

  console.log(`완료: ${sent}건 D-1 알림 발송`);
}

runWithAlert('notify_consult_tomorrow.mjs', main);
