#!/usr/bin/env node
/**
 * 디자인 시스템 정적 검사기 (design_system.md 집행 장치)
 *
 * 왜 있나: 규칙은 문서에 있었는데 검사할 방법이 없어서 아무도 위반을 몰랐다.
 *   - "PRIMARY 본문 텍스트 금지"(§12) → 홈 화면에 12곳 위반
 *   - "weight 500은 폰트 폴백"(§3.1) → 금지 규칙이 없어 14곳 드리프트
 *   - "카드 패딩 16 base"(§5) → 실제 3종
 * 매번 사람이 눈으로 찾는 대신 명령어 한 줄로 잡는다.
 *
 * 사용:
 *   node scripts/design-audit.mjs              # 강사·학생앱 (게임 제외)
 *   node scripts/design-audit.mjs --all        # 게임 포함
 *   node scripts/design-audit.mjs --rule=weight-500
 *   node scripts/design-audit.mjs --quiet      # 요약만
 *
 * 종료코드: ERROR가 하나라도 있으면 1 (CI에 걸 수 있음)
 *
 * ⚠️ 이 스크립트는 파일을 읽기만 한다. 절대 고치지 않는다.
 * ⚠️ 화면을 봐야 아는 것(가림·넘침·실제 대비)은 `/pwa-visual-qa` 담당. 여긴 소스만 본다.
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(process.cwd(), 'pwa/src');
const args = process.argv.slice(2);
const INCLUDE_GAME = args.includes('--all');
const QUIET = args.includes('--quiet');
const ONLY = (args.find((a) => a.startsWith('--rule=')) || '').split('=')[1];

// ── 예외 (이유 없는 예외는 두지 않는다) ─────────────────────────────────────
// 검사기가 오탐을 뱉기 시작하면 아무도 안 본다. 예외는 여기 한 곳에만, 반드시 이유와 함께.
// 코드 쪽에 마커를 심는 방식(`// design-audit-ignore: rule — 이유`)도 지원한다.
const ALLOW = [
  { rule: 'color-literal', match: /constants[\\/]/, why: '토큰 정의·데이터 파일(성조 색 등)이 리터럴의 출처 그 자체' },
  { rule: 'color-literal', match: /components[\\/]ui[\\/]Badge\.jsx$/, why: 'Tailwind 클래스→토큰 매핑 계층. 이 파일이 매핑표다' },
  { rule: 'color-literal', match: /pages[\\/](PricingPage|PrivacyPage|ConsentPage|LandingPage)\.jsx$/, why: '공개·법정 고지 페이지. §4가 인정한 그라데이션 래퍼 예외 포함' },
  { rule: 'color-literal', match: /DynamicStudentManifest\.jsx$/, why: 'PWA manifest에 박는 theme_color — CSS가 아니라 매니페스트 값' },
  { rule: 'weight-500', match: /pages[\\/](PricingPage|LandingPage|GroupClassPage)\.jsx$/, why: '공개 페이지는 자체 타이포 스케일(§1 랜딩 규칙)' },
  { rule: 'color-literal', match: /PandaTestPage\.jsx$/, why: '개발 전용 테스트 화면 — 사용자에게 노출되지 않는다' },
  { rule: 'thick-color-border', match: /components[\\/]public[\\/]PublicHeader\.jsx$/, why: '활성 탭 밑줄 인디케이터(2px). 깊이용 보더가 아니라 상태 표시' },
];
const allowedBy = (ruleId, file) => ALLOW.find((a) => a.rule === ruleId && a.match.test(file));

/** 코드 쪽 인라인 억제: 같은 줄 또는 바로 윗줄의 `design-audit-ignore: <rule>` */
function suppressedInline(lines, idx, ruleId) {
  const re = new RegExp(`design-audit-ignore:\\s*${ruleId}\\b`);
  return re.test(lines[idx] || '') || re.test(lines[idx - 1] || '');
}

