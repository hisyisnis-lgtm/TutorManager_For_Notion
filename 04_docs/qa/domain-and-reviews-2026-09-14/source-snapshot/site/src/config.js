// 사이트 공통 설정 — URL·플래그·사업자 정보. 값의 출처는 pwa/src/constants.js 와 메모리 business.md.
export const SITE_URL = 'https://tiantianchinese.com';
export const SITE_NAME = '하늘하늘 중국어';
export const TAGLINE = '3개월 안에 중국어 회화를 위한 가장 좋은 공부습관을 만듭니다.';

export const KAKAO_CHANNEL_CHAT_URL = 'https://pf.kakao.com/_jFnFn/chat';
export const APP_URL = 'https://tiantian-chinese.pages.dev';
export const GROUP_CLASS_URL = `${SITE_URL}/lessons/`;
export const PRIVACY_URL = `${APP_URL}/#/privacy`;
export const GAME_URL = '/game/tone/';

export const CHANNELS = {
  instagram: 'https://www.instagram.com/tiantian_laoshi/',
  youtube: 'https://www.youtube.com/@tiantian_chinese',
  blog: 'https://blog.naver.com/tiantian_chinese',
  kakao: KAKAO_CHANNEL_CHAT_URL,
};

export const BUSINESS = {
  name: '하늘하늘중국어',
  owner: '최하늘',
  regNo: '747-15-01965',
  email: 'tiantianchinese_@naver.com',
};

export const NAV = [
  { href: '/learn/', label: '중국어 배우기' },
  { href: '/books/', label: '교재' },
  { href: '/game/', label: '게임' },
  { href: '/channels/', label: '채널' },
  { href: '/lessons/', label: '수업 안내' },
  { href: '/reviews/', label: '수강생 후기' },
];

// 2026-09-08: 대표가 공식 사이트의 게임 홍보·플레이 페이지 구성을 요청했다.
// 히어로 배경 영상 — public/video/hero.mp4·hero.webm 준비 후 true (없을 때 켜면 404만 난다).
export const HERO_VIDEO = true; // 2026-09-07: IMG_2919.MOV 2400~2420s 컷(05_assets/Video/hero)에서 압축
