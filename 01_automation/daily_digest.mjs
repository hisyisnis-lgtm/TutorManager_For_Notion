// 일일 디지스트 — GitHub Actions에서 매일 09:00 KST에 실행
//
// 어제(KST 기준 24시간) 동안 발생한 운영 이슈를 한 번에 요약해서 ntfy digest 토픽으로 발송:
//   1. 실패한 GitHub Actions 워크플로우 (gh REST API)
//   2. Solapi 알림톡 발송 통계 (성공/실패/SMS 대체)
//   3. Worker 클라이언트 에러 — 카운트만 (자세한 건 critical/warn 토픽에서 이미 받음)
//
// 환경변수:
//   GITHUB_TOKEN              — Actions 기본 제공 (워크플로우 조회용)
//   GITHUB_REPOSITORY         — Actions 기본 제공 (예: "owner/repo")
//   SOLAPI_API_KEY/SECRET     — 솔라피 메시지 통계 조회용 (선택)
//   NTFY_TOPIC_DIGEST or NTFY_TOPIC — 발송 토픽
//   NTFY_TOKEN                — ntfy 인증 토큰 (선택)

import { createHmac, randomBytes } from 'crypto';
import { runWithAlert, sendAlert } from './notion_utils.mjs';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY; // "hisyisnis-lgtm/TutorManager_For_Notion"
const SOLAPI_API_KEY = process.env.SOLAPI_API_KEY;
const SOLAPI_API_SECRET = process.env.SOLAPI_API_SECRET;

// ===== 시간 유틸 =====
function getKstDayBounds(daysAgo = 1) {
  // KST 기준 daysAgo일 전 자정 ~ 오늘 자정 (UTC ISO 반환)
  const now = new Date();
  // 현재 시각의 KST 자정 (UTC offset +9h)
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kstNow.setUTCHours(0, 0, 0, 0);
  const kstStartOfYesterday = new Date(kstNow.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  const kstEndOfYesterday = new Date(kstStartOfYesterday.getTime() + 24 * 60 * 60 * 1000);
  // KST 자정 → UTC 보정 (-9h)
  const startUtc = new Date(kstStartOfYesterday.getTime() - 9 * 60 * 60 * 1000);
  const endUtc = new Date(kstEndOfYesterday.getTime() - 9 * 60 * 60 * 1000);
  return {
    startIso: startUtc.toISOString(),
    endIso: endUtc.toISOString(),
    label: `${kstStartOfYesterday.toISOString().slice(5, 10)} (KST)`,
  };
}

// ===== GitHub Actions 실패 워크플로우 조회 =====
async function fetchFailedWorkflows({ startIso, endIso }) {
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
    return { skipped: true, reason: 'GITHUB_TOKEN 또는 GITHUB_REPOSITORY 미설정' };
  }
  // 이 디지스트의 목적: 운영 자동화의 건강 상태 보고.
  // → schedule(주기 실행) + push(main 머지 후 CI)만 카운트.
  //   pull_request/dynamic은 Dependabot/PR 검증 결과라 머지 전엔 운영 영향 0 (노이즈).
  //   main push CI 실패는 별도로 즉시 critical 알림이 가지만, 디지스트엔 종합 표시.
  // GitHub API의 created는 ISO 8601 datetime 범위 지원. KST 자정 경계를 정확히 맞추려면
  // datetime 그대로 전달 + 받은 결과도 created_at으로 한 번 더 필터링 (이중 방어).
  const created = `${startIso}..${endIso}`;
  const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/runs?status=failure&created=${encodeURIComponent(created)}&per_page=100`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    return { skipped: true, reason: `GitHub API ${res.status}: ${await res.text().catch(() => '')}` };
  }
  const data = await res.json();

  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  const auto = (data.workflow_runs || []).filter(r => {
    // 운영 자동화 이벤트만 (PR/Dependabot의 dynamic 등은 제외)
    if (r.event !== 'schedule' && r.event !== 'push') return false;
    // KST 자정 경계 client-side 재검증 (API의 created 파라미터가 부정확해도 안전)
    const t = new Date(r.created_at).getTime();
    return t >= startMs && t < endMs;
  });
  // 워크플로우 이름별 카운트
  const byName = {};
  for (const run of auto) {
    byName[run.name] = (byName[run.name] || 0) + 1;
  }
  return { count: auto.length, byName, total: data.total_count };
}

// ===== Solapi 메시지 통계 =====
async function fetchSolapiStats({ startIso, endIso }) {
  if (!SOLAPI_API_KEY || !SOLAPI_API_SECRET) {
    return { skipped: true, reason: 'SOLAPI Secret 미설정' };
  }
  // GET /messages/v4/list?startDate=...&endDate=...&limit=500
  const params = new URLSearchParams({
    startDate: startIso,
    endDate: endIso,
    limit: '500',
  });
  const url = `https://api.solapi.com/messages/v4/list?${params}`;
  const date = new Date().toISOString();
  const salt = randomBytes(8).toString('hex');
  const signature = createHmac('sha256', SOLAPI_API_SECRET).update(date + salt).digest('hex');
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `HMAC-SHA256 apiKey=${SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}`,
      },
    });
    if (!res.ok) {
      return { skipped: true, reason: `Solapi API ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}` };
    }
    const data = await res.json();
    const messages = data.messageList ? Object.values(data.messageList) : [];
    // statusCode 분류:
    //   2000 = 정상 발송
    //   3xxx = 카카오 발송 실패 (보통 SMS 대체발송)
    //   기타 = 발송 실패
    let success = 0;
    let kakaoFailReplaced = 0; // 3xxx 중 SMS로 대체발송된 케이스
    let totalFail = 0;
    const failByCode = {};
    for (const m of messages) {
      const code = m.statusCode || '';
      if (code === '2000' || code === '4000') {
        success++;
      } else if (code.startsWith('3') && m.type === 'SMS') {
        // 대체발송 — 발송은 됐지만 카카오 알림톡은 실패한 상태
        kakaoFailReplaced++;
        failByCode[code] = (failByCode[code] || 0) + 1;
      } else {
        totalFail++;
        failByCode[code] = (failByCode[code] || 0) + 1;
      }
    }
    return { success, kakaoFailReplaced, totalFail, failByCode, scanned: messages.length };
  } catch (e) {
    return { skipped: true, reason: `Solapi 요청 오류: ${e.message}` };
  }
}

