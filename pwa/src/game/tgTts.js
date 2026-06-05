// 성조게임 TTS — 단어(한자) 발음 재생.
// v1: 브라우저 내장 Web Speech(speechSynthesis, zh-CN). 무료·즉시.
// 업그레이드 경로: word.audioUrl(미리 생성한 고음질 음성, 예: Edge 신경망 zh-CN)이 있으면 그걸 우선 재생.
//   → 나중에 Notion 단어 DB에 audioUrl 컬럼 추가 + 워커 생성 파이프라인만 붙이면 이 모듈 교체 없이 동작.

let zhVoice = null;

function pickZhVoice() {
  try {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    zhVoice = voices.find((v) => /^zh[-_]?CN/i.test(v.lang))
      || voices.find((v) => /^zh/i.test(v.lang))
      || null;
  } catch { /* noop */ }
}

export function initTts() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  pickZhVoice();
  // 크롬 등은 보이스가 비동기 로드 → 준비되면 다시 선택
  try { window.speechSynthesis.onvoiceschanged = pickZhVoice; } catch { /* noop */ }
}

export function ttsAvailable() {
  return typeof window !== 'undefined' && (!!window.speechSynthesis || typeof Audio !== 'undefined');
}

// 단어 발음 재생. word: { hanzi, audioUrl? }
export function speakWord(word) {
  if (!word) return;
  // 고음질 미리생성 음성 우선
  if (word.audioUrl) {
    try { const a = new Audio(word.audioUrl); a.play().catch(() => {}); return; } catch { /* fallthrough */ }
  }
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel(); // 이전 발화 중단(연속 단어 겹침 방지)
    const u = new SpeechSynthesisUtterance(word.hanzi);
    u.lang = 'zh-CN';
    if (zhVoice) u.voice = zhVoice;
    u.rate = 0.9; // 살짝 천천히 — 성조가 또렷이 들리게
    synth.speak(u);
  } catch { /* noop */ }
}
