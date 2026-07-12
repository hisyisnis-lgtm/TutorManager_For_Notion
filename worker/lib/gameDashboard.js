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
    return { nickname: r.nickname || '', provider: r.provider || '(미상)', created: (r.created_at || '').slice(0, 10), seen: (r.last_seen_at || '').slice(0, 10), best, plays, tone, streak: gd.streak?.longest || 0, xp: gd.xp || 0 };
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
  // 닉네임은 사용자 입력 → innerHTML 삽입 전 반드시 이스케이프(저장형 XSS 방지).
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

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
  var CH = { W: 720, H: 230, pL: 34, pR: 18, pT: 18, pB: 30 };
  function chartGeom(daily) {
    var iw = CH.W - CH.pL - CH.pR, ih = CH.H - CH.pT - CH.pB, n = daily.length;
    var maxRaw = Math.max.apply(null, [1].concat(daily.map(function (d) { return Math.max(d.enter, d.play); })));
    var st = Math.pow(10, Math.floor(Math.log(maxRaw) / Math.LN10)); var maxV = Math.ceil(maxRaw / st) * st;
    return { iw: iw, ih: ih, n: n, maxV: maxV,
      X: function (i) { return CH.pL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw); },
      Y: function (v) { return CH.pT + ih - (v / maxV) * ih; } };
  }
  function areaSvg(daily) {
    var g = chartGeom(daily), n = g.n, X = g.X, Y = g.Y, base = (CH.pT + g.ih).toFixed(1);
    var path = function (key) { return 'M' + daily.map(function (d, i) { return X(i).toFixed(1) + ' ' + Y(d[key]).toFixed(1); }).join(' L'); };
    var area = function (key) { return path(key) + ' L' + X(n - 1).toFixed(1) + ' ' + base + ' L' + X(0).toFixed(1) + ' ' + base + ' Z'; };
    var grid = [0, 0.25, 0.5, 0.75, 1].map(function (f) { var gy = CH.pT + g.ih - f * g.ih; return '<line x1="' + CH.pL + '" x2="' + (CH.W - CH.pR) + '" y1="' + gy.toFixed(1) + '" y2="' + gy.toFixed(1) + '" class="grid"/><text x="' + (CH.pL - 6) + '" y="' + (gy + 3).toFixed(1) + '" class="ytick">' + Math.round(f * g.maxV) + '</text>'; }).join('');
    var step = Math.ceil(n / 8);
    var xlab = daily.map(function (d, i) { return (i % step === 0 || i === n - 1) ? '<text x="' + X(i).toFixed(1) + '" y="' + (CH.H - 10) + '" class="xtick">' + d.label + '</text>' : ''; }).join('');
    var dot = function (key, c) { var i = n - 1; return '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(daily[i][key]).toFixed(1) + '" r="3.4" fill="' + c + '" stroke="var(--panel)" stroke-width="1.5"/>'; };
    // 호버/터치 인터랙션용(기본 숨김): 크로스헤어·강조점·투명 히트영역
    var inter = '<line class="cross" y1="' + CH.pT + '" y2="' + base + '" style="display:none"/><circle class="hdot he" r="4.2" fill="var(--cyan)" style="display:none"/><circle class="hdot hp" r="4.2" fill="var(--brand)" style="display:none"/><rect class="hit" x="' + CH.pL + '" y="' + CH.pT + '" width="' + g.iw + '" height="' + g.ih + '" fill="transparent"/>';
    return '<svg viewBox="0 0 ' + CH.W + ' ' + CH.H + '" class="chart"><defs><linearGradient id="gE" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--cyan)" stop-opacity=".26"/><stop offset="1" stop-color="var(--cyan)" stop-opacity="0"/></linearGradient><linearGradient id="gP" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--brand)" stop-opacity=".22"/><stop offset="1" stop-color="var(--brand)" stop-opacity="0"/></linearGradient></defs>' + grid + '<path d="' + area('enter') + '" fill="url(#gE)"/><path d="' + area('play') + '" fill="url(#gP)"/><path d="' + path('enter') + '" fill="none" stroke="var(--cyan)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/><path d="' + path('play') + '" fill="none" stroke="var(--brand)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>' + dot('enter', 'var(--cyan)') + dot('play', 'var(--brand)') + xlab + inter + '</svg>';
  }
  // 차트 렌더 후 호출 — 마우스 호버/터치 드래그로 가장 가까운 날짜의 수치를 툴팁으로 표시.
  function wireChart(daily) {
    var host = $('chart'), svg = host.querySelector('svg'); if (!svg) return;
    var outer = host.parentNode, tip = $('chartTip'), g = chartGeom(daily), n = g.n;
    var cross = svg.querySelector('.cross'), he = svg.querySelector('.he'), hp = svg.querySelector('.hp'), hit = svg.querySelector('.hit');
    function show(clientX) {
      var r = svg.getBoundingClientRect(); if (!r.width) return;
      var i = Math.round((((clientX - r.left) / r.width * CH.W) - CH.pL) / g.iw * (n - 1));
      if (i < 0) i = 0; if (i > n - 1) i = n - 1;
      var x = g.X(i), ye = g.Y(daily[i].enter), yp = g.Y(daily[i].play);
      cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.style.display = '';
      he.setAttribute('cx', x); he.setAttribute('cy', ye); he.style.display = '';
      hp.setAttribute('cx', x); hp.setAttribute('cy', yp); hp.style.display = '';
      tip.innerHTML = '<b>' + daily[i].label + '</b><span><i class="tc"></i>진입 ' + num(daily[i].enter) + '</span><span><i class="tp"></i>판 시작 ' + num(daily[i].play) + '</span>';
      tip.style.display = 'block';
      var oR = outer.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
      var left = (r.left - oR.left) + x / CH.W * r.width - tw / 2;
      if (left < 2) left = 2; if (left + tw > outer.clientWidth) left = outer.clientWidth - tw - 2;
      var top = (r.top - oR.top) + Math.min(ye, yp) / CH.H * r.height - th - 10;
      if (top < 0) top = 0;
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
    }
    function hide() { cross.style.display = 'none'; he.style.display = 'none'; hp.style.display = 'none'; tip.style.display = 'none'; }
    hit.addEventListener('pointerdown', function (e) { show(e.clientX); });
    hit.addEventListener('pointermove', function (e) { show(e.clientX); });
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('pointercancel', hide);
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
  function kpi(label, value, spark, chip, sub, more) { return '<div class="kpi"><div class="kpi-top"><span class="kpi-label">' + label + '</span>' + (chip || '') + '</div><div class="kpi-num">' + value + '</div>' + (spark ? '<div class="kpi-spark">' + spark + '</div>' : '<div class="kpi-sub">' + (sub || '') + (more ? '<button class="kpi-more" id="' + more + '">자세히 ›</button>' : '') + '</div>') + '</div>'; }

  // ── 회원: '활성 회원' 카드의 '자세히' → 목록 모달 → 회원 눌러 개별 상세(‹ 로 목록 복귀) ──
  var curStart = '', curEnd = '', activeList = [];
  function memRow(m, idx) {
    var pcol = { kakao: '#f7c948', google: '#4c8dff' };
    var top = Math.max.apply(null, [0].concat(Object.keys(m.best || {}).map(function (k) { return m.best[k] || 0; })));
    var nm = m.nickname && m.nickname.trim() ? esc(m.nickname) : '<span class="dim">(이름없음)</span>';
    return '<div class="memrow clk" data-i="' + idx + '"><span class="mdot" style="background:' + (pcol[m.provider] || '#8b98a8') + '"></span><span class="mname">' + nm + '</span><span class="mseen">' + (m.seen || '—') + '</span><span class="mtop">' + num(top) + '</span><span class="mchev">›</span></div>';
  }
  function showActiveList() {
    activeList = members.filter(function (m) { return m.seen && m.seen >= curStart && m.seen <= curEnd; }).sort(function (a, b) { return (b.seen || '').localeCompare(a.seen || ''); });
    var body = activeList.length ? '<div class="mem">' + activeList.map(function (m, i) { return memRow(m, i); }).join('') + '</div>' : '<div class="empty">이 기간에 접속한 회원이 없어요.</div>';
    $('memModalCard').innerHTML = '<div class="mm-head"><span class="mm-title">활성 회원 · ' + num(activeList.length) + '명</span><button class="mm-x" id="mmX" aria-label="닫기">✕</button></div><div class="mm-meta">' + curStart + ' ~ ' + curEnd + ' 접속 · 눌러서 상세</div>' + body;
    $('memModal').classList.add('open');
    document.getElementById('mmX').addEventListener('click', closeMember);
  }
  // 회원 개별 상세 — 전체 정보(가입·접속·모드별 최고점/플레이·성조 정확도·스트릭·XP). ‹ 로 목록 복귀.
  function openMember(m) {
    if (!m) return;
    var pcol = { kakao: '#f7c948', google: '#4c8dff' };
    var nm = m.nickname && m.nickname.trim() ? esc(m.nickname) : '(이름없음)';
    var totalPlays = Object.keys(m.plays || {}).reduce(function (s, k) { return s + (m.plays[k] || 0); }, 0);
    var modeRows = Object.keys(m.best || {}).map(function (k) { return { label: lab(L.key, k), best: m.best[k] || 0, plays: (m.plays && m.plays[k]) || 0 }; }).sort(function (a, b) { return b.best - a.best; });
    var toneAcc = [1, 2, 3, 4, 0].map(function (t) { var e = m.tone && m.tone[t]; var c = e ? e[0] : 0, a = e ? e[1] : 0; return { label: t === 0 ? '경성' : t + '성', acc: a > 0 ? c / a : 0, attempts: a }; });
    var modeTbl = modeRows.length ? '<table class="mm-tbl"><thead><tr><th>모드</th><th class="r">최고점</th><th class="r">플레이</th></tr></thead><tbody>' + modeRows.map(function (r) { return '<tr><td>' + r.label + '</td><td class="r">' + num(r.best) + '</td><td class="r">' + num(r.plays) + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">아직 기록 없음</div>';
    $('memModalCard').innerHTML = '<div class="mm-head"><span class="mm-title"><button class="mm-back" id="mmBack" aria-label="목록">‹</button><span class="mdot" style="background:' + (pcol[m.provider] || '#8b98a8') + '"></span>' + nm + '</span><button class="mm-x" id="mmX" aria-label="닫기">✕</button></div>'
      + '<div class="mm-meta">' + esc(m.provider) + ' · 가입 ' + (m.created || '—') + ' · 최근접속 ' + (m.seen || '—') + '</div>'
      + '<div class="mm-stats"><div class="mm-st"><span>최고 스트릭</span><b>' + num(m.streak) + '일</b></div><div class="mm-st"><span>누적 XP</span><b>' + num(m.xp) + '</b></div><div class="mm-st"><span>총 플레이</span><b>' + num(totalPlays) + '</b></div></div>'
      + '<div class="mm-sec">모드별 최고점</div>' + modeTbl
      + '<div class="mm-sec">성조별 정확도</div>' + toneBars(toneAcc);
    $('memModal').classList.add('open');
    document.getElementById('mmX').addEventListener('click', closeMember);
    document.getElementById('mmBack').addEventListener('click', showActiveList);
  }
  function closeMember() { $('memModal').classList.remove('open'); }

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
      kpi('활성 회원', num(a.active), '', '', '신규 ' + num(a.nw) + '명', 'activeMore');
    curStart = start; curEnd = end;
    var _am = $('activeMore'); if (_am) _am.addEventListener('click', showActiveList);
    if (enter || rs) { $('chart').innerHTML = areaSvg(a.daily); wireChart(a.daily); } else { $('chart').innerHTML = '<div class="empty">이 기간에 데이터 없음</div>'; }
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
  // 회원 '자세히' 클릭 → 상세 모달. 목록은 렌더마다 갱신되므로 이벤트 위임(한 번만 바인딩).
  $('memModalCard').addEventListener('click', function (e) { var r = e.target.closest && e.target.closest('.memrow.clk'); if (r) openMember(activeList[+r.getAttribute('data-i')]); });
  $('memModal').addEventListener('click', function (e) { if (e.target === $('memModal')) closeMember(); });
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
  .chart-outer{position:relative}
  .hit{touch-action:none;cursor:crosshair}
  .cross{stroke:var(--muted);stroke-width:1;stroke-dasharray:3 3;pointer-events:none}
  .hdot{pointer-events:none;stroke:var(--panel);stroke-width:1.5}
  .chart-tip{position:absolute;display:none;pointer-events:none;z-index:5;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-size:11.5px;box-shadow:0 4px 16px #000a;white-space:nowrap}
  .chart-tip b{display:block;font-family:var(--mono);color:var(--ink);font-size:11px;margin-bottom:4px}
  .chart-tip span{display:flex;align-items:center;gap:6px;color:var(--muted);font-family:var(--mono);line-height:1.7}
  .chart-tip i{width:8px;height:8px;border-radius:2px;display:inline-block}
  .chart-tip .tc{background:var(--cyan)}.chart-tip .tp{background:var(--brand)}
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
  .memberpanel{margin-bottom:14px}
  .mem{display:flex;flex-direction:column}
  .memrow{display:flex;align-items:center;gap:9px;padding:8px 2px;border-bottom:1px solid var(--line);font-size:12.5px}
  .memrow:last-child{border-bottom:none}
  .mdot{width:9px;height:9px;border-radius:50%;flex:none}
  .mname{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .mname .dim{color:var(--dim);font-weight:400}
  .mact{font-size:10px;font-weight:700;color:var(--green);background:#3fb95018;border-radius:5px;padding:2px 7px;flex:none}
  .mseen{font-family:var(--mono);font-size:11px;color:var(--muted);min-width:58px;text-align:right;flex:none}
  .mtop{font-family:var(--mono);font-size:12px;color:var(--ink);min-width:56px;text-align:right;flex:none;font-variant-numeric:tabular-nums}
  .mdetail{background:var(--panel2);border:1px solid var(--line);color:var(--muted);font:inherit;font-size:11px;font-weight:600;padding:3px 9px;border-radius:6px;cursor:pointer;flex:none}
  .mdetail:hover{color:var(--ink);border-color:var(--brand)}
  .kpi-more{background:none;border:0;color:var(--brand);font:inherit;font-size:11px;font-weight:600;cursor:pointer;padding:0;margin-left:6px}
  .kpi-more:hover{text-decoration:underline}
  .memrow.clk{cursor:pointer;border-radius:8px;margin:0 -6px;padding-left:8px;padding-right:8px}
  .memrow.clk:hover{background:var(--panel2)}
  .mchev{color:var(--dim);font-size:16px;flex:none}
  .mm-back{background:none;border:0;color:var(--brand);font-size:20px;cursor:pointer;padding:0 4px 0 0;line-height:1}
  .mm-back:hover{color:var(--ink)}
  .modal{position:fixed;inset:0;background:#000a;display:none;align-items:center;justify-content:center;z-index:100;padding:18px}
  .modal.open{display:flex}
  .modal-card{background:var(--panel);border:1px solid var(--line);border-radius:16px;max-width:440px;width:100%;max-height:88vh;overflow-y:auto;padding:20px;box-shadow:0 16px 48px #000b}
  .mm-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px}
  .mm-title{display:flex;align-items:center;gap:9px;font-size:16px;font-weight:700}
  .mm-x{background:none;border:0;color:var(--muted);font-size:17px;cursor:pointer;line-height:1;padding:4px 6px;border-radius:6px}
  .mm-x:hover{color:var(--ink);background:var(--panel2)}
  .mm-meta{font-size:12px;color:var(--muted);font-family:var(--mono);margin-bottom:16px}
  .mm-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:6px}
  .mm-st{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
  .mm-st span{display:block;font-size:11px;color:var(--muted);margin-bottom:2px}
  .mm-st b{font-family:var(--mono);font-size:18px;font-variant-numeric:tabular-nums}
  .mm-sec{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.03em;font-weight:600;margin:16px 0 8px}
  .mm-tbl{width:100%;border-collapse:collapse;font-size:12.5px}
  .mm-tbl th{font-size:10.5px;color:var(--muted);text-transform:uppercase;text-align:left;padding:5px 8px;border-bottom:1px solid var(--line);font-weight:600}
  .mm-tbl td{padding:6px 8px;border-bottom:1px solid var(--line)}
  .mm-tbl tr:last-child td{border-bottom:none}
  .mm-tbl .r{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums}
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
    <div class="panel"><div class="panel-h"><span>일자별 활동</span><div class="legend"><span class="lg"><i style="background:var(--cyan)"></i>진입</span><span class="lg"><i style="background:var(--brand)"></i>판 시작</span></div></div><div class="chart-outer"><div class="chart-wrap" id="chart"></div><div class="chart-tip" id="chartTip"></div></div></div>
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
  <div class="modal" id="memModal"><div class="modal-card" id="memModalCard"></div></div>
</div>
<script id="gad" type="application/json">${json}</script>
<script>var __name=function(f){return f};(${clientMain.toString()})();</script>`;
// ↑ __name shim: 워커 번들러(esbuild keepNames)가 clientMain에 __name(fn,'name') 래퍼를 주입하는데
//   브라우저엔 그 헬퍼가 없어 ReferenceError가 난다. no-op으로 정의해 흡수(로컬 Node 빌드엔 무해).
}
