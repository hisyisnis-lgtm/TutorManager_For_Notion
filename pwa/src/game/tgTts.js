// 성조게임 TTS — 단어(한자) 발음 재생.
// v1: 브라우저 내장 Web Speech(speechSynthesis, zh-CN). 무료·즉시.
// 업그레이드 경로: word.audioUrl(미리 생성한 고음질 음성, 예: Edge 신경망 zh-CN)이 있으면 그걸 우선 재생.
//   → 나중에 Notion 단어 DB에 audioUrl 컬럼 추가 + 워커 생성 파이프라인만 붙이면 이 모듈 교체 없이 동작.

let zhVoice = null;

function pickZhVoice() {
  try {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    zhVoice = voices.find((v) => /^zh[-_]?CN/i.test(v.lang))         // zh-CN(표준)
      || voices.find((v) => /^zh/i.test(v.lang))                     // 기타 zh(zh-TW 등)
      || voices.find((v) => /^cmn/i.test(v.lang))                    // 일부 엔진은 'cmn'(만다린 BCP-47)
      || voices.find((v) => /chinese|mandarin|普通话|中文|国语/i.test(v.name)) // 이름 기반 매칭
      || null;
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

// Web Speech(브라우저 내장) 폴백 — 미리생성 음성이 없거나 재생 실패 시.
function speakViaSynth(word) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    const synth = window.speechSynthesis;
    pickZhVoice(); // 매 재생마다 최신 보이스 재선택(온라인 zh 음성이 늦게 로드되는 경우 대비)
    synth.cancel(); // 이전 발화 중단(연속 단어 겹침 방지)
    const u = new SpeechSynthesisUtterance(word.hanzi);
    u.lang = 'zh-CN';
    // ⚠️ 최신 크롬은 voice 미지정 시 lang만으로 중국어를 안 고르고 기본 음성(예: 한국어)으로 읽기도 함 → 중국어 보이스를 명시 지정.
    if (zhVoice) u.voice = zhVoice;
    u.rate = 0.9; // 살짝 천천히 — 성조가 또렷이 들리게
    synth.speak(u);
  } catch { /* noop */ }
}

// 단어 발음 재생. word: { hanzi, audioUrl? }
// 미리 생성한 신경망 음성(audioUrl) 우선 — 전 기기 동일·성조 정확. 없거나 재생 실패(404 등)면 Web Speech로 폴백.
let currentAudio = null;
export function speakWord(word) {
  if (!word) return;
  if (word.audioUrl) {
    try {
      if (currentAudio) { try { currentAudio.pause(); } catch { /* noop */ } } // 이전 재생 중단(겹침 방지)
      const a = new Audio(word.audioUrl);
      currentAudio = a;
      let fellBack = false;
      const fallback = () => { if (fellBack) return; fellBack = true; if (currentAudio === a) currentAudio = null; speakViaSynth(word); };
      a.addEventListener('error', fallback, { once: true }); // 파일 없음/디코딩 실패
      a.play().catch(fallback); // 재생 거부(포맷 미지원 등) → 폴백
      return;
    } catch { /* fallthrough to synth */ }
  }
  speakViaSynth(word);
}
