// 매일매일 성조키우기(구 성조 빨리 찾기) 게임 메타데이터 + 단어 풀
//
// 단어 풀의 단일 출처 = data/tone-words-*.csv (난이도·테마별 분할, 대표님이 엑셀/구글시트로 편집).
//   빌드 시 scripts/tone-words-build.mjs 가 병음 부호에서 성조를 자동 추출·검증해
//   toneWordsData.json 으로 변환(pwa predev/prebuild 가 실행). 이 파일은 게임 동작 상수 + 그 데이터를 export.
//
// 단어 추가/수정: 해당 CSV 만 편집 → 빌드(predev가 JSON+TTS mp3 자동 생성) → 산출물 커밋 → 배포. (Notion·워커 불필요)
// 새 난이도 추가 시: ① CSV 파일 추가 ② scripts/tone-words-build.mjs 의 FILES 매핑 ③ 아래 DIFFICULTIES 항목 추가.
//   잠금 사다리·해제 문구·업적·집계는 전부 이 배열 순서에서 자동 파생(gameLogic·achievements·ToneGamePage) — 별도 코드 수정 불필요.
import toneWordsData from './toneWordsData.json';

// timeMultiplier: 단어당 시간 배수(base 7000ms × 배수). 콤보0 기준 초급30·중급20·고급10초(균등 10초 간격), 콤보 쌓이면 기존처럼 가속.
// unlockReveal: '이 난이도가 열렸을 때'의 전용 연출 데이터(아이콘·카피·액센트). 첫 난이도는 항상 열려 있어 없음.
// 라벨: 입문/실전/고수(2026-07-16 사용자 결정, 구 초급/중급/고급). id·gameKey는 유지(기록·잠금 호환).
// hanzi: 카운트다운 핀에 붙는 급 상징 한자(入门·实战·高手). 라벨과 한 곳에서 관리하려고 여기 둠(구 shared.jsx DIFF_HANZI).
export const DIFFICULTIES = [
  { id: 'easy', gameKey: 'tone-easy', label: '입문', hanzi: '入', desc: '기초 단어', timeMultiplier: 4.2857 },   // 콤보0 ≈30초
  { id: 'normal', gameKey: 'tone-normal', label: '실전', hanzi: '战', desc: '일상 회화', timeMultiplier: 2.8571, // 콤보0 ≈20초
    unlockReveal: { icon: 'Rocket', label: '실전 모드', desc: '실전에 도전할 수 있어요', accent: '#F2484C' } },
  { id: 'hard', gameKey: 'tone-hard', label: '고수', hanzi: '高', desc: '도전 단어', timeMultiplier: 1.4286,   // 콤보0 ≈10초
    unlockReveal: { icon: 'Crown', label: '고수 모드', desc: '고수에 도전할 수 있어요', accent: '#F0A91E' } },
];

// 테마 모드 — 난이도와 별개 축. 각 테마가 자체 gameKey라 최고점(loadBest)이 난이도처럼 자동으로 붙는다.
// timeMultiplier: 테마는 난이도를 안 가르므로 중급(≈20초) 페이스로 통일.
// ── 순차 잠금 사다리(2026-07-16) ──: 배열 순서 = 진열·해제 순서(왼→오 하나씩). 드라마(입문 자석)만 오픈,
//   이후는 '직전 테마 500점(별 ①)'으로 해제 — 취향 다양성 축이라 게이트는 가볍게(난이도 사다리 1000보다 낮음).
//   순서는 접근성(구체어→문화지식): 드라마 → 요리 → 여행 → 신조어. 새 테마는 배열 끝에 추가하고 unlock.byGameKey를 직전 테마로.
// unlock: null=오픈. { byGameKey, score }=그 게임키 최고점 ≥ score면 해제(themeUnlockReqText·진행 게이지·해제 연출이 전부 이 메타에서 파생).
// image: 포스터 경로(5:7 세로). null이면 tint+placeholder. unlockReveal: 해제 순간 연출(ToneGamePage가 unlock 메타로 자동 트리거).
const THEME_UNLOCK_SCORE = 500; // 별 ① 임계와 정합
export const THEMES = [
  { id: 'drama', gameKey: 'tone-drama', label: '드라마 중국어', desc: '드라마 속 사랑·감정 표현', timeMultiplier: 2.8571, unlock: null, image: '/game/themes/drama.png', tint: '#f1d7cf', placeholder: '드라마 이미지' },
  { id: 'cooking', gameKey: 'tone-cooking', label: '요리 중국어', desc: '음식·맛·주방 필수 단어', timeMultiplier: 2.8571, unlock: { byGameKey: 'tone-drama', score: THEME_UNLOCK_SCORE }, image: '/game/themes/cooking.jpg', tint: '#f7e3c3', placeholder: '요리 이미지', // jpg — 그림 특성상 png 1.3MB→jpg 160KB(600×800 리사이즈)
    unlockReveal: { icon: 'ForkKnife', label: '요리 테마', desc: '요리 중국어 테마가 열렸어요', accent: '#E8912C' } },
  { id: 'travel', gameKey: 'tone-travel', label: '여행 중국어', desc: '공항·호텔·주문 실전 단어', timeMultiplier: 2.8571, unlock: { byGameKey: 'tone-cooking', score: THEME_UNLOCK_SCORE }, image: '/game/themes/travel.png', tint: '#c9d3e4', placeholder: '여행 이미지',
    unlockReveal: { icon: 'MapPin', label: '여행 테마', desc: '여행 중국어 테마가 열렸어요', accent: '#7C5CFF' } },
  { id: 'slang', gameKey: 'tone-slang', label: '신조어 중국어', desc: '요즘 중국 인터넷 유행어', timeMultiplier: 2.8571, unlock: { byGameKey: 'tone-travel', score: THEME_UNLOCK_SCORE }, image: '/game/themes/slang.png', tint: '#cfe8d8', placeholder: '신조어 이미지',
    unlockReveal: { icon: 'Sparkle', label: '신조어 테마', desc: '신조어 중국어 테마가 열렸어요', accent: '#16B364' } },
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