// ===== 디지스트 메시지 조립 =====
function buildDigestMessage({ label, gh, solapi }) {
  const lines = [];

  // GitHub Actions
  lines.push(`📦 GitHub Actions (${label})`);
  if (gh.skipped) {
    lines.push(`  (스킵: ${gh.reason})`);
  } else if (gh.count === 0) {
    lines.push(`  ✅ 실패 0건`);
  } else {
    lines.push(`  ⚠️ 실패 ${gh.count}건`);
    for (const [name, cnt] of Object.entries(gh.byName).sort((a, b) => b[1] - a[1])) {
      lines.push(`    · ${name}: ${cnt}회`);
    }
  }
  lines.push('');

  // Solapi 알림톡
  lines.push(`💬 카카오 알림톡 (${label})`);
  if (solapi.skipped) {
    lines.push(`  (스킵: ${solapi.reason})`);
  } else {
    lines.push(`  발송 시도 ${solapi.scanned}건`);
    lines.push(`  ✅ 정상: ${solapi.success}건`);
    if (solapi.kakaoFailReplaced > 0) {
      lines.push(`  ⚠️ 카카오 실패→SMS 대체: ${solapi.kakaoFailReplaced}건`);
    }
    if (solapi.totalFail > 0) {
      lines.push(`  ❌ 발송 실패: ${solapi.totalFail}건`);
    }
    const failCodes = Object.entries(solapi.failByCode).filter(([, c]) => c > 0);
    if (failCodes.length > 0) {
      lines.push(`  실패 코드:`);
      for (const [code, cnt] of failCodes.sort((a, b) => b[1] - a[1])) {
        lines.push(`    · ${code}: ${cnt}건`);
      }
    }
  }

  return lines.join('\n');
}

async function main() {
  const bounds = getKstDayBounds(1);
  console.log(`[digest] 어제 구간: ${bounds.startIso} ~ ${bounds.endIso} (${bounds.label})`);

  const [gh, solapi] = await Promise.all([
    fetchFailedWorkflows(bounds).catch(e => ({ skipped: true, reason: `예외: ${e.message}` })),
    fetchSolapiStats(bounds).catch(e => ({ skipped: true, reason: `예외: ${e.message}` })),
  ]);

  const message = buildDigestMessage({ label: bounds.label, gh, solapi });
  const hasIssue = (!gh.skipped && gh.count > 0) || (!solapi.skipped && (solapi.totalFail > 0 || solapi.kakaoFailReplaced > 0));
  const titlePrefix = hasIssue ? '⚠️' : '✅';

  console.log('---');
  console.log(message);
  console.log('---');

  await sendAlert({
    level: 'digest',
    title: `${titlePrefix} 일일 운영 리포트 ${bounds.label}`,
    message,
    tags: hasIssue ? ['warning', 'digest'] : ['white_check_mark', 'digest'],
  });
}

runWithAlert('daily_digest.mjs', main);
