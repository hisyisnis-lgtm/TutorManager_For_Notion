// 성조 빨리 찾기 게임 메타데이터 + 단어 풀
//
// 단어 풀의 단일 출처 = data/tone-words.csv (대표님이 엑셀/구글시트로 편집).
//   빌드 시 scripts/tone-words-build.mjs 가 병음 부호에서 성조를 자동 추출·검증해
//   toneWordsData.json 으로 변환(pwa predev/prebuild 가 실행). 이 파일은 게임 동작 상수 + 그 데이터를 export.
//
// 단어 추가/수정: data/tone-words.csv 만 편집 → 커밋 → 배포. (Notion·워커 불필요)
// 새 난이도 추가 시: ① CSV '난이도'에 새 이름 ② scripts/tone-words-build.mjs 의 DIFF_KEY 매핑 ③ 아래 DIFFICULTIES 추가.
import toneWordsData from './toneWordsData.json';

// timeMultiplier: 단어당 시간 배수(높을수록 시간 여유=쉬움). 2026-06 너프: 고급=옛 초급(1.0), 초급·중급은 더 여유롭게.
export const DIFFICULTIES = [
  { id: 'easy', gameKey: 'tone-easy', label: '초급', desc: '기초 단어', timeMultiplier: 1.3 },
  { id: 'normal', gameKey: 'tone-normal', label: '중급', desc: '일상 회화', timeMultiplier: 1.15 },
  { id: 'hard', gameKey: 'tone-hard', label: '고급', desc: '도전 단어', timeMultiplier: 1.0 },
];

// 성조 정의 — 학습 도구 특성상 5색 매핑은 디자인 시스템 단일 액센트 원칙의 합리적 예외.
// 색상은 globally distinguishable하고 색맹에게도 모양(mark)으로 구분 가능하도록 설계.
// tgTokens.js TONE_COLORS와 동일하게 유지.
export const TONES = [
  { num: 1, mark: 'ˉ', sample: 'mā', name: '1성', color: '#FF4D6D' },
  { num: 2, mark: 'ˊ', sample: 'má', name: '2성', color: '#FF9F40' },
  { num: 3, mark: 'ˇ', sample: 'mǎ', name: '3성', color: '#36C98D' },
  { num: 4, mark: 'ˋ', sample: 'mà', name: '4성', color: '#4D8DFF' },
  { num: 0, mark: '·', sample: 'ma', name: '경성', color: '#AAB2BD' },
];

export const ROUND_LENGTH = 10;

export function findTone(num) {
  return TONES.find((t) => t.num === num);
}

// 단어 풀 — CSV에서 빌드 변환된 데이터 { easy:[…], normal:[…], hard:[…] }.
// 각 항목: { hanzi, pinyin[], tones[], meaning }. 모든 유저 동일·소량이라 클라이언트 번들에 포함.
export const TONE_WORDS = toneWordsData;
// 하위호환 별칭 — 기존 fetchToneWords 가 import 하던 이름.
export const SEED_WORDS = toneWordsData;
