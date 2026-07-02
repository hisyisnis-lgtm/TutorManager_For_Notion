// 튜토리얼 단어 데이터 — TutorialScreen(화면)과 scripts/tone-tts-build.mjs(음성 생성) 공용 단일 출처.
// audioUrl(미리 생성한 신경망 음성)은 ttsAudioUrl로 자동 주입 → tgTts가 우선 재생, 없으면 Web Speech 폴백.
import { ttsAudioUrl } from './ttsSlug.js';

const withAudio = (w) => ({ ...w, audioUrl: ttsAudioUrl(w) });

// 보고 찾기(비트1) · 듣고 찾기(비트2)
export const P1_WORD = withAudio({ hanzi: '妈妈', pinyin: ['mā', 'ma'], tones: [1, 0], meaning: '엄마' });
export const P2_WORD = withAudio({ hanzi: '好', pinyin: ['hǎo'], tones: [3], meaning: '좋다' });

// 성조 소개(비트0) — 같은 'ma'가 성조에 따라 뜻이 달라짐(고전 예시).
export const TONE_SAMPLES = {
  1: withAudio({ hanzi: '妈', pinyin: ['mā'], tones: [1], meaning: '엄마' }),
  2: withAudio({ hanzi: '麻', pinyin: ['má'], tones: [2], meaning: '삼' }),
  3: withAudio({ hanzi: '马', pinyin: ['mǎ'], tones: [3], meaning: '말' }),
  4: withAudio({ hanzi: '骂', pinyin: ['mà'], tones: [4], meaning: '혼내다' }),
  0: withAudio({ hanzi: '吗', pinyin: ['ma'], tones: [0], meaning: '~까?' }),
};
export const SAMPLE_ORDER = [1, 2, 3, 4, 0];

// 튜토리얼에서 음성 생성이 필요한 전체 단어(빌드 스크립트용)
export const TUTORIAL_TTS_WORDS = [P1_WORD, P2_WORD, ...SAMPLE_ORDER.map((n) => TONE_SAMPLES[n])];
