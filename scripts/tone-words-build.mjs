// 성조게임 단어 빌드 — data/tone-words-{easy,normal,hard}.csv → pwa/src/constants/toneWordsData.json
//
// 단일 출처 = 난이도별 CSV 3개 (대표님이 엑셀/구글시트로 편집). 파일명이 곧 난이도라 CSV엔 난이도 컬럼 없음.
//   컬럼: 한자,병음,의미,활성
// 성조는 병음 부호에서 자동 추출(ā=1·á=2·ǎ=3·à=4·무부호=경성0) → CSV엔 성조 컬럼 불필요.
// 검증 실패(한자수≠병음음절수, 빈 셀 등) 시 어느 파일·행인지 출력하고 빌드 중단(exit 1).
// pwa/package.json 의 predev/prebuild 가 빌드 전 자동 실행.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ttsAudioUrl } from '../pwa/src/game/ttsSlug.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const OUT_PATH = path.join(ROOT, 'pwa', 'src', 'constants', 'toneWordsData.json');

// 난이도별 파일 (파일명 = 난이도)
const FILES = [
  ['tone-words-easy.csv', 'easy'],
  ['tone-words-normal.csv', 'normal'],
  ['tone-words-hard.csv', 'hard'],
];

// 테마별 파일 (파일명 = 테마). 난이도와 별개 축 — 테마 단어가 난이도 단어와 겹치는 건 정상.
// 새 테마 추가 시: ① 여기 파일 한 줄 ② out 초기화에 키 ③ toneGameWords.js THEMES 추가.
const THEME_FILES = [
  ['tone-words-drama.csv', 'drama'],
  ['tone-words-travel.csv', 'travel'],
];

// 병음 성조 부호 → 숫자 (대문자 병음도 지원)
const TONE_MARK = {
  ā: 1, ē: 1, ī: 1, ō: 1, ū: 1, ǖ: 1, Ā: 1, Ē: 1, Ī: 1, Ō: 1, Ū: 1, Ǖ: 1,
  á: 2, é: 2, í: 2, ó: 2, ú: 2, ǘ: 2, Á: 2, É: 2, Í: 2, Ó: 2, Ú: 2, Ǘ: 2,
  ǎ: 3, ě: 3, ǐ: 3, ǒ: 3, ǔ: 3, ǚ: 3, Ǎ: 3, Ě: 3, Ǐ: 3, Ǒ: 3, Ǔ: 3, Ǚ: 3,
  à: 4, è: 4, ì: 4, ò: 4, ù: 4, ǜ: 4, À: 4, È: 4, Ì: 4, Ò: 4, Ù: 4, Ǜ: 4,
};
function toneOfSyllable(syl) {
  for (const ch of syl) { if (TONE_MARK[ch]) return TONE_MARK[ch]; }
  return 0; // 성조 부호 없음 = 경성
}

