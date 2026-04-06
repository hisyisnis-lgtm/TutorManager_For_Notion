// 무료상담 전날 리마인더 알림 스크립트
// GitHub Actions에서 매일 특정 시간에 자동 실행됨
// CLASS_DB 중 전화번호가 입력된 수업(= 무료상담)을 찾아 내일 상담 있는 번호로 카카오 알림톡 발송

import { createHmac, randomBytes } from 'crypto';
import { createNotionClient } from './notion_utils.mjs';

const TOKEN = process.env.NOTION_TOKEN;
const CLASS_DB_ID = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';

const SOLAPI_API_KEY = process.env.SOLAPI_API_KEY;
const SOLAPI_API_SECRET = process.env.SOLAPI_API_SECRET;
const KAKAO_PFID = process.env.KAKAO_PFID;
const KAKAO_TPL_CONSULT_TOMORROW = process.env.KAKAO_TPL_CONSULT_TOMORROW;

if (!TOKEN) {
  console.error('NOTION_TOKEN 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const { notion } = createNotionClient(TOKEN);

async function sendKakao(to, templateId, variables) {
  if (!SOLAPI_API_KEY || !SOLAPI_API_SECRET || !KAKAO_PFID || !templateId || !to) {
    console.log(`  카카오 설정 미완료 — 발송 건너뜀 (${to})`);
    return;
  }
  const date = new Date().toISOString();
  const salt = randomBytes(8).toString('hex');
  const signature = createHmac('sha256', SOLAPI_API_SECRET).update(date + salt).digest('hex');
  try {
    const res = await fetch('https://api.solapi.com/messages/v4/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `HMAC-SHA256 apiKey=${SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}`,
      },
      body: JSON.stringify({ message: { to, kakaoOptions: { pfId: KAKAO_PFID, templateId, variables } } }),
    });
    const data = await res.json();
    if (!res.ok) console.error(`카카오 발송 실패 (${to}):`, JSON.stringify(data));
    else console.log(`카카오 알림톡 발송 완료: ${to}`);
  } catch (e) {
    console.error(`카카오 발송 오류 (${to}):`, e.message);
  }
}

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

async function main() {
  const { tomorrowStr, dayAfterStr } = getTomorrowKST();
  console.log(`[${new Date().toISOString()}] 내일(${tomorrowStr}) 무료상담 D-1 알림 시작`);

  // 내일 수업 중 전화번호가 있는 항목 조회 (취소 제외)
  let allResults = [];
  let cursor;
  do {
    const res = await notion('POST', `/databases/${CLASS_DB_ID}/query`, {
      start_cursor: cursor,
      filter: {
        and: [
          { property: '수업 일시', date: { on_or_after: `${tomorrowStr}T00:00:00+09:00` } },
          { property: '수업 일시', date: { before: `${dayAfterStr}T00:00:00+09:00` } },
          { property: '전화번호', rich_text: { is_not_empty: true } },
        ],
      },
      sorts: [{ property: '수업 일시', direction: 'ascending' }],
    });
    allResults = allResults.concat(res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  // 취소된 수업 제외
  const consultations = allResults.filter(
    p => p.properties['특이사항']?.select?.name !== '🚫 취소'
  );

  console.log(`내일 무료상담 ${consultations.length}건 (취소 제외)`);

  if (consultations.length === 0) {
    console.log('내일 무료상담 없음 - 알림 생략');
    return;
  }

  let sent = 0;
  for (const p of consultations) {
    const dateVal = p.properties['수업 일시']?.date?.start;
    const phone = p.properties['전화번호']?.rich_text?.[0]?.plain_text ?? '';
    const guestName = p.properties['제목']?.title?.[0]?.plain_text ?? '고객';

    if (!dateVal || !phone) continue;

    const classDate = new Date(dateVal);
    const month = classDate.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric' }).replace('월', '');
    const day = classDate.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', day: 'numeric' }).replace('일', '');
    const dayOfWeek = DAY_KR[classDate.getDay()];
    const timeStr = classDate.toLocaleTimeString('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
    });

    console.log(`  발송 → ${phone} (${guestName}, ${month}월 ${day}일 ${timeStr})`);
    await sendKakao(
      phone,
      KAKAO_TPL_CONSULT_TOMORROW,
      {
        '#{이름}': guestName,
        '#{날짜}': `${month}월 ${day}일`,
        '#{요일}': dayOfWeek,
        '#{시간}': timeStr,
      }
    );
    sent++;
  }

  console.log(`완료: ${sent}건 무료상담 D-1 알림 발송`);
}

main().catch(err => {
  console.error('오류:', err.message);
  process.exit(1);
});
