// 랜덤 닉네임 생성 — 로그인 후 닉네임 입력칸의 기본값(+'다시 뽑기'). 형용사+동물 조합의 귀여운 이름.
// 서버 GameNicknameSchema(1~12자)와 클라 입력칸 상한을 공유(NICKNAME_MAX). 조합 최대 길이는 항상 ≤ NICKNAME_MAX.
export const NICKNAME_MAX = 12; // worker GameNicknameSchema와 반드시 동일하게 유지

// 형용사(최대 4자) + 동물(최대 3자) = 최대 7자 → NICKNAME_MAX(12) 이내 보장.
const NICK_ADJ = [
  '씩씩한', '귀여운', '졸린', '배고픈', '신나는', '용감한', '느긋한', '반짝이는',
  '폭신한', '통통한', '재빠른', '엉뚱한', '다정한', '명랑한', '나른한', '수줍은',
];
const NICK_NOUN = [
  '판다', '너구리', '다람쥐', '고양이', '병아리', '강아지', '곰돌이', '토끼',
  '여우', '부엉이', '수달', '펭귄', '참새', '햄스터',
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// 예: "씩씩한판다", "반짝이는너구리". 항상 비어있지 않고 ≤ NICKNAME_MAX.
export function randomNickname() {
  return `${pick(NICK_ADJ)}${pick(NICK_NOUN)}`;
}