// 따옴표·콤마·이스케이프 처리하는 최소 CSV 파서 (줄 단위 — 셀 내 개행 미지원, 미닫힘 따옴표는 throw)
function parseCsv(text) {
  const out = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let ln = 0; ln < lines.length; ln++) {
    const raw = lines[ln];
    if (raw.length === 0) continue;
    const cells = []; let cur = ''; let q = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (q) {
        if (c === '"') { if (raw[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { cells.push(cur); cur = ''; }
      else cur += c;
    }
    if (q) throw new Error(`${ln + 1}행: 닫히지 않은 따옴표(") — 셀 안 줄바꿈은 지원하지 않습니다`);
    cells.push(cur);
    out.push(cells);
  }
  return out;
}

// 기대 헤더 — 첫 행이 이와 다르면(헤더 누락·컬럼 순서 변경) 빌드 중단
const EXPECTED_HEADER = ['한자', '병음', '의미', '활성'];
function headerError(row) {
  const cells = (row || []).map((c) => c.replace(/^\uFEFF/, '').trim()); // 엑셀 UTF-8 BOM 허용
  const ok = EXPECTED_HEADER.every((h, i) => cells[i] === h) && cells.slice(EXPECTED_HEADER.length).every((c) => c === '');
  return ok ? null : `헤더가 '${EXPECTED_HEADER.join(',')}'이(가) 아닙니다 (실제: '${(row || []).join(',')}')`;
}

function build() {
  const out = { easy: [], normal: [], hard: [], drama: [], travel: [] };
  const errors = [];
  const warnings = [];

  // CSV 파일 한 개를 검증·변환해 out[key]에 채운다.
  // dedupMap: 같은 한자가 또 나오면 경고. 범위를 호출부에서 정해 난이도(통합)·테마(파일별)를 구분.
  function processFile(file, key, dedupMap) {
    const fp = path.join(DATA_DIR, file);
    if (!fs.existsSync(fp)) { errors.push(`단어 파일이 없습니다: data/${file}`); return; }
    let rows;
    try {
      rows = parseCsv(fs.readFileSync(fp, 'utf8'));
    } catch (e) {
      errors.push(`${file} ${e.message}`); // 미닫힘 따옴표 등 파싱 불가
      return;
    }
    const headerErr = headerError(rows.shift()); // 헤더(한자,병음,의미,활성) 검증 후 제거
    if (headerErr) { errors.push(`${file} 1행: ${headerErr}`); return; }

    rows.forEach((cells, idx) => {
      const ln = idx + 2; // 1-base + 헤더
      const hanzi = (cells[0] || '').trim();
      const pinyinRaw = (cells[1] || '').trim();
      const meaning = (cells[2] || '').trim();
      const active = (cells[3] || 'O').trim().toUpperCase();

      if (!hanzi && !pinyinRaw) return; // 빈 행 무시
      if (active === 'X') return;        // 비활성 = 게임 제외

      if (!hanzi || !pinyinRaw) { errors.push(`${file} ${ln}행: 빈 셀 (한자·병음은 필수)`); return; }
      const syllables = pinyinRaw.split(/\s+/).filter(Boolean);
      const chars = [...hanzi];
      if (chars.length !== syllables.length) {
        errors.push(`${file} ${ln}행 '${hanzi}': 한자 ${chars.length}자 ≠ 병음 ${syllables.length}음절 ("${pinyinRaw}") — 음절은 띄어쓰기로 구분`);
        return;
      }
      if (!meaning) warnings.push(`${file} ${ln}행 '${hanzi}': 의미가 비어 있음`);
      if (dedupMap.has(hanzi)) warnings.push(`${file} ${ln}행: 중복 한자 '${hanzi}' (${dedupMap.get(hanzi)}에도 있음)`);
      else dedupMap.set(hanzi, `${file} ${ln}행`);

      const tones = syllables.map(toneOfSyllable);
      // audioUrl = 미리 생성한 신경망 음성 경로(결정적 슬러그). 파일이 없어도 tgTts가 Web Speech로 폴백.
      out[key].push({ hanzi, pinyin: syllables, tones, meaning, audioUrl: ttsAudioUrl({ pinyin: syllables, tones }) });
    });
  }

  // 난이도 3파일은 통합 중복검사(같은 단어가 여러 난이도에 들어가면 경고).
  const diffSeen = new Map();
  for (const [file, key] of FILES) processFile(file, key, diffSeen);
  // 테마는 난이도와 별개 축 — 난이도 단어와 겹치는 건 정상이라 파일별 자체 중복만 점검.
  for (const [file, key] of THEME_FILES) processFile(file, key, new Map());

  if (warnings.length) console.warn('⚠️  경고:\n' + warnings.map((w) => '  ' + w).join('\n'));
  if (errors.length) {
    console.error('\n❌ 단어 CSV 검증 실패 — 아래를 고친 뒤 다시 배포하세요:\n' + errors.map((e) => '  ' + e).join('\n') + '\n');
    process.exit(1);
  }

  const diffTotal = out.easy.length + out.normal.length + out.hard.length;
  if (diffTotal === 0) { console.error('❌ 활성 난이도 단어가 0개입니다.'); process.exit(1); }
  const themeTotal = out.drama.length + out.travel.length;

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`✅ 단어 변환 완료 → toneWordsData.json · 난이도 ${diffTotal}개 (초급 ${out.easy.length} · 중급 ${out.normal.length} · 고급 ${out.hard.length}) · 테마 ${themeTotal}개 (드라마 ${out.drama.length} · 여행 ${out.travel.length})`);
}

build();
