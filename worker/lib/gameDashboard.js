// 성조게임 지표 대시보드 — 순수 렌더/조립 모듈 (Node 스크립트 + Cloudflare Worker 공용).
// 데이터 fetch는 각 호출자(scripts/game-report.mjs = 토큰, worker = 토큰+D1바인딩)가 하고,
// 여기(assembleByDay/embedMembers/renderDashboard)는 순수 함수라 서버·워커 어디서든 동일 출력.
// 브라우저에서 실행되는 clientMain은 .toString()으로 직렬화해 <script>로 주입(여기선 실행 안 됨).

export const KEY_LABEL = { 'tone': '성조', 'tone-easy': '초급', 'tone-normal': '중급', 'tone-hard': '고급', 'tone-endless': '무한', 'tone-drama': '드라마', 'tone-travel': '여행', 'tone-slang': '신조어' };
export const MODE_LABEL = { easy: '초급', normal: '중급', hard: '고급', endless: '무한', practice: '연습', review: '복습', drama: '드라마', travel: '여행', slang: '신조어', exam: '시험' };
export const IDENT_LABEL = { guest: '게스트', member: '회원', student: '학생' };
export const CH_LABEL = { insta: '인스타', instagram: '인스타', youtube: '유튜브', yt: '유튜브', blog: '블로그', naver: '블로그' };
export const SRC_LABEL = { web: '웹', standalone: 'PWA', twa: '스토어앱', ios: 'iOS' };

const num = (x) => (Number(x) || 0).toLocaleString('ko-KR');

// AE SQL 결과(일별 그룹) 6종 → { days, byDay }. nowMs로 연속 일자 목록 생성.
// 각 rows: ev/ch/src/mp/id = {day,k,n} · ms = {day,k,sv,sn}
export function assembleByDay(sets, maxDays, nowMs) {
  const dk = (s) => String(s).slice(0, 10);
  const byDay = {};
  const ens = (d) => (byDay[d] || (byDay[d] = { ev: {}, ch: {}, src: {}, mode: {}, ident: {} }));
  for (const r of sets.ev || []) ens(dk(r.day)).ev[r.k] = Number(r.n) || 0;
  for (const r of sets.ch || []) if (r.k) ens(dk(r.day)).ch[r.k] = Number(r.n) || 0;
  for (const r of sets.src || []) ens(dk(r.day)).src[r.k || ''] = Number(r.n) || 0;
  for (const r of sets.mp || []) if (r.k) { const m = ens(dk(r.day)).mode; (m[r.k] || (m[r.k] = { plays: 0, sv: 0, sn: 0 })).plays = Number(r.n) || 0; }
  for (const r of sets.ms || []) if (r.k) { const m = ens(dk(r.day)).mode; const e = (m[r.k] || (m[r.k] = { plays: 0, sv: 0, sn: 0 })); e.sv = Number(r.sv) || 0; e.sn = Number(r.sn) || 0; }
  for (const r of sets.id || []) ens(dk(r.day)).ident[r.k || ''] = Number(r.n) || 0;
  const days = [];
  for (let i = maxDays - 1; i >= 0; i--) days.push(new Date(nowMs - i * 86400000).toISOString().slice(0, 10));
  return { days, byDay };
}

// D1 game_users 행 → 임베드용 회원 배열(PII 없음: provider·날짜·점수·성조·스트릭·XP만).
export function embedMembers(rows) {
  return rows.map((r) => {
    let gd = {};
    try { gd = JSON.parse(r.game_data || '{}'); } catch { gd = {}; }
    const best = {}, plays = {}, tone = {};
    for (const [k, b] of Object.entries(gd.best || {})) { if (!b) continue; best[k] = b.bestScore || 0; plays[k] = b.playCount || 0; }
    if (gd.tone) for (const t of [0, 1, 2, 3, 4]) { const e = gd.tone[t]; if (Array.isArray(e)) tone[t] = [e[0] || 0, e[1] || 0]; }
    return { provider: r.provider || '(미상)', created: (r.created_at || '').slice(0, 10), seen: (r.last_seen_at || '').slice(0, 10), best, plays, tone, streak: gd.streak?.longest || 0, xp: gd.xp || 0 };
  });
}

