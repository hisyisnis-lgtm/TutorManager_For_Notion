// 성조게임 신경망 TTS 음성 생성 — 단어(한자) → Microsoft Edge 신경망 zh-CN 음성 mp3.
// 출력: pwa/public/game/tts/<slug>.mp3  (slug = ttsSlug, 병음+성조. 동음이의어는 1파일 공유)
// 음성: zh-CN-XiaoxiaoNeural (또렷한 표준 여성). 무료 Edge 온라인 엔드포인트(API키 불필요).
//
// 자동 실행: pwa predev/prebuild에서 tone-words-build 다음에 체이닝 → 단어 추가/수정 시 새 슬러그만 자동 생성.
// 수동: cd pwa && npm run tts   /   전체 재생성: npm run tts -- --force
//
// ★설계 원칙 — 빌드를 절대 깨지 않는다:
//   ① 생성할 게 없으면(모든 파일 존재) 네트워크·의존성 없이 즉시 통과(CI·오프라인 안전).
//   ② 생성 도구(msedge-tts) 미설치(예: CI는 root devDep 미설치)면 건너뜀 — 커밋된 mp3 사용, 없으면 tgTts가 Web Speech 폴백.
//   ③ 네트워크 실패 등도 경고만, exit 0. (실패한 단어는 폴백)
// → mp3는 저장소에 커밋. 단어 추가/수정 후 로컬(온라인)에서 자동 생성되면 함께 커밋하면 됨.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ttsSlug } from '../pwa/src/game/ttsSlug.js';
import { TUTORIAL_TTS_WORDS } from '../pwa/src/game/tutorialWords.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'pwa', 'src', 'constants', 'toneWordsData.json');
const OUT_DIR = path.join(ROOT, 'pwa', 'public', 'game', 'tts');
const VOICE = 'zh-CN-XiaoxiaoNeural';
const FORCE = process.argv.includes('--force');

// <voice> 내부 SSML을 감싸는 래퍼(override 전용).
const WRAP = (inner) => `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="zh-CN"><voice name="${VOICE}">${inner}</voice></speak>`;

// 단어별 SSML override(slug 기준) — 엔진 기본 읽기가 성조/억양을 틀리게 낼 때만 최소 사용. 화자는 VOICE 그대로.
// 값 = <voice> 내부 SSML.  ⚠️ 무료 Edge 제약: 인라인 <prosody> "한 겹"만 허용(이중 중첩·contour는 빈 음성으로 거부됨).
const OVERRIDES = {
  // 妈妈: Xiaoxiao가 둘째 음절(경성)을 '엄마!' 부르는 억양으로 올려 읽음 → 경성 음절 피치를 낮춰 하강 교정.
  mama_10: '妈<prosody pitch="-50%">妈</prosody>',
};

// 생성 대상 수집 — 데이터 전 단어 + 튜토리얼 단어. slug 기준 dedup(동음이의어=발음 동일=파일 공유).
function collectWords() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const all = [...Object.values(data).flat(), ...TUTORIAL_TTS_WORDS];
  const map = new Map(); // slug → hanzi(첫 등장)
  for (const w of all) {
    if (!w || !w.hanzi || !w.pinyin) continue;
    const slug = ttsSlug(w.pinyin, w.tones);
    if (!map.has(slug)) map.set(slug, w.hanzi);
  }
  return map;
}

let MsEdgeTTS, OUTPUT_FORMAT, tts = null;
async function initTts() { tts = new MsEdgeTTS(); await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3); }

// ssml(override)이 있으면 rawToStream, 없으면 한자 텍스트를 toStream.
function synthOnce(text, ssml) {
  return new Promise((resolve, reject) => {
    let done = false;
    const chunks = [];
    const timer = setTimeout(() => { if (!done) { done = true; reject(new Error('timeout')); } }, 20000);
    const { audioStream } = ssml ? tts.rawToStream(WRAP(ssml)) : tts.toStream(text);
    audioStream.on('data', (c) => chunks.push(c));
    audioStream.on('end', () => { if (done) return; done = true; clearTimeout(timer); resolve(Buffer.concat(chunks)); });
    audioStream.on('error', (e) => { if (done) return; done = true; clearTimeout(timer); reject(e); });
  });
}

// 실패 시 클라이언트 재초기화 후 1회 재시도(WebSocket 유휴 종료 등 대비)
async function synth(text, ssml) {
  try { return await synthOnce(text, ssml); }
  catch { await initTts(); return await synthOnce(text, ssml); }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const words = collectWords();

  // ① 생성할 것만 추림 — 없으면 네트워크/의존성 없이 즉시 통과
  const todo = [...words].filter(([slug]) => FORCE || !fs.existsSync(path.join(OUT_DIR, `${slug}.mp3`)));
  if (todo.length === 0) { console.log(`🔊 TTS 음성 최신 (${words.size}개, 생성 불필요)`); return; }

  // ② 생성 도구 동적 로드 — 없으면(예: CI) 건너뜀(빌드 안 깨짐, 폴백)
  try { ({ MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts')); }
  catch {
    console.warn(`⚠️  msedge-tts 미설치 — 음성 ${todo.length}개 생성 건너뜀(커밋된 파일/Web Speech 폴백 사용). 로컬 생성: cd pwa && npm run tts`);
    return;
  }

  console.log(`🔊 신경망 TTS 생성 시작 — ${todo.length}개 (${VOICE})`);
  try { await initTts(); }
  catch (e) { console.warn(`⚠️  TTS 초기화 실패(${e.message}) — 생성 건너뜀(폴백 사용)`); return; }

  let generated = 0;
  const failed = [];
  for (const [slug, hanzi] of todo) {
    try {
      const buf = await synth(hanzi, OVERRIDES[slug]);
      if (!buf || buf.length < 200) throw new Error(`빈 음성(${buf ? buf.length : 0}B)`);
      fs.writeFileSync(path.join(OUT_DIR, `${slug}.mp3`), buf);
      generated++;
      process.stdout.write(`  ✓ ${slug} (${hanzi})\n`);
    } catch (e) {
      failed.push(`${slug} (${hanzi}): ${e.message}`);
      process.stdout.write(`  ✗ ${slug} (${hanzi}) — ${e.message}\n`);
    }
  }
  try { tts.close(); } catch { /* noop */ }

  console.log(`✅ TTS 생성 — 신규 ${generated} · 실패 ${failed.length} (총 ${words.size}개)`);
  // ③ 실패해도 exit 0 — 폴백이 있으니 빌드는 진행. 실패 목록만 경고.
  if (failed.length) console.warn('⚠️  생성 실패(다음 실행 때 재시도, 그때까진 Web Speech 폴백):\n' + failed.map((f) => '  ' + f).join('\n'));
}

main().catch((e) => { console.warn('⚠️  TTS 빌드 경고(무시하고 진행):', e.message); });