// ── 규칙 정의 ───────────────────────────────────────────────────────────────
// severity: error = 고쳐야 함 / warn = 드리프트 / review = 사람이 판단
const RULES = [
  {
    id: 'antd-deprecated',
    severity: 'error',
    doc: '§10 · CLAUDE.md',
    why: 'antd v6에서 제거 예정 API. 지금 동작해도 업그레이드에서 깨진다.',
    test: (line) =>
      /\bbordered=\{/.test(line) ||
      /<Space[^>]*direction="vertical"/.test(line) ||
      /destroyOnClose|destroyOnHide/.test(line) ||
      /iconPosition=/.test(line) ||
      // v6에서 Alert.message → Alert.title 로 개명(message는 deprecated).
      // 우리 자체 컴포넌트(ErrorMessage·ConfirmDialog)의 message prop과 안 헷갈리게 <Alert 한정.
      /<Alert[^>]*\smessage=/.test(line) ||
      /\bcloseText=/.test(line),
  },
  {
    id: 'antd-icons-legacy',
    severity: 'error',
    doc: '§12',
    why: '@ant-design/icons는 완전 제거 대상. Phosphor의 XxxIcon 사용.',
    test: (line) => /@ant-design\/icons/.test(line),
  },
  {
    id: 'phosphor-legacy-export',
    severity: 'error',
    doc: '§12',
    why: 'Phosphor의 접미사 없는 export(House 등)는 deprecated. HouseIcon 형태로.',
    test: (line) => {
      const m = line.match(/import\s*\{([^}]+)\}\s*from\s*'@phosphor-icons\/react'/);
      if (!m) return false;
      return m[1]
        .split(',')
        .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
        .filter(Boolean)
        .some((n) => /^[A-Z]/.test(n) && !n.endsWith('Icon') && n !== 'IconContext');
    },
  },
  {
    id: 'transition-all',
    severity: 'error',
    doc: '§7.2 · Better #14',
    why: "transition: all은 의도 안 한 속성까지 애니메이션시키고 브라우저 최적화를 막는다.",
    test: (line) =>
      /transition:\s*['"`]?all\b/.test(line) ||
      /transitionProperty:\s*['"`]all['"`]/.test(line) ||
      /className="[^"]*\btransition\s+duration-/.test(line),
  },
  {
    id: 'color-literal',
    severity: 'error',
    doc: '§13',
    why: '색은 constants/theme.js가 단일 출처. 리터럴은 토큰 변경 시 누락된다.',
    // 토큰 정의 파일과 CSS는 리터럴이 있어야 정상
    skipFile: (f) => /constants[\\/](theme|styles)\.js$/.test(f) || /\.css$/.test(f),
    test: (line) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return false;      // 주석
      if (/rgba?\(/.test(line) && !/#[0-9a-fA-F]{3,8}\b/.test(line)) return false;
      const m = line.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g);
      if (!m) return false;
      // 흑백·투명은 유틸 목적으로 허용 (그림자·오버레이 등)
      const allowed = new Set(['#fff', '#ffffff', '#000', '#000000']);
      return m.some((h) => !allowed.has(h.toLowerCase()));
    },
  },
  {
    id: 'weight-500',
    severity: 'warn',
    doc: '§3.3',
    why: 'KimjungchulGothic은 300/400/700만 있어 500은 시스템 폰트로 폴백 → 같은 줄에 서체가 갈린다. 400 또는 600으로.',
    // 스케일이 인정한 예외
    skipFile: (f) => /BottomNav\.jsx$/.test(f) || /MonthCalendar\.jsx$/.test(f),
    test: (line) => /\bfont-medium\b/.test(line) || /fontWeight:\s*500\b/.test(line),
  },
  {
    id: 'dead-transition',
    severity: 'warn',
    doc: '§7.2',
    why: 'transition-property 없이 duration/easing만 있으면 아무것도 전환되지 않는다(죽은 클래스).',
    test: (line) => {
      const m = line.match(/className="([^"]*)"/);
      if (!m) return false;
      const c = m[1];
      return /\bduration-\d/.test(c) && !/\btransition(-|\[)/.test(c);
    },
  },
  {
    id: 'radius-offscale',
    severity: 'warn',
    doc: '§4',
    why: 'radius 스케일 밖 값. 4/6/8/10/12/16/20/980 중에서 고를 것.',
    test: (line) => {
      const m = [...line.matchAll(/borderRadius:\s*(\d+)/g)];
      if (!m.length) return false;
      const ok = new Set([0, 4, 6, 8, 10, 12, 14, 16, 20, 980, 999, 9999]);
      return m.some((x) => !ok.has(Number(x[1])));
    },
  },
  {
    id: 'thick-color-border',
    severity: 'warn',
    doc: '§12 · Better #3',
    why: '굵은 컬러 보더는 "AI티"로 명시 거절된 패턴. 깊이는 그림자로.',
    test: (line) => /border(Left|Right|Top|Bottom)?:\s*[`'"]\s*(1\.5|2|3)px solid/.test(line),
  },
  {
    id: 'inline-multi-shadow',
    severity: 'warn',
    doc: '§6.4',
    why: '다중 레이어 그림자는 CSS 변수로만. 인라인에 직접 쓰면 값이 갈라진다.',
    test: (line) => {
      const m = line.match(/boxShadow:\s*[`'"]([^`'"]+)[`'"]/);
      return !!m && (m[1].match(/px/g) || []).length > 4 && !m[1].includes('var(');
    },
  },
  {
    id: 'emptystate-emoji-icon',
    severity: 'error',
    doc: '§19.4 · §20.1',
    why: '빈 상태 아이콘은 Phosphor 44px weight="thin" + BORDER_NEUTRAL. 이모지는 폰트 종속이라 플랫폼마다 다르고 토큰으로 색·크기를 제어할 수 없다.',
    test: (line) => /<EmptyState[^>]*\sicon="/.test(line) || /^\s*icon="[^"]*"\s*$/.test(line),
  },
  {
    id: 'viewport-width-fullbleed',
    severity: 'error',
    doc: '§9',
    why: '100vw는 세로 스크롤바 폭을 포함해 콘텐츠 영역보다 넓어진다 → 가로 스크롤바 → fixed BottomNav가 밀려 올라간다. 풀블리드는 부모 폭(100%)으로.',
    skipFile: (f) => /\.css$/.test(f),
    test: (line) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return false;   // 주석은 규칙을 설명하는 자리다
      return /(width|minWidth|maxWidth):\s*['"`]?100vw/.test(line) || /calc\(50% - 50vw\)/.test(line);
    },
  },
  {
    id: 'icon-size-offscale',
    severity: 'warn',
    doc: '§19',
    why: '아이콘 크기 토큰은 12/16/20/24/44.',
    // ⚠️ `size` prop은 antd에도 있다 — <Space size={8}>은 간격, <Avatar size={120}>은 지름.
    //    Phosphor 아이콘 컴포넌트(<XxxIcon>)에 붙은 size만 본다. 안 그러면 오탐이 쏟아진다.
    test: (line) => {
      const m = [...line.matchAll(/<[A-Z]\w*Icon\b[^>]*?\bsize=\{(\d+)\}/g)];
      if (!m.length) return false;
      const ok = new Set([12, 16, 20, 24, 44]);
      return m.some((x) => !ok.has(Number(x[1])));
    },
  },
  {
    id: 'primary-as-text',
    severity: 'review',
    doc: '§12',
    why: 'PRIMARY는 인터랙티브·아이콘·배지 배경 전용. 본문 데이터에 쓰였는지 사람이 확인할 것.',
    test: (line) =>
      /color:\s*PRIMARY\b/.test(line) ||
      /\btext-brand-(600|700)\b/.test(line),
  },
  {
    id: 'small-hit-area',
    severity: 'review',
    doc: '§7.4 · Better #16',
    why: '세로 패딩이 작은 버튼은 히트영역이 40px에 못 미칠 수 있다. .hit-40 확인.',
    test: (line) =>
      /<button/.test(line) === false &&
      /padding:\s*['"`][0-6]px\s+\d+px/.test(line) &&
      /borderRadius/.test(line),
  },
];

// ── 파일 수집 ───────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
      if (!INCLUDE_GAME && e.name === 'game') continue;
      walk(p, out);
    } else if (/\.(jsx?|css)$/.test(e.name) && !/\.test\.jsx?$/.test(e.name)) {
      if (!INCLUDE_GAME && /ToneGamePage\.jsx$/.test(e.name)) continue;
      out.push(p);
    }
  }
  return out;
}

