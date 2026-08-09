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
  if (typeof window === 'undefined') return;
  // 발음 재생 엘리먼트 언락 — SFX/BGM과 같은 첫 제스처에 태운다(speechSynthesis 유무와 무관하게 필요).
  //  once:true — 한 번 쓰고 스스로 떨어진다. 리스너가 계속 남아 매 탭마다 재실행되면
  //  그 직후 시작되는 발음을 끊는다(2026-08-09 회귀 재발 방지).
  try {
    window.addEventListener('pointerdown', unlockTtsOnGesture, { once: true });
    window.addEventListener('keydown', unlockTtsOnGesture, { once: true });
  } catch { /* noop */ }
  if (!window.speechSynthesis) return;
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

// ── 재생 엘리먼트 1개 고정 ─────────────────────────────────────────────
// ⚠️ iOS Safari는 **사용자 제스처 밖에서 생성된 Audio**의 play()를 거부한다.
//  예전엔 단어마다 `new Audio(url)`를 만들어 캐시했는데, 그렇게 만든 엘리먼트는
//  듣기 문제 진입처럼 제스처가 없는 시점에 재생을 시도하면 전부 차단됐다
//  (그래서 '발음 듣기' 버튼 = 제스처 안 → 그때서야 소리가 났다. 2026-08-09 실기기 제보).
//  해결: 엘리먼트는 **하나만** 두고 첫 제스처에서 한 번 언락(무음 재생) → 이후엔 src만 갈아끼운다.
//  한 번 언락된 엘리먼트는 이후 프로그램 호출로도 재생이 허용된다.
const SILENCE = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAAAA';
let ttsEl = null;
let ttsElUrl = '';   // 현재 로드된 src(엘리먼트의 .src는 절대경로로 정규화돼 비교가 안 됨)
let ttsUnlocked = false;

function ensureEl() {
  if (!ttsEl && typeof Audio !== 'undefined') { ttsEl = new Audio(); ttsEl.preload = 'auto'; }
  return ttsEl;
}
// 첫 사용자 제스처에서 1회 — 무음을 잠깐 재생해 엘리먼트를 '허용' 상태로 만든다(SFX/BGM 언락과 같은 자리).
function unlockTtsOnGesture() {
  if (ttsUnlocked) return;
  ttsUnlocked = true; // ★성공·실패와 무관하게 딱 1회. 실패했다고 되돌리면 이후 모든 탭이 아래 src 교체를
  //                     다시 실행해, 그 직후 시작되는 진짜 발음을 계속 끊는다(2026-08-09 회귀).
  const a = ensureEl();
  if (!a || ttsElUrl) return; // 이미 발음이 물려 있으면 건드리지 않는다
  try {
    a.src = SILENCE; ttsElUrl = SILENCE;
    const p = a.play();
    if (p && p.catch) p.catch(() => { /* 아래 pause가 부르는 AbortError — 정상 */ });
    a.pause(); // ★반드시 **동기** pause. 프로미스로 미루면 그 사이 시작된 발음을 꺼버린다(회귀 원인).
  } catch { /* noop */ }
}

// 다음 단어 프리로드 — 파일을 HTTP 캐시에 올려두기만 한다(재생은 위 단일 엘리먼트가 담당).
//  Audio 엘리먼트를 미리 만들어두는 방식은 iOS에서 재생 권한이 없어 의미가 없었다.
const prefetched = new Set();
export function preloadTts(word) {
  const url = word && word.audioUrl;
  if (!url || prefetched.has(url)) return;
  prefetched.add(url);
  try { fetch(url, { cache: 'force-cache' }).catch(() => prefetched.delete(url)); } catch { prefetched.delete(url); }
}

// 단어 발음 재생. word: { hanzi, audioUrl? }
// 미리 생성한 신경망 음성(audioUrl) 우선 — 전 기기 동일·성조 정확. 없거나 재생 실패(404 등)면 Web Speech로 폴백.
let playToken = 0; // 재생 세대 — 늦게 도착한 에러 콜백이 다음 재생을 덮지 않게
export function speakWord(word) {
  if (!word) return;
  // 실제로 소리를 낼 수 있을 때만 더킹 — 무음인데 BGM만 2.5초 꺼지는 문제 방지.
  if (!word.audioUrl && !canSynthZh()) return;
  duckBgm(); // 발음 나오는 동안 BGM 잠깐 낮춤(또렷하게). end/에러/안전타이머로 복귀.
  const a = word.audioUrl ? ensureEl() : null;
  if (a) {
    try {
      const mine = ++playToken;
      let fellBack = false;
      const fallback = () => { // 폴백=synth가 자체 onend로 더킹 복귀
        if (fellBack || mine !== playToken) return; // stale — 이미 다음 재생이 진행 중이면 그 위에 겹치지 않게 무시
        fellBack = true;
        speakViaSynth(word);
      };
      try { a.pause(); } catch { /* noop */ } // 이전 발음 중단(겹침 방지)
      a.onerror = fallback;                    // 파일 없음/디코딩 실패
      a.onended = releaseBgmDuck;              // 발음 끝 → 더킹 복귀
      if (ttsElUrl !== word.audioUrl) { a.src = word.audioUrl; ttsElUrl = word.audioUrl; }
      try { a.currentTime = 0; } catch { /* noop */ } // 같은 단어 반복 재생 시 처음부터
      a.play().catch(fallback); // 언락 전(제스처 이전)이거나 포맷 미지원 → Web Speech로 폴백
      return;
    } catch { /* fallthrough to synth */ }
  }
  speakViaSynth(word);
}
