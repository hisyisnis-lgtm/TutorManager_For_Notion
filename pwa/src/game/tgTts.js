// 성조게임 TTS — 단어(한자) 발음 재생.
// v1: 브라우저 내장 Web Speech(speechSynthesis, zh-CN). 무료·즉시.
// 업그레이드 경로: word.audioUrl(미리 생성한 고음질 음성, 예: Edge 신경망 zh-CN)이 있으면 그걸 우선 재생.
//   → 나중에 Notion 단어 DB에 audioUrl 컬럼 추가 + 워커 생성 파이프라인만 붙이면 이 모듈 교체 없이 동작.
import { duckBgm, releaseBgmDuck } from './tgBgm.js'; // 발음 재생 동안 BGM 더킹(또렷하게)

let zhVoice = null;

// 성조 정확도의 최대 변수 = "어떤 중국어 음성을 고르느냐".
// 로컬 저품질 음성(윈도우 Huihui 등)은 성조가 평평/부정확 → 온라인·신경망 음성을 점수제로 우선.
function scoreZhVoice(v) {
  const lang = (v.lang || '').toLowerCase();
  const name = v.name || '';
  let s = 0;
  // 1) 언어 — 표준 만다린(zh-CN / cmn-Hans) 최우선. 광둥어(zh-HK/yue)는 성조 체계가 달라 제외.
  if (/(yue|zh[-_]?hk|zh[-_]?yue|cantonese|粤|廣東|广东)/i.test(`${lang} ${name}`)) return -1;
  if (/^zh[-_]?cn/.test(lang) || /^cmn[-_]?hans/.test(lang) || /^cmn$/.test(lang)) s += 100;
  else if (/^cmn/.test(lang)) s += 80;
  else if (/^zh/.test(lang)) s += 40; // zh-TW 등 — 만다린이나 발음차 있어 후순위
  else if (/chinese|mandarin|普通话|中文|国语|國語/i.test(name)) s += 30; // 이름 기반(lang 미표기 엔진)
  else return -1; // 중국어 아님
  // 2) 품질 — 온라인/신경망 우선(대개 성조 정확), 알려진 저품질 로컬 회피.
  if (v.localService === false) s += 25;                               // 온라인 음성(구글 등) = 고품질 경향
  if (/google/i.test(name)) s += 15;
  if (/neural|natural|premium|enhanced|online/i.test(name)) s += 12;
  if (/xiaoxiao|xiaoyi|yunxi|yunyang|yunjian|晓晓|云希/i.test(name)) s += 8; // 알려진 신경망 화자
  if (/huihui|kangkang|yaoyao/i.test(name)) s -= 6;                    // 알려진 저품질 로컬 회피
  return s;
}

function pickZhVoice() {
  try {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    let best = null;
    let bestScore = -1;
    for (const v of voices) {
      const s = scoreZhVoice(v);
      if (s > bestScore) { bestScore = s; best = v; }
    }
    zhVoice = bestScore >= 0 ? best : null;
  } catch { /* noop */ }
}

export function initTts() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  pickZhVoice();
  // 크롬 등은 보이스가 비동기 로드 → 준비되면 다시 선택
  try { window.speechSynthesis.onvoiceschanged = pickZhVoice; } catch { /* noop */ }
  // ⚠️ 온라인 중국어 음성(Google zh-CN 등)은 onvoiceschanged 없이 수 초 뒤 슬그머니 로드되기도 함
  //   → 잡힐 때까지 짧게 폴링하며 재선택(로컬 음성만 있을 땐 한국어로 폴백되는 문제 방지).
  try {
    let n = 0;
    const poll = setInterval(() => { pickZhVoice(); if (zhVoice || ++n > 30) clearInterval(poll); }, 300); // 확보 or ~9초 후 중단
  } catch { /* noop */ }
}

export function ttsAvailable() {
  return typeof window !== 'undefined' && (!!window.speechSynthesis || typeof Audio !== 'undefined');
}

// zh 합성 가능 여부 — 중국어 보이스가 실제로 있어야 true(매번 재선택: 온라인 zh 음성이 늦게 로드되는 경우 대비).
function canSynthZh() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return false;
  pickZhVoice();
  return !!zhVoice;
}