if (!fs.existsSync(SRC)) {
  console.error(`pwa/src를 찾을 수 없습니다: ${SRC}\n저장소 루트에서 실행하세요.`);
  process.exit(2);
}

// ── 실행 ────────────────────────────────────────────────────────────────────
const files = walk(SRC);
const rules = ONLY ? RULES.filter((r) => r.id === ONLY) : RULES;
const findings = new Map(rules.map((r) => [r.id, []]));
const suppressed = [];

for (const file of files) {
  const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const rule of rules) {
    if (rule.skipFile?.(file)) continue;
    const allow = allowedBy(rule.id, file);
    if (allow) { suppressed.push({ rule: rule.id, rel, why: allow.why }); continue; }
    lines.forEach((line, i) => {
      if (line.length > 400) return;              // 압축/데이터 줄 무시
      if (!rule.test(line)) return;
      if (suppressedInline(lines, i, rule.id)) {
        suppressed.push({ rule: rule.id, rel: `${rel}:${i + 1}`, why: '코드 내 인라인 마커' });
        return;
      }
      findings.get(rule.id).push({ rel, n: i + 1, text: line.trim().slice(0, 110) });
    });
  }
}

const SEV = { error: '❌ ERROR ', warn: '⚠️  WARN  ', review: '👁  REVIEW' };
let errors = 0, warns = 0, reviews = 0;

