// 성조게임 통합 지표 리포트 — 강사님이 "유의미한 지표"를 한 번에 보는 도구.
// 두 소스를 합쳐 출력한다:
//   ① 유입 깔때기  — Workers Analytics Engine(tone_game_events)  : 진입→온보딩→로그인→플레이→CTA
//   ② 회원·점수    — Cloudflare D1(game_users)                   : 회원 수·가입수단·활성/신규·모드별 최고점·플레이수
//
// 게임은 Notion과 완전 분리(2026-07-12) — 학생 GAME_BEST_DB(Notion) 경로 폐기. 지표는 전부 AE + D1에서 온다.
// 강사앱 UI는 두지 않는다(사용자 결정) — 이 스크립트가 유일한 확인 경로.
//
// 실행:
//   export PATH="/c/Program Files/nodejs:$PATH"
//   CF_ACCOUNT_ID=xxxx CF_API_TOKEN=yyyy node scripts/game-report.mjs [일수=7]
//
// CF_API_TOKEN 권한(둘 다 필요):
//   · Account · Analytics Engine : Read   (①용)
//   · Account · D1               : Read   (②용)
// ⚠️ AE는 표본추출(sampling) → COUNT(*) 금지, SUM(_sample_interval)로 추정치를 센다.

const AE_DATASET = 'tone_game_events';
const D1_DATABASE_ID = '1cb6265b-95e4-47cc-a0c8-5ac00266b9fa'; // tone-game-users (worker/wrangler.toml)
const ACCOUNT_ID = process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const DAYS = Number(process.argv[2]) || 7;

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error('❌ 환경변수 필요: CF_ACCOUNT_ID, CF_API_TOKEN (Analytics Engine: Read + D1: Read)');
  process.exit(1);
}

const num = (x) => (Number(x) || 0).toLocaleString('ko-KR');
const pct = (a, b) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : '—');
const cutoffMs = Date.now() - DAYS * 24 * 60 * 60 * 1000;

// 게임키 → 읽기 좋은 라벨(모르는 키=테마는 그대로 표시).
const KEY_LABEL = {
  'tone': '성조(레거시)', 'tone-easy': '초급', 'tone-normal': '중급', 'tone-hard': '고급',
  'tone-endless': '무한',
};
const keyLabel = (k) => KEY_LABEL[k] || k;