// ── 브라우저에서 실행되는 클라이언트 앱 (data는 DOM의 JSON에서 읽음) ──
function clientMain() {
  var D = JSON.parse(document.getElementById('gad').textContent);
  var L = D.labels, days = D.days, byDay = D.byDay, members = D.members;
  var lastDay = days[days.length - 1], firstDay = days[0];
  var $ = function (id) { return document.getElementById(id); };
  var num = function (x) { return (Number(x) || 0).toLocaleString('ko-KR'); };
  var pct = function (a, b) { return b > 0 ? ((a / b) * 100).toFixed(1) + '%' : '—'; };
  var lab = function (d, k) { return (d && d[k]) || k || '(미상)'; };
  var mmdd = function (s) { var p = s.split('-'); return (+p[1]) + '/' + (+p[2]); };

  var cum = (function () {
    var byProvider = {}, agg = {}, tone = { 0: [0, 0], 1: [0, 0], 2: [0, 0], 3: [0, 0], 4: [0, 0] }, sMax = 0, xpS = 0, cnt = 0;
    members.forEach(function (m) {
      byProvider[m.provider] = (byProvider[m.provider] || 0) + 1;
      Object.keys(m.best || {}).forEach(function (k) { var a = agg[k] || (agg[k] = { label: lab(L.key, k), max: 0, plays: 0 }); a.max = Math.max(a.max, m.best[k] || 0); a.plays += (m.plays && m.plays[k]) || 0; });
      if (m.tone) [0, 1, 2, 3, 4].forEach(function (t) { if (m.tone[t]) { tone[t][0] += m.tone[t][0]; tone[t][1] += m.tone[t][1]; } });
      sMax = Math.max(sMax, m.streak || 0); xpS += m.xp || 0; cnt++;
    });
    var toneAcc = [1, 2, 3, 4, 0].map(function (t) { return { label: t === 0 ? '경성' : t + '성', acc: tone[t][1] > 0 ? tone[t][0] / tone[t][1] : 0, attempts: tone[t][1] }; });
    return { total: members.length, byProvider: byProvider, modes: Object.keys(agg).map(function (k) { return agg[k]; }).sort(function (a, b) { return b.max - a.max; }), toneAcc: toneAcc, streakMax: sMax, xpAvg: cnt ? Math.round(xpS / cnt) : 0 };
  })();

  function sparkSvg(vals, color, id) {
    var w = 150, h = 40, n = vals.length, max = Math.max.apply(null, [1].concat(vals));
    var X = function (i) { return n <= 1 ? w / 2 : (i / (n - 1)) * w; };
    var Y = function (v) { return 4 + (h - 8) - (v / max) * (h - 8); };
    var pts = vals.map(function (v, i) { return [X(i), Y(v)]; });
    var line = 'M' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' L');
    var last = pts[pts.length - 1] || [w, h];
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"><defs><linearGradient id="sp' + id + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="' + color + '" stop-opacity=".32"/><stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs><path d="' + line + ' L' + w + ' ' + h + ' L0 ' + h + ' Z" fill="url(#sp' + id + ')"/><path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="1.8" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="2.4" fill="' + color + '"/></svg>';
  }
  function areaSvg(daily) {
    var W = 720, H = 230, pL = 34, pR = 18, pT = 18, pB = 30, iw = W - pL - pR, ih = H - pT - pB, n = daily.length;
    var maxRaw = Math.max.apply(null, [1].concat(daily.map(function (d) { return Math.max(d.enter, d.play); })));
    var st = Math.pow(10, Math.floor(Math.log(maxRaw) / Math.LN10)); var maxV = Math.ceil(maxRaw / st) * st;
    var X = function (i) { return pL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw); };
    var Y = function (v) { return pT + ih - (v / maxV) * ih; };
    var path = function (key) { return 'M' + daily.map(function (d, i) { return X(i).toFixed(1) + ' ' + Y(d[key]).toFixed(1); }).join(' L'); };
    var area = function (key) { return path(key) + ' L' + X(n - 1).toFixed(1) + ' ' + (pT + ih).toFixed(1) + ' L' + X(0).toFixed(1) + ' ' + (pT + ih).toFixed(1) + ' Z'; };
    var grid = [0, 0.25, 0.5, 0.75, 1].map(function (f) { var gy = pT + ih - f * ih; return '<line x1="' + pL + '" x2="' + (W - pR) + '" y1="' + gy.toFixed(1) + '" y2="' + gy.toFixed(1) + '" class="grid"/><text x="' + (pL - 6) + '" y="' + (gy + 3).toFixed(1) + '" class="ytick">' + Math.round(f * maxV) + '</text>'; }).join('');
    var step = Math.ceil(n / 8);
    var xlab = daily.map(function (d, i) { return (i % step === 0 || i === n - 1) ? '<text x="' + X(i).toFixed(1) + '" y="' + (H - 10) + '" class="xtick">' + d.label + '</text>' : ''; }).join('');
    var dot = function (key, c) { var i = n - 1; return '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(daily[i][key]).toFixed(1) + '" r="3.4" fill="' + c + '" stroke="var(--panel)" stroke-width="1.5"/>'; };
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart"><defs><linearGradient id="gE" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--cyan)" stop-opacity=".26"/><stop offset="1" stop-color="var(--cyan)" stop-opacity="0"/></linearGradient><linearGradient id="gP" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--brand)" stop-opacity=".22"/><stop offset="1" stop-color="var(--brand)" stop-opacity="0"/></linearGradient></defs>' + grid + '<path d="' + area('enter') + '" fill="url(#gE)"/><path d="' + area('play') + '" fill="url(#gP)"/><path d="' + path('enter') + '" fill="none" stroke="var(--cyan)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/><path d="' + path('play') + '" fill="none" stroke="var(--brand)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>' + dot('enter', 'var(--cyan)') + dot('play', 'var(--brand)') + xlab + '</svg>';
  }
  function donutSvg(segs, total) {
    var s = 132, cx = 66, cy = 66, r = 48, sw = 15, C = 2 * Math.PI * r, acc = 0;
    var arcs = segs.map(function (g) { var f = total > 0 ? g.value / total : 0, dash = f * C, off = -acc * C; acc += f; return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + g.color + '" stroke-width="' + sw + '" stroke-dasharray="' + dash.toFixed(2) + ' ' + (C - dash).toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>'; }).join('');
    return '<svg viewBox="0 0 ' + s + ' ' + s + '" class="donut"><circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="var(--line)" stroke-width="' + sw + '"/>' + arcs + '<text x="' + cx + '" y="' + (cy - 2) + '" class="donut-num">' + num(total) + '</text><text x="' + cx + '" y="' + (cy + 15) + '" class="donut-cap">회원</text></svg>';
  }
  function barList(items, color) {
    if (!items.length) return '<div class="empty">데이터 없음</div>';
    var max = Math.max.apply(null, [1].concat(items.map(function (i) { return i.value; })));
    return '<div class="ml">' + items.map(function (i) { return '<div class="mlrow"><div class="mllabel">' + i.label + '</div><div class="mltrack"><div class="mlbar" style="width:' + Math.max(4, (i.value / max) * 100).toFixed(1) + '%;background:' + color + '"></div></div><div class="mlval">' + num(i.value) + '</div></div>'; }).join('') + '</div>';
  }
  function modeBars(items) {
    if (!items.length) return '<div class="empty">데이터 없음</div>';
    var max = Math.max.apply(null, [1].concat(items.map(function (i) { return i.n; })));
    return '<div class="ml">' + items.map(function (i) { return '<div class="mlrow"><div class="mllabel">' + i.label + '</div><div class="mltrack"><div class="mlbar" style="width:' + Math.max(4, (i.n / max) * 100).toFixed(1) + '%"></div></div><div class="mlval">' + num(i.n) + '<span class="mlsub">평균 ' + num(i.avg) + '</span></div></div>'; }).join('') + '</div>';
  }
  function toneBars(acc) {
    if (!acc.some(function (t) { return t.attempts > 0; })) return '<div class="empty">아직 성조 데이터 없음</div>';
    return '<div class="ml">' + acc.map(function (t) { var c = t.acc >= 0.8 ? 'var(--green)' : t.acc >= 0.6 ? 'var(--amber)' : 'var(--crit)'; return '<div class="mlrow"><div class="mllabel">' + t.label + '</div><div class="mltrack"><div class="mlbar" style="width:' + Math.max(4, t.acc * 100).toFixed(1) + '%;background:' + c + '"></div></div><div class="mlval">' + Math.round(t.acc * 100) + '%<span class="mlsub">' + num(t.attempts) + '회</span></div></div>'; }).join('') + '</div>';
  }
  function trendChip(cur, prev) {
    if (prev == null) return '';
    var d = cur - prev; if (d === 0) return '<span class="chip-tr flat">— 0</span>';
    var up = d > 0, rate = prev > 0 ? Math.round((d / prev) * 100) : 100;
    return '<span class="chip-tr ' + (up ? 'up' : 'down') + '">' + (up ? '▲' : '▼') + ' ' + Math.abs(rate) + '%</span>';
  }
  function kpi(label, value, spark, chip, sub) { return '<div class="kpi"><div class="kpi-top"><span class="kpi-label">' + label + '</span>' + (chip || '') + '</div><div class="kpi-num">' + value + '</div>' + (spark ? '<div class="kpi-spark">' + spark + '</div>' : '<div class="kpi-sub">' + (sub || '') + '</div>') + '</div>'; }

  function agg(start, end) {
    var sel = days.filter(function (d) { return d >= start && d <= end; });
    var ev = {}, ch = {}, src = {}, mode = {}, ident = {}, daily = [];
    sel.forEach(function (d) {
      var b = byDay[d], dd = { label: mmdd(d), enter: 0, play: 0 };
      if (b) {
        Object.keys(b.ev).forEach(function (k) { ev[k] = (ev[k] || 0) + b.ev[k]; });
        dd.enter = b.ev.enter || 0; dd.play = b.ev.run_start || 0;
        Object.keys(b.ch).forEach(function (k) { ch[k] = (ch[k] || 0) + b.ch[k]; });
        Object.keys(b.src).forEach(function (k) { src[k] = (src[k] || 0) + b.src[k]; });
        Object.keys(b.ident).forEach(function (k) { ident[k] = (ident[k] || 0) + b.ident[k]; });
        Object.keys(b.mode).forEach(function (k) { var e = b.mode[k], t = mode[k] || (mode[k] = { plays: 0, sv: 0, sn: 0 }); t.plays += e.plays || 0; t.sv += e.sv || 0; t.sn += e.sn || 0; });
      }
      daily.push(dd);
    });
    var active = members.filter(function (m) { return m.seen && m.seen >= start && m.seen <= end; }).length;
    var nw = members.filter(function (m) { return m.created && m.created >= start && m.created <= end; }).length;
    return { ev: ev, ch: ch, src: src, mode: mode, ident: ident, daily: daily, active: active, nw: nw, ndays: sel.length };
  }

  function render(start, end) {
    var a = agg(start, end), e = a.ev, enter = e.enter || 0, rs = e.run_start || 0, re = e.run_end || 0;
    $('rangelabel').textContent = start + ' ~ ' + end + ' · ' + a.ndays + '일';
    var enS = a.daily.map(function (d) { return d.enter; }), plS = a.daily.map(function (d) { return d.play; });
    var t2 = function (arr) { return arr.length >= 2 ? [arr[arr.length - 1], arr[arr.length - 2]] : [arr[0], null]; };
    $('kpis').innerHTML =
      kpi('진입', num(enter), sparkSvg(enS, '#39d0d8', 'e'), trendChip.apply(null, t2(enS))) +
      kpi('판 시작', num(rs), sparkSvg(plS, '#4c8dff', 'p'), trendChip.apply(null, t2(plS))) +
      kpi('완주율', pct(re, rs), '', '', '판 종료 ' + num(re) + ' / 시작 ' + num(rs)) +
      kpi('활성 회원', num(a.active), '', '', '신규 ' + num(a.nw) + '명');
    $('chart').innerHTML = enter || rs ? areaSvg(a.daily) : '<div class="empty">이 기간에 데이터 없음</div>';
    var steps = [['진입', enter, null], ['온보딩 완료', e.onboarding_done || 0, enter], ['로그인', e.login_success || 0, enter], ['판 시작', rs, enter], ['판 종료', re, rs], ['CTA 클릭', e.cta_play_link || 0, enter]];
    $('funnel').innerHTML = enter ? '<div class="funnel">' + steps.map(function (s) { var w = enter > 0 ? Math.max(3, (s[1] / enter) * 100) : 3; return '<div class="frow"><div class="flabel">' + s[0] + '</div><div class="ftrack"><div class="fbar" style="width:' + w.toFixed(1) + '%"></div></div><div class="fnum">' + num(s[1]) + (s[2] != null ? '<span class="frate">' + pct(s[1], s[2]) + '</span>' : '') + '</div></div>'; }).join('') + '</div><div class="hl">진입 → CTA <b>' + pct(e.cta_play_link || 0, enter) + '</b></div>' : '<div class="empty">데이터 없음</div>';
    var toItems = function (obj, dict) { return Object.keys(obj).filter(function (k) { return k !== ''; }).map(function (k) { return { label: lab(dict, k), value: obj[k] }; }).sort(function (x, y) { return y.value - x.value; }); };
    $('ch').innerHTML = Object.keys(a.ch).length ? barList(toItems(a.ch, L.ch), 'var(--pink)') : '<div class="empty">아직 CTA 클릭 없음</div>';
    $('src').innerHTML = barList(toItems(a.src, L.src), 'var(--cyan)');
    $('ident').innerHTML = barList(toItems(a.ident, L.ident), 'var(--violet)');
    var mp = Object.keys(a.mode).map(function (k) { var m = a.mode[k]; return { label: lab(L.mode, k), n: m.plays, avg: m.sn > 0 ? Math.round(m.sv / m.sn) : 0 }; }).sort(function (x, y) { return y.n - x.n; });
    $('modeplay').innerHTML = modeBars(mp);
    var pcol = { kakao: '#f7c948', google: '#4c8dff', '(미상)': '#8b98a8' };
    var segs = Object.keys(cum.byProvider).map(function (p) { return { label: p, value: cum.byProvider[p], color: pcol[p] || '#a371f7' }; }).sort(function (x, y) { return y.value - x.value; });
    $('prov').innerHTML = cum.total ? '<div class="prov"><div class="prov-donut">' + donutSvg(segs, cum.total) + '</div><div class="prov-list">' +
      segs.map(function (s) { return '<div class="prow"><span class="pdot" style="background:' + s.color + '"></span><span class="pname">' + s.label + '</span><span class="pval">' + num(s.value) + '</span></div>'; }).join('') +
      '<div class="prow sep"><span class="pname dim">활성 · 기간</span><span class="pval">' + num(a.active) + '</span></div><div class="prow"><span class="pname dim">신규 · 기간</span><span class="pval">' + num(a.nw) + '</span></div><div class="prow"><span class="pname dim">최고 스트릭</span><span class="pval">' + num(cum.streakMax) + '일</span></div><div class="prow"><span class="pname dim">평균 XP</span><span class="pval">' + num(cum.xpAvg) + '</span></div></div></div>' : '<div class="empty">회원 없음</div>';
  }

  $('tone').innerHTML = toneBars(cum.toneAcc);
  (function () {
    if (!cum.modes.length) { $('modebest').innerHTML = '<div class="empty">회원 기록 없음</div>'; return; }
    var mx = Math.max.apply(null, [1].concat(cum.modes.map(function (m) { return m.max; })));
    $('modebest').innerHTML = '<div class="lb">' + cum.modes.map(function (m, i) { var w = Math.max(6, (m.max / mx) * 100); return '<div class="lbrow"><div class="lbrank">' + (i + 1) + '</div><div class="lbmode">' + m.label + '</div><div class="lbtrack"><div class="lbbar" style="width:' + w.toFixed(1) + '%"></div></div><div class="lbval">' + num(m.max) + '<span class="lbsub">' + num(m.plays) + '판</span></div></div>'; }).join('') + '</div>';
  })();

  function preset(n) { var start = days[Math.max(0, days.length - n)]; $('d1').value = start; $('d2').value = lastDay; mark(n); render(start, lastDay); }
  function mark(n) { Array.prototype.forEach.call(document.querySelectorAll('.seg'), function (b) { b.classList.toggle('on', +b.dataset.n === n); }); }
  function custom() { mark(0); var s = $('d1').value || firstDay, e = $('d2').value || lastDay; if (s > e) { var t = s; s = e; e = t; } render(s, e); }
  $('d1').min = firstDay; $('d1').max = lastDay; $('d2').min = firstDay; $('d2').max = lastDay;
  Array.prototype.forEach.call(document.querySelectorAll('.seg'), function (b) { b.addEventListener('click', function () { preset(+b.dataset.n); }); });
  $('d1').addEventListener('change', custom); $('d2').addEventListener('change', custom);
  preset(7);
}

export const DASH_CSS = `
  html,body{background:#0d1117;margin:0}
  .ga{--bg:#0d1117;--panel:#151b24;--panel2:#10151c;--line:#232c39;--ink:#e7edf4;--muted:#8b98a8;--dim:#5c6673;--brand:#4c8dff;--cyan:#39d0d8;--violet:#a371f7;--green:#3fb950;--amber:#e3b341;--pink:#f778ba;--crit:#f85149;--mono:ui-monospace,'SF Mono','Cascadia Code',Menlo,monospace;
    background:var(--bg);color:var(--ink);font-family:'Inter',system-ui,-apple-system,'Segoe UI','Apple SD Gothic Neo','Malgun Gothic',sans-serif;line-height:1.45;min-height:100vh;padding:26px 22px 48px;max-width:1080px;margin:0 auto;-webkit-font-smoothing:antialiased}
  .ga *{box-sizing:border-box}
  .topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:14px}
  .brand{display:flex;align-items:center;gap:11px}
  .logo{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,var(--brand),var(--cyan));display:grid;place-items:center;flex:none;box-shadow:0 2px 10px #4c8dff44}
  .logo svg{width:20px;height:20px}
  .brand h1{font-size:16px;font-weight:700;margin:0;letter-spacing:-.01em}.brand .sub{font-size:11.5px;color:var(--muted);margin-top:1px}
  .controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .seg-group{display:flex;background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:3px}
  .seg{background:none;border:0;color:var(--muted);font:inherit;font-size:12px;font-weight:600;padding:5px 11px;border-radius:6px;cursor:pointer}
  .seg.on{background:var(--brand);color:#fff}
  .dates{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--muted)}
  .dates input{background:var(--panel);border:1px solid var(--line);color:var(--ink);border-radius:7px;padding:5px 8px;font:inherit;font-size:11.5px;color-scheme:dark}
  .rangelabel{font-family:var(--mono);font-size:11.5px;color:var(--dim);margin-bottom:14px}
  .note{display:flex;gap:9px;align-items:center;background:#e3b3410f;border:1px solid #e3b34133;color:#e9c877;border-radius:10px;padding:9px 13px;font-size:12.5px;margin-bottom:16px}
  .note b{color:#f0d68a}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:13px;margin-bottom:14px}
  .grid2{display:grid;grid-template-columns:1.9fr 1.1fr;gap:13px;margin-bottom:14px}
  .grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:13px;margin-bottom:14px}
  .grid2b{display:grid;grid-template-columns:1.35fr 1fr;gap:13px;margin-bottom:14px}
  @media (max-width:820px){.kpis{grid-template-columns:repeat(2,1fr)}.grid2,.grid2b,.grid3{grid-template-columns:1fr}}
  @media (max-width:460px){.kpis{grid-template-columns:1fr}}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:15px;padding:17px 18px}
  .panel-h{display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:700;margin-bottom:14px;letter-spacing:-.01em}
  .panel-h .tag{font-size:11px;color:var(--dim);font-weight:500;font-family:var(--mono)}
  .legend{display:flex;gap:13px;font-size:11.5px;color:var(--muted);font-weight:500}.legend .lg{display:flex;align-items:center;gap:6px}.legend i{width:10px;height:3px;border-radius:2px;display:inline-block}
  .empty{color:var(--dim);font-size:12.5px;padding:22px 4px;text-align:center;line-height:1.6}
  .kpi{background:var(--panel);border:1px solid var(--line);border-radius:15px;padding:15px 16px 13px;min-height:118px;display:flex;flex-direction:column}
  .kpi-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .kpi-label{font-size:11px;color:var(--muted);font-weight:600;letter-spacing:.03em;text-transform:uppercase}
  .kpi-num{font-family:var(--mono);font-size:32px;font-weight:600;letter-spacing:-.02em;margin-top:5px;font-variant-numeric:tabular-nums}
  .kpi-spark{margin-top:auto;height:40px}.kpi-sub{margin-top:auto;font-size:11.5px;color:var(--muted);padding-top:6px}
  .spark{width:100%;height:40px;display:block}
  .chip-tr{font-family:var(--mono);font-size:11px;font-weight:600;padding:2px 7px;border-radius:6px}
  .chip-tr.up{color:var(--green);background:#3fb95018}.chip-tr.down{color:var(--crit);background:#f8514918}.chip-tr.flat{color:var(--dim);background:#8b98a814}
  .chart{width:100%;height:auto;min-width:420px;display:block}
  .chart-wrap{width:100%;overflow-x:auto}
  .chart .grid{stroke:var(--line);stroke-width:1}.chart .ytick{fill:var(--dim);font-size:10px;text-anchor:end;font-family:var(--mono)}.chart .xtick{fill:var(--muted);font-size:10px;text-anchor:middle;font-family:var(--mono)}
  .funnel{display:flex;flex-direction:column;gap:10px}
  .frow{display:grid;grid-template-columns:70px 1fr auto;align-items:center;gap:11px}
  .flabel{font-size:12px;color:var(--muted);font-weight:600}
  .ftrack{background:#4c8dff14;border-radius:6px;height:24px;overflow:hidden}.fbar{height:100%;background:linear-gradient(90deg,var(--brand),var(--cyan));border-radius:6px;min-width:3px}
  .fnum{font-family:var(--mono);font-size:12.5px;text-align:right;font-variant-numeric:tabular-nums;min-width:66px}.frate{color:var(--muted);margin-left:6px;font-size:11px}
  .hl{margin-top:14px;padding-top:12px;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted);text-align:right}.hl b{font-family:var(--mono);color:var(--cyan);font-size:16px;margin-left:5px}
  .ml{display:flex;flex-direction:column;gap:9px}
  .mlrow{display:grid;grid-template-columns:56px 1fr auto;align-items:center;gap:10px}
  .mllabel{font-size:12px;color:var(--muted);font-weight:600;white-space:nowrap}
  .mltrack{background:#ffffff0d;border-radius:5px;height:18px;overflow:hidden}.mlbar{height:100%;border-radius:5px;min-width:4px;background:var(--brand)}
  .mlval{font-family:var(--mono);font-size:12.5px;text-align:right;font-variant-numeric:tabular-nums;min-width:52px}.mlval .mlsub{display:block;font-size:10px;color:var(--dim);font-weight:400}
  .lb{display:flex;flex-direction:column;gap:9px}
  .lbrow{display:grid;grid-template-columns:20px 52px 1fr auto;align-items:center;gap:10px}
  .lbrank{font-family:var(--mono);font-size:11px;color:var(--dim);text-align:center}.lbmode{font-size:12.5px;font-weight:700}
  .lbtrack{background:#e3b34114;border-radius:5px;height:16px;overflow:hidden}.lbbar{height:100%;background:linear-gradient(90deg,var(--amber),#f0c869);border-radius:5px}
  .lbval{font-family:var(--mono);font-size:12.5px;text-align:right;font-variant-numeric:tabular-nums}.lbval .lbsub{display:block;font-size:10px;color:var(--dim);font-weight:400}
  .prov{display:flex;align-items:center;gap:18px}.prov-donut{flex:none}.donut{width:118px;height:118px}
  .donut-num{fill:var(--ink);font-family:var(--mono);font-size:24px;font-weight:600;text-anchor:middle;font-variant-numeric:tabular-nums}.donut-cap{fill:var(--muted);font-size:10px;text-anchor:middle;text-transform:uppercase;letter-spacing:.08em}
  .prov-list{flex:1;display:flex;flex-direction:column;gap:8px}
  .prow{display:flex;align-items:center;gap:9px;font-size:12.5px}.prow.sep{border-top:1px solid var(--line);padding-top:9px;margin-top:3px}
  .pdot{width:9px;height:9px;border-radius:50%;flex:none}.pname{flex:1}.pname.dim{color:var(--muted)}.pval{font-family:var(--mono);font-variant-numeric:tabular-nums}
  .foot{margin-top:22px;padding-top:15px;border-top:1px solid var(--line);font-size:11.5px;color:var(--dim);line-height:1.8}
  .foot code{font-family:var(--mono);color:var(--muted);background:var(--panel2);padding:1px 6px;border-radius:5px;font-size:11px}
  @media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

// 데이터 → 대시보드 body HTML(문자열). 순수 함수.
export function renderDashboard({ byDay, days, members, maxDays, generatedAt, source = 'node scripts/game-report.mjs --html' }) {
  const payload = { maxDays, generatedAt, days, byDay, members, labels: { key: KEY_LABEL, mode: MODE_LABEL, ident: IDENT_LABEL, ch: CH_LABEL, src: SRC_LABEL } };
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  return `<style>${DASH_CSS}</style>
<div class="ga">
  <div class="topbar">
    <div class="brand">
      <div class="logo"><svg viewBox="0 0 24 24" fill="none"><path d="M3 15 C7 15 8 8 12 8 C16 8 17 16 21 16" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <div><h1>성조게임 Analytics</h1><div class="sub">Cloudflare Analytics Engine · D1</div></div>
    </div>
    <div class="controls">
      <div class="seg-group"><button class="seg" data-n="7">7일</button><button class="seg" data-n="14">14일</button><button class="seg" data-n="30">30일</button></div>
      <div class="dates"><input type="date" id="d1"><span>~</span><input type="date" id="d2"></div>
    </div>
  </div>
  <div class="rangelabel" id="rangelabel"></div>

  <div class="note"><span>⚠️</span><div><b>미공개 테스트 데이터</b> — 출시 전 트래픽이에요. 회원 <b>최고점·성조정확도</b>는 누적 현재값이라 기간 필터에 반응하지 않습니다(유입·퍼널·모드·활성/신규는 기간 반영).</div></div>

  <div class="kpis" id="kpis"></div>
  <div class="grid2">
    <div class="panel"><div class="panel-h"><span>일자별 활동</span><div class="legend"><span class="lg"><i style="background:var(--cyan)"></i>진입</span><span class="lg"><i style="background:var(--brand)"></i>판 시작</span></div></div><div class="chart-wrap" id="chart"></div></div>
    <div class="panel"><div class="panel-h"><span>유입 퍼널</span></div><div id="funnel"></div></div>
  </div>
  <div class="grid3">
    <div class="panel"><div class="panel-h"><span>채널별 CTA</span><span class="tag">유입 출구</span></div><div id="ch"></div></div>
    <div class="panel"><div class="panel-h"><span>유입 소스</span></div><div id="src"></div></div>
    <div class="panel"><div class="panel-h"><span>게스트 vs 회원</span><span class="tag">플레이</span></div><div id="ident"></div></div>
  </div>
  <div class="grid2b">
    <div class="panel"><div class="panel-h"><span>모드별 플레이 · 평균점수</span><span class="tag">전체</span></div><div id="modeplay"></div></div>
    <div class="panel"><div class="panel-h"><span>성조별 정확도</span><span class="tag">누적 · 회원</span></div><div id="tone"></div></div>
  </div>
  <div class="grid2b">
    <div class="panel"><div class="panel-h"><span>모드별 최고점</span><span class="tag">누적 · 회원</span></div><div id="modebest"></div></div>
    <div class="panel"><div class="panel-h"><span>가입 수단 · 학습</span></div><div id="prov"></div></div>
  </div>

  <div class="foot">게임은 Notion과 완전 분리 — 지표는 Analytics Engine(유입·시계열) + D1(회원·점수)에서만.<br>최근 ${maxDays}일 원본 내장 · ${source} · 생성 ${generatedAt}</div>
</div>
<script id="gad" type="application/json">${json}</script>
<script>(${clientMain.toString()})();</script>`;
}
