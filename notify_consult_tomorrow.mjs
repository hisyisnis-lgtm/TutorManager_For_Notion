// 무료상담/원데이클래스 전날 리마인더 알림 스크립트
// GitHub Actions에서 매일 특정 시간에 자동 실행됨
// CLASS_DB 중 전화번호가 입력된 수업을 찾아 내일 수업 있는 번호로 카카오 알림톡 발송
// 수업 유형에 따라 다른 템플릿 사용: 무료상담 → KAKAO_TPL_CONSULT_TOMORROW, 원데이클래스 → KAKAO_TPL_ONEDAY_TOMORROW

import { createHmac, randomBytes } from 'crypto';
import { createNotionClient } from './notion_utils.mjs';

const TOKEN = process.env.NOTION_TOKEN;
const CLASS_DB_ID = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';
const LESSON_TYPE_DB_ID = '314838fa-f2a6-81c3-b4e4-da87c48f9b43';

const SOLAPI_API_KEY = process.env.SOLAPI_API_KEY;
const SOLAPI_API_SECRET = process.env.SOLAPI_API_SECRET;
const KAKAO_PFID = process.env.KAKAO_PFID;
const KAKAO_TPL_CONSULT_TOMORROW = process.env.KAKAO_TPL_CONSULT_TOMORROW;
const KAKAO_TPL_ONEDAY_TOMORROW = process.env.KAKAO_TPL_ONEDAY_TOMORROW;

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
  for (let attempt = 1; attempt <= 3; attempt++) {
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
      if (!res.ok) {
        console.error(`카카오 발송 실패 (${to}):`, JSON.stringify(data));
        return;
      }
      console.log(`카카오 알림톡 발송 완료: ${to}`);
      return;
    } catch (e) {
      if (attempt < 3) {
        console.warn(`카카오 발송 오류 (${to}), ${attempt}회 시도 실패 — 2초 후 재시도:`, e.message);
        await new Promise(r => setTimeout(r, 2000));
      } else {
        console.error(`카카오 발송 오류 (${to}), 최종 실패:`, e.message);
      }
    }
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
      // 하이픈 유무 모두 등록 (Notion ID 형식 불일치 대비)
      map.set(p.id, title);
      map.set(p.id.replace(/-/g, ''), title);
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return map;
}

async function main() {
  const { tomorrowStr, dayAfterStr } = getTomorrowKST();
  console.log(`[${new Date().toISOString()}] 내일(${tomorrowStr}) D-1 알림 시작 (무료상담/원데이클래스)`);

  // 수업 유형 맵 미리 조회
  const classTypeMap = await fetchClassTypeMap();
  console.log(`수업 유형 ${classTypeMap.size / 2}개 로드 완료`);

  // 내일 수업 중 전화번호가 있는 항목 조회
  let allResults = [];
  let cursor;
  do {
    const res = await notion('POST', `/databases/${CLASS_DB_ID}/query`, {
      start_cursor: cursor,
      filter: {
        and: [
          { property: '수업 일시', date: { on_or_after: `${tomorrowStr}T00:00:00+09:00` } },
          { property: '수업 일시', date: { before: `${dayAfterStr}T00:00:00+09:00` } },
        ],
      },
      sorts: [{ property: '수업 일시', direction: 'ascending' }],
    });
    allResults = allResults.concat(res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  // 취소 제외 + 전화번호 있는 항목만
  const targets = allResults.filter(
    p => p.properties['특이사항']?.select?.name !== '🚫 취소'
      && p.properties['전화번호']?.rich_text?.[0]?.plain_text
  );

  console.log(`내일 알림 대상 ${targets.length}건 (취소 제외)`);

  if (targets.length === 0) {
    console.log('내일 알림 대상 없음 - 알림 생략');
    return;
  }

  let sent = 0;
  for (const p of targets) {
    const dateVal = p.properties['수업 일시']?.date?.start;
    const phone = p.properties['전화번호']?.rich_text?.[0]?.plain_text ?? '';
    const guestName = p.properties['제목']?.title?.[0]?.plain_text ?? '고객';

    if (!dateVal || !phone) continue;

    // 수업 유형 판별
    const classTypeId = p.properties['수업 유형']?.relation?.[0]?.id ?? '';
    const classTypeTitle = classTypeMap.get(classTypeId) ?? classTypeMap.get(classTypeId.replace(/-/g, '')) ?? '';
    const isOneDay = classTypeTitle.includes('원데이클래스');
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

    console.log(`  발송 → ${phone} [${typeLabel}] (${guestName}, ${month}월 ${day}일 ${timeStr})`);
    await sendKakao(
      phone,
      templateId,
      {
        '#{이름}': guestName,
        '#{날짜}': `${month}월 ${day}일`,
        '#{요일}': dayOfWeek,
        '#{시간}': timeStr,
      }
    );
    sent++;
  }

  console.log(`완료: ${sent}건 D-1 알림 발송`);
}

main().catch(err => {
  console.error('오류:', err.message);
  process.exit(1);
});
