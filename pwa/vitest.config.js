import { defineConfig } from 'vitest/config';

// 단위 테스트 전용 설정 — 빌드용 vite.config.js의 VitePWA/react 플러그인을 거치지 않는다.
// 게임 순수 로직(gameLogic·tgWordStats·tgTokens)이 localStorage를 쓰므로 jsdom 환경.
export default defineConfig({
  // 빌드에서 vite가 주입하는 전역 — 컴포넌트 테스트가 ToneGamePage를 렌더하려면 여기서도 정의해야 한다.
  define: {
    __APP_VERSION__: JSON.stringify('test'),
    __GAME_APP__: 'false',
  },
  // 컴포넌트 테스트용 JSX 변환 — react 플러그인 없이 esbuild의 automatic runtime만 쓴다
  // (플러그인을 넣으면 VitePWA까지 딸려와 단위 테스트가 느려진다).
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    globals: false,
  },
});
