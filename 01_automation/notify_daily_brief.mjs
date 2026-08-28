// 강사 아침 브리핑 알림 스크립트
// GitHub Actions에서 매일 08:00 KST (전날 23:00 UTC)에 자동 실행됨
//
// 하루를 시작할 때 필요한 것만 한 통으로 묶는다. 알림을 여러 통으로 쪼개면 각각은 짧아도
// 강사가 하루에 받는 알림 수가 늘어 결국 다 흘려보게 된다.
//
// 출력 규칙:
// - 0건인 섹션은 줄 자체를 내보내지 않는다 (조용한 날 두세 줄로 끝나야 매일 읽힌다)
// - 섹션당 MAX_ROWS건까지만, 나머지는 "외 N건" (ntfy 알림이 접히면 안 읽힌다)
// - 오늘 수업도 0건이고 할 일도 0건이면 발송 자체를 생략

import {
  createNotionClient,
  createNtfyClient,
  runWithAlert,
  stripEmoji,
  loadPaidSessions,
  shouldSkipBackupRun,
} from './notion_utils.mjs';

const TOKEN = process.env.NOTION_TOKEN;
const NTFY_TOPIC = process.env.NTFY_TOPIC;
const NTFY_TOKEN = process.env.NTFY_TOKEN;

const CLASS_DB = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';
const STUDENT_DB = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';
const PAYMENTS_DB = '314838fa-f2a6-8154-935b-edd3d2fbea83';
const HOMEWORK_DB = '5ce7d5ef-7b80-4795-843f-325f4ca868e2';
const CONSULT_DB = '324838fa-f2a6-815d-99a7-ff165e8f78aa';
const LOG_DB = '318838fa-f2a6-81f1-9b9c-fd379b1026ed';

const KST = 'Asia/Seoul';

// 아래 두 값은 강사앱 홈(pwa/src/pages/HomePage.jsx)과 같은 기준이다.
// 한쪽만 바꾸면 앱 배너와 알림이 서로 다른 학생을 가리킨다 — 반드시 같이 고칠 것.
const SHORTAGE_WINDOW_DAYS = 30;   // 예정 수업을 며칠 앞까지 살필지
const PAYMENT_DUE_LEAD_DAYS = 10;  // 결제 필요일 D-N 안에 든 학생만 표시

// create_lesson_logs.mjs가 최근 7일치 수업에만 빈 일지를 만든다. 판정 창을 맞춘다.
const LOG_LOOKBACK_DAYS = 7;

// 섹션당 최대 표시 건수
const MAX_ROWS = 5;

