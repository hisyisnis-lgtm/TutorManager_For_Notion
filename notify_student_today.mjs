// 학생 수업 당일 리마인더 알림 스크립트
// GitHub Actions에서 매일 08:00 KST (23:00 UTC 전날)에 자동 실행됨

import { createHmac } from 'crypto';

const TOKEN = process.env.NOTION_TOKEN;
const CLASS_DB_ID = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';
const STUDENT_DB_ID = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';

const SOLAPI_API_KEY = process.env.SOLAPI_API_KEY;
const SOLAPI_API_SECRET = process.env.SOLAPI_API_SECRET;
const KAKAO_PFID = process.env.KAKAO_PFID;
const KAKAO_TPL_STU_TODAY = process.env.KAKAO_TPL_STU_TODAY;
const BOOKING_BASE_URL = 'https://tiantian-chinese.pages.dev/#/book/';

if (!TOKEN) {
  console.error('NOTION_TOKEN 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

async function notion(method, path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function sendKakao(to, templateId, variables, buttons = []) {
  if (!SOLAPI_API_KEY || !SOLAPI_API_SECRET || !KAKAO_PFID || !templateId || !to) return;
  const date = new Date().toISOString();
  const salt = Math.random().toString(36).substring(2, 18);
  const signature = createHmac('sha256', SOLAPI_API_SECRET).update(date + salt).digest('hex');
  try {
    const res = await fetch('https://api.solapi.com/messages/v4/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `HMAC-SHA256 apiKey=${SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}`,
      },
      body: JSON.stringify({ message: { to, kakaoOptions: { pfId: KAKAO_PFID, templateId, variables, buttons } } }),
    });
    const data = await res.json();
    if (!res.ok) console.error(`카카오 발송 실패 (${to}):`, JSON.stringify(data));
    else console.log(`카카오 알림톡 발송 완료: ${to}`);
  } catch (e) {
    console.error(`카카오 발송 오류 (${to}):`, e.message);
  }
}

function getTodayKST() {
  const now = new Date();
  const kstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const todayStr = kstDate.toISOString().split('T')[0];
  const tomorrow = new Date(kstDate);
  tomorrow.setUTCDate(kstDate.getUTCDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  return { todayStr, tomorrowStr };
}

function stripEmoji(name) {
  return name.replace(/^[🟢🟡⚫]\s/, '');
}

async function main() {
  const { todayStr, tomorrowStr } = getTodayKST();
  console.log(`[${new Date().toISOString()}] 오늘(${todayStr}) 수업 있는 학생 알림 시작`);

  // 오늘 수업 조회 (취소 제외)
  const res = await notion('POST', `/databases/${CLASS_DB_ID}/query`, {
    filter: {
      and: [
        { property: '수업 일시', date: { on_or_after: `${todayStr}T00:00:00+09:00` } },
        { property: '수업 일시', date: { before: `${tomorrowStr}T00:00:00+09:00` } },
      ],
    },
    sorts: [{ property: '수업 일시', direction: 'ascending' }],
  });

  const classes = res.results.filter(
    p => p.properties['특이사항']?.select?.name !== '🚫 취소'
  );

  console.log(`오늘 수업 ${classes.length}개 (취소 제외)`);

  if (classes.length === 0) {
    console.log('오늘 수업 없음 - 알림 생략');
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
      token: props['예약 코드']?.rich_text?.[0]?.plain_text ?? '',
    };
    return studentCache[id];
  }

  let sent = 0;
  for (const p of classes) {
    const dateVal = p.properties['수업 일시']?.date?.start;
    const duration = p.properties['수업 시간(분)']?.select?.name ?? '?';
    const studentRelation = p.properties['학생']?.relation ?? [];

    if (!dateVal || studentRelation.length === 0) continue;

    const classDate = new Date(dateVal);
    const timeStr = classDate.toLocaleTimeString('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
    });

    for (const { id } of studentRelation) {
      const student = await getStudent(id);
      if (!student.phone) {
        console.log(`  전화번호 없음 (${student.name}) - 건너뜀`);
        continue;
      }

      const bookingUrl = student.token ? `${BOOKING_BASE_URL}${student.token}` : BOOKING_BASE_URL;
      await sendKakao(
        student.phone,
        KAKAO_TPL_STU_TODAY,
        {
          '#{이름}': student.name,
          '#{시간}': timeStr,
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

  console.log(`완료: 학생 ${sent}명에게 당일 리마인더 발송`);
}

main().catch(err => {
  console.error('오류:', err.message);
  process.exit(1);
});
