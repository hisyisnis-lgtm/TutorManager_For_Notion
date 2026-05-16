// 성조 빨리 찾기 게임 메타데이터
// 단어 풀은 Notion DB '🎯 성조 게임 단어'에서 관리되며 Worker `/game/tone-words/:difficulty`로 조회.
// 여기엔 게임 동작 상수(난이도 메타, 성조 정의, 라운드 길이)만 보관.
//
// 새 난이도 추가 시:
//  1. Notion DB '난이도' select에 옵션 추가 (예: '입문')
//  2. Worker의 TONE_DIFFICULTY_TO_NAME 매핑에 추가
//  3. worker/lib/schemas.js의 ToneDifficultySchema enum에 키 추가
//  4. 아래 DIFFICULTIES 배열에 항목 추가

export const DIFFICULTIES = [
  {
    id: 'easy',
    gameKey: 'tone-easy',
    label: '초급',
    desc: 'HSK 1~2급',
    timeMultiplier: 1.0,
  },
  {
    id: 'normal',
    gameKey: 'tone-normal',
    label: '중급',
    desc: 'HSK 3급',
    timeMultiplier: 0.85,
  },
  {
    id: 'hard',
    gameKey: 'tone-hard',
    label: '고급',
    desc: 'HSK 4급',
    timeMultiplier: 0.7,
  },
];

// 성조 정의 — 학습 도구 특성상 5색 매핑은 디자인 시스템 단일 액센트 원칙의 합리적 예외.
// 색상은 globally distinguishable하고 색맹에게도 모양(mark)으로 구분 가능하도록 설계.
export const TONES = [
  { num: 1, mark: 'ˉ', sample: 'mā', name: '1성', color: '#E11D48' },
  { num: 2, mark: 'ˊ', sample: 'má', name: '2성', color: '#F59E0B' },
  { num: 3, mark: 'ˇ', sample: 'mǎ', name: '3성', color: '#10B981' },
  { num: 4, mark: 'ˋ', sample: 'mà', name: '4성', color: '#2563EB' },
  { num: 0, mark: '·', sample: 'ma', name: '경성', color: '#94A3B8' },
];

export const ROUND_LENGTH = 10;

export function findTone(num) {
  return TONES.find((t) => t.num === num);
}