if (!TOKEN) {
  console.error('NOTION_TOKEN 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const { queryAll } = createNotionClient(TOKEN);
const sendNtfy = createNtfyClient(NTFY_TOPIC, NTFY_TOKEN);

// ===== 날짜 유틸 (모두 KST 기준) =====

const dayStr = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: KST }).format(d); // YYYY-MM-DD
const addDays = (str, n) => {
  const d = new Date(`${str}T00:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() + n);
  return dayStr(d);
};
const timeOf = (iso) =>
  new Date(iso).toLocaleTimeString('ko-KR', { timeZone: KST, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const shortDate = (iso) => {
  const [, m, d] = dayStr(new Date(iso)).split('-');
  return `${Number(m)}/${Number(d)}`;
};
const daysSince = (iso, todayStr) =>
  Math.round((new Date(`${todayStr}T00:00:00Z`) - new Date(`${dayStr(new Date(iso))}T00:00:00Z`)) / 86400000);

// 0.5시간 같은 반 회차는 그대로 보여주되 정수엔 소수점을 붙이지 않는다
const hours = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const won = (n) => `${n.toLocaleString('ko-KR')}원`;

/** MAX_ROWS 초과분은 "외 N건"으로 접는다 */
function fold(rows, unit = '건') {
  if (rows.length <= MAX_ROWS) return rows;
  return [...rows.slice(0, MAX_ROWS), `  외 ${rows.length - MAX_ROWS}${unit}`];
}

async function main() {
  // 워커 cron(1차)이 이미 보냈으면 백업 schedule 실행은 여기서 끝낸다
  if (await shouldSkipBackupRun({ workflow: 'notify-daily-brief.yml', latestHourKST: 11 })) return;

  const now = new Date();
  const todayStr = dayStr(now);
  console.log(`[${now.toISOString()}] 브리핑 생성: ${todayStr}`);

  // ===== 공통 조회 =====
  const students = await queryAll(STUDENT_DB);
  const nameOf = {};
  for (const s of students) {
    nameOf[s.id] = stripEmoji(s.properties['이름']?.title?.[0]?.plain_text ?? '?');
  }

  // ===== 1. 오늘 수업 =====
  const todayClasses = (
    await queryAll(
      CLASS_DB,
      {
        and: [
          { property: '수업 일시', date: { on_or_after: `${todayStr}T00:00:00+09:00` } },
          { property: '수업 일시', date: { before: `${addDays(todayStr, 1)}T00:00:00+09:00` } },
        ],
      },
      [{ property: '수업 일시', direction: 'ascending' }]
    )
  ).filter((p) => p.properties['특이사항']?.select?.name !== '🚫 취소');

  // ===== 2. 결제 안내 필요 =====
  // 성격이 다른 두 신호를 합친다.
  //  (1) 초과      : 이미 잡아둔 수업이 결제한 시간을 넘었다 (회차부족_감지 체크박스)
  //  (2) 여유 없음 : 잔여 0시간 이하 — 수업을 더 잡으려면 결제가 필요하다
  // (2)를 빼면 "다음 수업도 안 잡힌 잔여 0시간" 학생을 통째로 놓친다.
  //
  // (1)은 check_session_shortage.mjs가 이미 켜둔 체크박스를 읽기만 한다.
  // 여기서 초과 판정을 다시 계산하면 같은 로직이 하나 더 늘어난다.
  const paidByStudent = await loadPaidSessions(queryAll, PAYMENTS_DB);
  const windowEnd = new Date(now.getTime() + SHORTAGE_WINDOW_DAYS * 86400000);
  const upcoming = await queryAll(
    CLASS_DB,
    {
      and: [
        { property: '수업 일시', date: { on_or_after: now.toISOString() } },
        { property: '수업 일시', date: { before: windowEnd.toISOString() } },
      ],
    },
    [{ property: '수업 일시', direction: 'ascending' }]
  );

  const firstShortage = {}; // 학생별 가장 이른 '시간 부족' 수업
  const lastClass = {};     // 학생별 가장 늦은 예정 수업 (오름차순이라 마지막 값이 남는다)
  for (const cls of upcoming) {
    const dt = cls.properties['수업 일시']?.date?.start;
    if (!dt) continue;
    const short = cls.properties['회차부족_감지']?.checkbox ?? false;
    for (const { id } of cls.properties['학생']?.relation ?? []) {
      if (short && !firstShortage[id]) firstShortage[id] = dt;
      lastClass[id] = dt;
    }
  }

  const cutoff = now.getTime() + PAYMENT_DUE_LEAD_DAYS * 86400000;
  const withinLead = (iso) => !iso || new Date(iso).getTime() <= cutoff;

  const paymentDue = [];
  for (const s of students) {
    if (s.properties['상태']?.select?.name !== '🟢 수강중') continue;
    const shortageAt = firstShortage[s.id];
    const remaining =
      (paidByStudent.get(s.id) ?? 0) - (s.properties['사용 시간 회차']?.rollup?.number ?? 0);

    if (shortageAt) {
      if (!withinLead(shortageAt)) continue;
      paymentDue.push({
        urgent: true,
        dueAt: shortageAt,
        line: `  · ${nameOf[s.id]} — ${shortDate(shortageAt)} 수업부터 초과`,
      });
    } else if (remaining <= 0) {
      const lastAt = lastClass[s.id];
      if (!withinLead(lastAt)) continue;
      paymentDue.push({
        urgent: false,
        dueAt: lastAt,
        line: lastAt
          ? `  · ${nameOf[s.id]} — 잔여 ${hours(remaining)}시간 · ${shortDate(lastAt)} 수업까지`
          : `  · ${nameOf[s.id]} — 잔여 ${hours(remaining)}시간 · 다음 수업 없음`,
      });
    }
  }
  // 이미 넘긴 사람 먼저, 그다음 결제가 필요해지는 날이 이른 순
  paymentDue.sort(
    (a, b) =>
      (b.urgent === true) - (a.urgent === true) ||
      String(a.dueAt ?? '').localeCompare(String(b.dueAt ?? ''))
  );

  // ===== 3. 피드백 대기 숙제 =====
  // 제출은 됐는데 피드백이 안 달린 것. 며칠째인지가 핵심 — 개수만으로는 방치를 못 잡는다.
  const pendingHw = await queryAll(
    HOMEWORK_DB,
    {
      and: [
        { property: '제출 상태', select: { equals: '제출완료' } },
        { property: '피드백일', date: { is_empty: true } },
      ],
    },
    [{ property: '제출일', direction: 'ascending' }]
  );

  // ===== 4. 미수금 =====
  const unpaid = students
    .filter((s) => {
      const status = s.properties['상태']?.select?.name;
      const amount = s.properties['미수금 합계']?.rollup?.number ?? 0;
      return (status === '🟢 수강중' || status === '🟡 일시중단') && amount > 0;
    })
    .map((s) => ({ name: nameOf[s.id], amount: s.properties['미수금 합계'].rollup.number }))
    .sort((a, b) => b.amount - a.amount);

  // ===== 5. 수업 일지 미작성 =====
  // 수업 일지 DB에는 날짜 속성이 없어 created_time으로 창을 자른다
  // (create_lesson_logs.mjs가 수업 직후에 만들기 때문에 수업일과 거의 같다).
  const lookback = new Date(now.getTime() - LOG_LOOKBACK_DAYS * 86400000);
  const emptyLogs = await queryAll(LOG_DB, {
    and: [
      { property: '오늘 내용', rich_text: { is_empty: true } },
      { timestamp: 'created_time', created_time: { on_or_after: lookback.toISOString() } },
    ],
  });

  // ===== 6. 미확인 무료상담 =====
  const consults = await queryAll(CONSULT_DB, { property: '상태', select: { equals: '신청됨' } });

  // ===== 메시지 조립 =====
  const todoCount =
    paymentDue.length + pendingHw.length + unpaid.length + emptyLogs.length + consults.length;
  if (todayClasses.length === 0 && todoCount === 0) {
    console.log('오늘 수업도 할 일도 없음 - 발송 생략');
    return;
  }

  const sections = [];

  if (todayClasses.length > 0) {
    const items = todayClasses.map((c) => {
      const dt = c.properties['수업 일시'].date.start;
      const names = (c.properties['학생']?.relation ?? []).map((r) => nameOf[r.id] ?? '?');
      return `${timeOf(dt)} ${names.length > 0 ? names.join(', ') : '미지정'}`;
    });
    const shown = items.slice(0, MAX_ROWS).join(' · ');
    const rest = items.length > MAX_ROWS ? ` · 외 ${items.length - MAX_ROWS}건` : '';
    sections.push(`[오늘 수업 ${todayClasses.length}건] ${shown}${rest}`);
  } else {
    sections.push('[오늘 수업 없음]');
  }

  if (paymentDue.length > 0) {
    sections.push(
      [`[결제 안내 ${paymentDue.length}명]`, ...fold(paymentDue.map((r) => r.line), '명')].join('\n')
    );
  }

  if (pendingHw.length > 0) {
    const rows = pendingHw.map((hw) => {
      const p = hw.properties;
      const title = p['제목']?.title?.[0]?.plain_text ?? '(제목 없음)';
      const who = (p['학생']?.relation ?? []).map((r) => nameOf[r.id] ?? '?').join(', ') || '미지정';
      const submitted = p['제출일']?.date?.start;
      const d = submitted ? daysSince(submitted, todayStr) : null;
      return `  · ${who} "${title}"${d != null ? ` ${d}일째` : ''}`;
    });
    const oldest = pendingHw[0]?.properties['제출일']?.date?.start;
    const worst = oldest ? ` (최장 ${daysSince(oldest, todayStr)}일)` : '';
    sections.push([`[피드백 대기 ${pendingHw.length}건${worst}]`, ...fold(rows)].join('\n'));
  }

  if (unpaid.length > 0) {
    const total = unpaid.reduce((sum, u) => sum + u.amount, 0);
    const rows = unpaid.map((u) => `  · ${u.name} ${won(u.amount)}`);
    sections.push([`[미수금 ${unpaid.length}명 · 합계 ${won(total)}]`, ...fold(rows, '명')].join('\n'));
  }

  if (emptyLogs.length > 0) {
    const rows = emptyLogs.map(
      (l) => `  · ${l.properties['제목']?.title?.[0]?.plain_text ?? '(제목 없음)'}`
    );
    sections.push([`[수업 일지 미작성 ${emptyLogs.length}건]`, ...fold(rows)].join('\n'));
  }

  if (consults.length > 0) {
    sections.push(`[미확인 상담 ${consults.length}건]`);
  }

  const weekday = new Intl.DateTimeFormat('ko-KR', { timeZone: KST, weekday: 'short' }).format(now);
  const [, m, d] = todayStr.split('-');
  const title = `📋 ${Number(m)}/${Number(d)}(${weekday}) 브리핑`;

  console.log(`섹션 ${sections.length}개 / 할 일 ${todoCount}건`);
  await sendNtfy(title, sections.join('\n\n'), 4);
}

runWithAlert('notify_daily_brief.mjs', main);
