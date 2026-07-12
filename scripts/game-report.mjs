// 성조게임 통합 지표 리포트 (콘솔 + HTML 대시보드) — 로컬 실행용.
// 렌더/조립은 worker/lib/gameDashboard.js(워커와 공용)에서 import. 여기선 Cloudflare 데이터 fetch만.
//
// 실행:
//   export PATH="/c/Program Files/nodejs:$PATH"
//   CF_ACCOUNT_ID=xxxx CF_API_TOKEN=yyyy node scripts/game-report.mjs [일수=7] [--html]
//   · 기본  → 콘솔 요약   · --html → game-report.html (일자별 기간 필터 대시보드)
// 참고: 라이브 대시보드는 워커 GET /game/dashboard?key=… (노션 링크). 이 스크립트는 로컬 확인·백업용.
//
// CF_API_TOKEN 권한: Account · Analytics Engine : Read + Account · D1 : Read

import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { KEY_LABEL, assembleByDay, embedMembers, renderDashboard } from '../worker/lib/gameDashboard.js';

const AE_DATASET = 'tone_game_events';
const D1_DATABASE_ID = '1cb6265b-95e4-47cc-a0c8-5ac00266b9fa'; // tone-game-users (worker/wrangler.toml)
const ACCOUNT_ID = process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const argv = process.argv.slice(2);
const AS_HTML = argv.includes('--html');
const DAYS = Number(argv.find((a) => /^\d+$/.test(a))) || 7;
const MAX_DAYS = 30;

const num = (x) => (Number(x) || 0).toLocaleString('ko-KR');
const pct = (a, b) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : '—');
const cutoffMs = Date.now() - DAYS * 24 * 60 * 60 * 1000;

const AE_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/analytics_engine/sql`;
async function runAeSql(sql) {
  const res = await fetch(AE_URL, { method: 'POST', headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'text/plain' }, body: sql });
  const text = await res.text();
  if (!res.ok) throw new Error(`AE SQL ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text).data || [];
}
const D1_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`;
async function runD1Sql(sql) {
  const res = await fetch(D1_URL, { method: 'POST', headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params: [] }) });
  const text = await res.text();
  if (!res.ok) throw new Error(`D1 ${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  if (!json.success) throw new Error(`D1 오류: ${JSON.stringify(json.errors).slice(0, 200)}`);
  return json.result?.[0]?.results || [];
}

// ── 콘솔 경로(창 집계) ──
async function getFunnel() {
  const W = `timestamp > NOW() - INTERVAL '${DAYS}' DAY`;
  const events = await runAeSql(`SELECT blob1 AS event, SUM(_sample_interval) AS n FROM ${AE_DATASET} WHERE ${W} GROUP BY event`);
  const c = Object.fromEntries(events.map((r) => [r.event, Number(r.n) || 0]));
  return { c, enter: c.enter || 0, runStart: c.run_start || 0 };
}
async function getMembersConsole() {
  const rows = await runD1Sql('SELECT provider, game_data, created_at, last_seen_at FROM game_users');
  const byProvider = {}; let active = 0, recent = 0; const agg = {};
  for (const r of rows) {
    byProvider[r.provider || '(미상)'] = (byProvider[r.provider || '(미상)'] || 0) + 1;
    if (r.last_seen_at && Date.parse(r.last_seen_at) >= cutoffMs) active++;
    if (r.created_at && Date.parse(r.created_at) >= cutoffMs) recent++;
    let best = {};
    try { best = JSON.parse(r.game_data || '{}').best || {}; } catch { best = {}; }
    for (const [k, b] of Object.entries(best)) { if (!b) continue; const a = agg[k] || (agg[k] = { label: KEY_LABEL[k] || k, max: 0, plays: 0 }); a.max = Math.max(a.max, b.bestScore || 0); a.plays += b.playCount || 0; }
  }
  return { total: rows.length, byProvider, active, recent, modes: Object.values(agg).sort((x, y) => y.max - x.max) };
}
function printConsole(funnel, members) {
  console.log(`\n═══ 성조게임 지표 리포트 (최근 ${DAYS}일) ═══`);
  console.log(`\n🎯 ① 유입 (Analytics Engine)\n${'─'.repeat(42)}`);
  if (!funnel) console.log('  ⚠️ 조회 불가 (CF_API_TOKEN / Analytics Engine: Read)');
  else if (!funnel.enter && !funnel.runStart) console.log('  아직 집계된 이벤트가 없어요.');
  else { const c = funnel.c, e = funnel.enter, rs = funnel.runStart; for (const [l, n, base] of [['진입', e, null], ['온보딩 완료', c.onboarding_done || 0, e], ['로그인', c.login_success || 0, e], ['판 시작', rs, e], ['판 종료', c.run_end || 0, rs], ['CTA 클릭', c.cta_play_link || 0, e]]) console.log(`  ${l.padEnd(12)}${num(n).padStart(8)}${base != null ? `  (${pct(n, base)})` : ''}`); }
  console.log(`\n👤 ② 회원·점수 (D1)\n${'─'.repeat(42)}`);
  if (!members) console.log('  ⚠️ 조회 불가 (CF_API_TOKEN / D1: Read)');
  else if (!members.total) console.log('  아직 가입한 회원이 없어요.');
  else { console.log(`  총 회원 ${num(members.total)} · 활성 ${num(members.active)} · 신규 ${num(members.recent)} (최근 ${DAYS}일)`); for (const m of members.modes) console.log(`  ${m.label.padEnd(10)}최고 ${num(m.max).padStart(9)}  플레이 ${num(m.plays).padStart(5)}`); }
  console.log(`\n(라이브 대시보드: 워커 /game/dashboard?key=… · 로컬: node scripts/game-report.mjs ${DAYS} --html)\n`);
}

