import { defineConfig } from 'vitest/config';

// 단위 테스트 전용 설정 — 빌드용 vite.config.js의 VitePWA/react 플러그인을 거치지 않는다.
// 게임 순수 로직(gameLogic·tgWordStats·tgTokens)이 localStorage를 쓰므로 jsdom 환경.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    globals: false,
  },
});
