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
    desc: '기초 단어',
    timeMultiplier: 1.0,
  },
  {
    id: 'normal',
    gameKey: 'tone-normal',
    label: '중급',
    desc: '일상 회화',
    timeMultiplier: 0.85,
  },
  {
    id: 'hard',
    gameKey: 'tone-hard',
    label: '고급',
    desc: '도전 단어',
    timeMultiplier: 0.7,
  },
];

// 성조 정의 — 학습 도구 특성상 5색 매핑은 디자인 시스템 단일 액센트 원칙의 합리적 예외.
// 색상은 globally distinguishable하고 색맹에게도 모양(mark)으로 구분 가능하도록 설계.
// 색상은 성조게임 리디자인(밝고 친근 캐주얼) 팔레트 기준 — tgTokens.js TONE_COLORS와 동일하게 유지.
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

// 시드 단어 — 오프라인/네트워크 실패/워커 미배포 시 마지막 폴백.
// 단일 출처는 Notion '🎯 성조 게임 단어' DB. 이 시드는 최소 플레이 보장용 소량 샘플.
// 구조: { hanzi, pinyin[], tones[], meaning } (Worker 응답과 동일 형태)
export const SEED_WORDS = {
  easy: [
    { hanzi: '你好', pinyin: ['nǐ', 'hǎo'], tones: [3, 3], meaning: '안녕하세요' },
    { hanzi: '谢谢', pinyin: ['xiè', 'xie'], tones: [4, 0], meaning: '고마워요' },
    { hanzi: '老师', pinyin: ['lǎo', 'shī'], tones: [3, 1], meaning: '선생님' },
    { hanzi: '朋友', pinyin: ['péng', 'you'], tones: [2, 0], meaning: '친구' },
    { hanzi: '时间', pinyin: ['shí', 'jiān'], tones: [2, 1], meaning: '시간' },
    { hanzi: '米饭', pinyin: ['mǐ', 'fàn'], tones: [3, 4], meaning: '쌀밥' },
    { hanzi: '咖啡', pinyin: ['kā', 'fēi'], tones: [1, 1], meaning: '커피' },
    { hanzi: '学生', pinyin: ['xué', 'sheng'], tones: [2, 0], meaning: '학생' },
    { hanzi: '中国', pinyin: ['zhōng', 'guó'], tones: [1, 2], meaning: '중국' },
    { hanzi: '妈妈', pinyin: ['mā', 'ma'], tones: [1, 0], meaning: '엄마' },
  ],
  normal: [
    { hanzi: '简单', pinyin: ['jiǎn', 'dān'], tones: [3, 1], meaning: '간단하다' },
    { hanzi: '文化', pinyin: ['wén', 'huà'], tones: [2, 4], meaning: '문화' },
    { hanzi: '计划', pinyin: ['jì', 'huà'], tones: [4, 4], meaning: '계획' },
    { hanzi: '技术', pinyin: ['jì', 'shù'], tones: [4, 4], meaning: '기술' },
    { hanzi: '适应', pinyin: ['shì', 'yìng'], tones: [4, 4], meaning: '적응하다' },
    { hanzi: '习惯', pinyin: ['xí', 'guàn'], tones: [2, 4], meaning: '습관' },
    { hanzi: '经济', pinyin: ['jīng', 'jì'], tones: [1, 4], meaning: '경제' },
    { hanzi: '准备', pinyin: ['zhǔn', 'bèi'], tones: [3, 4], meaning: '준비하다' },
    { hanzi: '环境', pinyin: ['huán', 'jìng'], tones: [2, 4], meaning: '환경' },
    { hanzi: '健康', pinyin: ['jiàn', 'kāng'], tones: [4, 1], meaning: '건강' },
  ],
  hard: [
    { hanzi: '复杂', pinyin: ['fù', 'zá'], tones: [4, 2], meaning: '복잡하다' },
    { hanzi: '鼓励', pinyin: ['gǔ', 'lì'], tones: [3, 4], meaning: '격려하다' },
    { hanzi: '责任', pinyin: ['zé', 'rèn'], tones: [2, 4], meaning: '책임' },
    { hanzi: '影响', pinyin: ['yǐng', 'xiǎng'], tones: [3, 3], meaning: '영향' },
    { hanzi: '效率', pinyin: ['xiào', 'lǜ'], tones: [4, 4], meaning: '효율' },
    { hanzi: '顺利', pinyin: ['shùn', 'lì'], tones: [4, 4], meaning: '순조롭다' },
    { hanzi: '详细', pinyin: ['xiáng', 'xì'], tones: [2, 4], meaning: '상세하다' },
    { hanzi: '严格', pinyin: ['yán', 'gé'], tones: [2, 2], meaning: '엄격하다' },
    { hanzi: '表达', pinyin: ['biǎo', 'dá'], tones: [3, 2], meaning: '표현하다' },
    { hanzi: '谨慎', pinyin: ['jǐn', 'shèn'], tones: [3, 4], meaning: '신중하다' },
  ],
};
