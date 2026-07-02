// 성조게임 TTS 파일 슬러그 — 미리 생성한 신경망 음성 파일명 규칙(앱·빌드 스크립트 공용 단일 출처).
// 규칙: 병음(성조부호 제거, ü→v) 이어붙임 + '_' + 성조번호 이어붙임.
//   예) 妈妈 ["mā","ma"] [1,0] → "mama_10" · 老师 ["lǎo","shī"] [3,1] → "laoshi_31" · 律 ["lǜ"] [4] → "lv_4"
// 동음이의어(병음·성조 동일)는 같은 슬러그 → 발음이 같으니 파일 1개 공유(정상 dedup).
// ü는 v로 보존해 lü(律)와 lu(路)가 안 섞이게 함.
const TTS_BASE = '/game/tts/';

export function ttsSlug(pinyin = [], tones = []) {
  const base = (pinyin || [])
    .map((s) => (s || '')
      .replace(/[üǖǘǚǜ]/g, 'v').replace(/[ÜǕǗǙǛ]/g, 'v')
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // 성조 결합부호 제거
      .replace(/[^a-z]/gi, '').toLowerCase())
    .join('');
  return `${base}_${(tones || []).join('')}`;
}

export function ttsAudioUrl(word) {
  if (!word || !word.pinyin || !word.pinyin.length) return null;
  return `${TTS_BASE}${ttsSlug(word.pinyin, word.tones)}.mp3`;
}