// ── HTML 경로(일별 원본 → 공유 조립기) ──
async function getByDay() {
  const W = `timestamp > NOW() - INTERVAL '${MAX_DAYS}' DAY`;
  const B = "toStartOfInterval(timestamp, INTERVAL '1' DAY)";
  const [ev, ch, src, mp, ms, id] = await Promise.all([
    runAeSql(`SELECT ${B} AS day, blob1 AS k, SUM(_sample_interval) AS n FROM ${AE_DATASET} WHERE ${W} GROUP BY day, k`),
    runAeSql(`SELECT ${B} AS day, blob2 AS k, SUM(_sample_interval) AS n FROM ${AE_DATASET} WHERE blob1='cta_play_link' AND ${W} GROUP BY day, k`),
    runAeSql(`SELECT ${B} AS day, blob3 AS k, SUM(_sample_interval) AS n FROM ${AE_DATASET} WHERE blob1='enter' AND ${W} GROUP BY day, k`),
    runAeSql(`SELECT ${B} AS day, blob2 AS k, SUM(_sample_interval) AS n FROM ${AE_DATASET} WHERE blob1='run_start' AND ${W} GROUP BY day, k`),
    runAeSql(`SELECT ${B} AS day, blob2 AS k, SUM(double1*_sample_interval) AS sv, SUM(_sample_interval) AS sn FROM ${AE_DATASET} WHERE blob1='run_end' AND ${W} GROUP BY day, k`),
    runAeSql(`SELECT ${B} AS day, blob4 AS k, SUM(_sample_interval) AS n FROM ${AE_DATASET} WHERE blob1='run_start' AND ${W} GROUP BY day, k`),
  ]);
  return assembleByDay({ ev, ch, src, mp, ms, id }, MAX_DAYS, Date.now());
}
async function getMemberEmbed() { return embedMembers(await runD1Sql('SELECT provider, game_data, created_at, last_seen_at FROM game_users')); }

function writeHtmlFile(body) {
  writeFileSync('game-report.html', `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>성조게임 Analytics</title></head><body style="margin:0">${body}</body></html>`, 'utf8');
  console.log('✅ game-report.html 생성 — 브라우저로 열어 보세요.');
}

async function main() {
  if (!ACCOUNT_ID || !API_TOKEN) { console.error('❌ 환경변수 필요: CF_ACCOUNT_ID, CF_API_TOKEN (Analytics Engine: Read + D1: Read)'); process.exit(1); }
  if (AS_HTML) {
    const [byday, members] = await Promise.all([
      getByDay().catch((e) => { console.error(`⚠️ 일별 유입 조회 실패: ${e.message}`); return { days: [], byDay: {} }; }),
      getMemberEmbed().catch((e) => { console.error(`⚠️ 회원 조회 실패: ${e.message}`); return []; }),
    ]);
    const now = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    writeHtmlFile(renderDashboard({ byDay: byday.byDay, days: byday.days, members, maxDays: MAX_DAYS, generatedAt: now }));
  } else {
    const [funnel, members] = await Promise.all([
      getFunnel().catch((e) => { console.error(`⚠️ 유입 조회 실패: ${e.message}`); return null; }),
      getMembersConsole().catch((e) => { console.error(`⚠️ 회원 조회 실패: ${e.message}`); return null; }),
    ]);
    printConsole(funnel, members);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('❌', e.message); process.exit(1); });
}