// Web Speech(브라우저 내장) 폴백 — 미리생성 음성이 없거나 재생 실패 시.
function speakViaSynth(word) {
  // ⚠️ 중국어 보이스가 없으면 발화하지 않음 — 기기 기본 음성이 한자를 한국어로 읽으면 성조 게임에선 무음보다 해로움.
  //   (최신 크롬은 voice 미지정 시 lang만으로 중국어를 안 고르고 기본 음성으로 읽기도 함 → 보이스 명시 지정 필수)
  if (!canSynthZh()) { releaseBgmDuck(); return; } // 발화 없이 종료 처리(더킹 복귀)만 수행
  try {
    const synth = window.speechSynthesis;
    synth.cancel(); // 이전 발화 중단(연속 단어 겹침 방지)
    const u = new SpeechSynthesisUtterance(word.hanzi);
    u.lang = 'zh-CN';
    u.voice = zhVoice;
    u.rate = 0.9; // 살짝 천천히 — 성조가 또렷이 들리게
    u.onend = releaseBgmDuck; u.onerror = releaseBgmDuck; // 발화 끝 → BGM 더킹 복귀
    synth.speak(u);
  } catch { releaseBgmDuck(); }
}

// ── mp3 캐시(LRU) — 같은 단어 반복 재생 시 재다운로드 방지 + 다음 단어 프리로드로 첫 재생 지연 제거 ──
const AUDIO_CACHE_MAX = 24;
const audioCache = new Map(); // key=audioUrl, value=Audio (Map 삽입순 = LRU 순)
function cacheGet(url) {
  const a = audioCache.get(url);
  if (a) { audioCache.delete(url); audioCache.set(url, a); } // 최근 사용으로 갱신
  return a || null;
}
function cachePut(url, a) {
  if (audioCache.has(url)) audioCache.delete(url);
  audioCache.set(url, a);
  while (audioCache.size > AUDIO_CACHE_MAX) audioCache.delete(audioCache.keys().next().value); // 가장 오래된 것부터 방출
}

// 다음 단어 프리로드 — Audio를 만들어 캐시에 넣기만 하고 재생하지 않음(호출부: 다음 단어 노출 전).
export function preloadTts(word) {
  try {
    const url = word && word.audioUrl;
    if (!url || audioCache.has(url)) return;
    const a = new Audio(url);
    a.preload = 'auto';
    cachePut(url, a);
  } catch { /* noop — 프리로드 실패는 무해(재생 시 새로 생성) */ }
}

// 단어 발음 재생. word: { hanzi, audioUrl? }
// 미리 생성한 신경망 음성(audioUrl) 우선 — 전 기기 동일·성조 정확. 없거나 재생 실패(404 등)면 Web Speech로 폴백.
let currentAudio = null;
export function speakWord(word) {
  if (!word) return;
  // 실제로 소리를 낼 수 있을 때만 더킹 — 무음인데 BGM만 2.5초 꺼지는 문제 방지.
  if (!word.audioUrl && !canSynthZh()) return;
  duckBgm(); // 발음 나오는 동안 BGM 잠깐 낮춤(또렷하게). end/에러/안전타이머로 복귀.
  if (word.audioUrl) {
    try {
      if (currentAudio) { try { currentAudio.pause(); } catch { /* noop */ } } // 이전 재생 중단(겹침 방지)
      let a = cacheGet(word.audioUrl);
      if (!a) { a = new Audio(word.audioUrl); cachePut(word.audioUrl, a); }
      currentAudio = a;
      let fellBack = false;
      const fallback = () => { // 폴백=synth가 자체 onend로 더킹 복귀
        if (fellBack) return; fellBack = true;
        if (currentAudio !== a) return; // stale — 이미 다른 재생이 진행 중이면 뒤늦은 폴백이 그 위에 겹치지 않게 무시
        currentAudio = null;
        audioCache.delete(word.audioUrl); // 죽은 오디오는 캐시에서 제거(다음엔 새로 시도)
        speakViaSynth(word);
      };
      // 캐시 재사용 대비 on핸들러 할당(addEventListener 누적 방지 — 재생마다 교체)
      a.onerror = fallback; // 파일 없음/디코딩 실패
      a.onended = () => { if (currentAudio === a) currentAudio = null; releaseBgmDuck(); }; // 발음 끝 → 더킹 복귀
      try { a.currentTime = 0; } catch { /* noop */ } // 캐시 재사용 시 처음부터
      a.play().catch(fallback); // 재생 거부(포맷 미지원 등) → 폴백
      return;
    } catch { /* fallthrough to synth */ }
  }
  speakViaSynth(word);
}
