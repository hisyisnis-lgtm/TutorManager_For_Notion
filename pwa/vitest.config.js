import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';

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
  // shadcn 컴포넌트는 서로를 '@/lib/utils' 같은 형태로 참조한다(공식 규약).
  // 이 파일은 vite.config.js를 읽지 않으므로 **같은 alias를 여기에도** 둬야 한다.
  // 없으면 shadcn을 쓰는 컴포넌트는 테스트에서 import부터 실패한다(2026-08-28에 겪음).
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    globals: false,
  },
});