// ── ① Analytics Engine SQL API ─────────────────────────
const AE_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/analytics_engine/sql`;
async function runAeSql(sql) {
  const res = await fetch(AE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'text/plain' },
    body: sql,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`AE SQL ${res.status}: ${text.slice(0, 300)}`);
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`AE 응답 파싱 실패: ${text.slice(0, 300)}`); }
  return (json.data || []).map((row) => ({ ...row, n: Number(row.n) || 0 }));
}

// ── ② D1 HTTP Query API ────────────────────────────────
const D1_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`;
async function runD1Sql(sql, params = []) {
  const res = await fetch(D1_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`D1 ${res.status}: ${text.slice(0, 300)}`);
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`D1 응답 파싱 실패: ${text.slice(0, 300)}`); }
  if (!json.success) throw new Error(`D1 오류: ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json.result?.[0]?.results || [];
}

async function funnelSection() {
  const WINDOW = `timestamp > NOW() - INTERVAL '${DAYS}' DAY`;
  const [events, ctaByChannel, enterBySrc] = await Promise.all([
    runAeSql(`SELECT blob1 AS event, SUM(_sample_interval) AS n FROM ${AE_DATASET} WHERE ${WINDOW} GROUP BY event`),
    runAeSql(`SELECT blob2 AS channel, SUM(_sample_interval) AS n FROM ${AE_DATASET} WHERE blob1 = 'cta_play_link' AND ${WINDOW} GROUP BY channel ORDER BY n DESC`),
    runAeSql(`SELECT blob3 AS src, SUM(_sample_interval) AS n FROM ${AE_DATASET} WHERE blob1 = 'enter' AND ${WINDOW} GROUP BY src ORDER BY n DESC`),
  ]);
  const c = Object.fromEntries(events.map((r) => [r.event, r.n]));
  const enter = c.enter || 0;
  const runStart = c.run_start || 0;

  console.log(`\n🎯 ① 유입 깔때기 (Analytics Engine) — 최근 ${DAYS}일\n${'─'.repeat(42)}`);
  if (enter === 0 && runStart === 0) {
    console.log('  아직 집계된 이벤트가 없어요. (플레이어 유입 후 다시 실행)');
    return;
  }
  const rows = [
    ['진입 (enter)',        enter,                  null],
    ['온보딩 완료',          c.onboarding_done || 0, enter],
    ['로그인',              c.login_success || 0,   enter],
    ['판 시작 (run_start)',  runStart,               enter],
    ['판 종료 (run_end)',    c.run_end || 0,         runStart],
    ['CTA 클릭',            c.cta_play_link || 0,   enter],
  ];
  for (const [label, n, base] of rows) {
    const rate = base != null ? `  (${pct(n, base)})` : '';
    console.log(`  ${label.padEnd(20, ' ')}${num(n).padStart(8, ' ')}${rate}`);
  }
  if (ctaByChannel.length) {
    console.log(`\n  채널별 CTA 클릭`);
    for (const r of ctaByChannel) console.log(`    ├ ${(r.channel || '(없음)').padEnd(10, ' ')}${num(r.n).padStart(6, ' ')}`);
  }
  if (enterBySrc.length) {
    console.log(`\n  유입 소스별 진입 (web=웹 · standalone=PWA · twa=스토어앱)`);
    for (const r of enterBySrc) console.log(`    ├ ${(r.src || '(없음)').padEnd(12, ' ')}${num(r.n).padStart(6, ' ')}`);
  }
  console.log(`\n  📌 진입→CTA 클릭률: ${pct(c.cta_play_link || 0, enter)}`);
}

async function membersSection() {
  const rows = await runD1Sql(
    'SELECT id, provider, nickname, game_data, created_at, last_seen_at FROM game_users',
  );
  console.log(`\n👤 ② 회원·점수 (D1 game_users)\n${'─'.repeat(42)}`);
  if (!rows.length) {
    console.log('  아직 가입한 회원이 없어요. (게스트 플레이는 로컬 전용 — 서버 미기록)');
    return;
  }

  // 가입수단·활성·신규 집계
  const byProvider = {};
  let active = 0, recent = 0;
  for (const r of rows) {
    byProvider[r.provider || '(미상)'] = (byProvider[r.provider || '(미상)'] || 0) + 1;
    if (r.last_seen_at && Date.parse(r.last_seen_at) >= cutoffMs) active++;
    if (r.created_at && Date.parse(r.created_at) >= cutoffMs) recent++;
  }
  console.log(`  총 회원        ${num(rows.length).padStart(6, ' ')}`);
  for (const [p, n] of Object.entries(byProvider).sort((a, b) => b[1] - a[1])) {
    console.log(`    ├ ${String(p).padEnd(10, ' ')}${num(n).padStart(6, ' ')}`);
  }
  console.log(`  최근 ${DAYS}일 활성  ${num(active).padStart(6, ' ')}`);
  console.log(`  최근 ${DAYS}일 신규  ${num(recent).padStart(6, ' ')}`);

  // 모드별 최고점·플레이수 — 각 회원 game_data.best(JSON)를 파싱해 집계.
  const agg = {}; // gameKey → { max, plays, players }
  for (const r of rows) {
    let best = null;
    try { best = JSON.parse(r.game_data || '{}').best || {}; } catch { best = {}; }
    for (const [k, b] of Object.entries(best)) {
      if (!b) continue;
      const a = agg[k] || (agg[k] = { max: 0, plays: 0, players: 0 });
      a.max = Math.max(a.max, b.bestScore || 0);
      a.plays += b.playCount || 0;
      if ((b.bestScore || 0) > 0 || (b.playCount || 0) > 0) a.players++;
    }
  }
  const keys = Object.keys(agg).sort();
  if (keys.length) {
    console.log(`\n  모드별 (회원 기록 기준)`);
    console.log(`    ${'모드'.padEnd(12, ' ')}${'최고점'.padStart(8, ' ')}${'플레이'.padStart(8, ' ')}${'인원'.padStart(6, ' ')}`);
    for (const k of keys) {
      const a = agg[k];
      console.log(`    ${keyLabel(k).padEnd(12, ' ')}${num(a.max).padStart(8, ' ')}${num(a.plays).padStart(8, ' ')}${num(a.players).padStart(6, ' ')}`);
    }
  }
}

async function main() {
  console.log(`\n═══ 성조게임 지표 리포트 (최근 ${DAYS}일) ═══`);
  // 한쪽 실패가 다른 쪽을 막지 않게 개별 처리(권한 부분 누락 등).
  try { await funnelSection(); } catch (e) { console.error(`\n⚠️ 유입 깔때기 조회 실패: ${e.message}`); }
  try { await membersSection(); } catch (e) { console.error(`\n⚠️ 회원·점수 조회 실패: ${e.message}`); }
  console.log('');
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