console.log(`\n디자인 시스템 검사 — ${files.length}개 파일${INCLUDE_GAME ? ' (게임 포함)' : ' (게임 제외)'}\n`);

for (const rule of rules) {
  const hits = findings.get(rule.id);
  if (rule.severity === 'error') errors += hits.length;
  else if (rule.severity === 'warn') warns += hits.length;
  else reviews += hits.length;

  if (!hits.length) {
    if (!QUIET) console.log(`✅ ${rule.id}  (0)`);
    continue;
  }
  console.log(`${SEV[rule.severity]} ${rule.id}  (${hits.length})  ${rule.doc}`);
  console.log(`   ${rule.why}`);
  if (!QUIET) {
    // --rule 로 하나만 볼 때는 전부 보여준다 (고치려고 부른 것이므로)
    const cap = ONLY ? hits.length : 12;
    for (const h of hits.slice(0, cap)) console.log(`   ${h.rel}:${h.n}  ${h.text}`);
    if (hits.length > cap) console.log(`   … 그 외 ${hits.length - cap}건`);
  }
  console.log('');
}

console.log('─'.repeat(64));
console.log(`ERROR ${errors} · WARN ${warns} · REVIEW ${reviews}`);
if (suppressed.length) {
  // 예외를 조용히 숨기지 않는다 — 몇 건이 왜 빠졌는지 항상 보여준다.
  const byRule = suppressed.reduce((m, s2) => ((m[s2.rule] = (m[s2.rule] || 0) + 1), m), {});
  console.log(`〓 예외 ${suppressed.length}건: ` + Object.entries(byRule).map(([k, v]) => `${k}(${v})`).join(' · '));
  console.log('  이유는 스크립트의 ALLOW 목록 참조. 이유 없는 예외는 두지 않는다.');
}
console.log('REVIEW는 위반이 아니라 "사람이 봐야 하는 것"이다 — 0을 목표로 하지 말 것.');
process.exit(errors > 0 ? 1 : 0);
