import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync, renameSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'));

// `vite build --mode game` = 성조게임 단독 앱 빌드(엔트리 game.html→main.game.jsx, dist-game).
// 통합 웹은 기존 그대로(index.html→main.jsx, dist). __GAME_APP__로 학생 조회 코드 등을 빌드별로 DCE.
export default defineConfig(({ mode }) => {
  const isGameApp = mode === 'game';
  return {
  base: '/',
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __GAME_APP__: JSON.stringify(isGameApp),
  },
  build: {
    sourcemap: false,
    ...(isGameApp
      ? {
          outDir: 'dist-game',
          rollupOptions: { input: fileURLToPath(new URL('./game.html', import.meta.url)) },
        }
      : {}),
  },
  plugins: [
    react(),
    // 게임 단독 앱은 서비스워커/PWA manifest를 쓰지 않는다(Capacitor 네이티브 래핑 대상).
    // 대신 빌드 산출물의 game.html을 index.html로 바꾼다 — Capacitor는 webDir 루트에 index.html을 요구.
    ...(isGameApp ? [{
      name: 'game-html-as-index',
      closeBundle() {
        const dir = path.resolve('dist-game');
        // Capacitor는 webDir 루트에 index.html을 요구 → 게임 엔트리(game.html)를 index.html로.
        const from = path.join(dir, 'game.html');
        if (existsSync(from)) renameSync(from, path.join(dir, 'index.html'));
        // public/의 정적 SEO 페이지(intro/pricing/group-class.html 등)가 모든 빌드에 복사되므로,
        // 게임 단독 앱 산출물에선 index.html만 남기고 제거(앱은 MemoryRouter라 이들을 열지 않음).
        for (const f of readdirSync(dir)) {
          if (f.endsWith('.html') && f !== 'index.html') unlinkSync(path.join(dir, f));
        }
      },
    }] : [VitePWA({
      registerType: 'prompt',
      includeAssets: ['symbol-red.png', 'icon.svg', 'apple-touch-icon-180x180.png', 'pwa-*.png', 'maskable-icon-512x512.png'],
      // iOS Safari PWA가 manifest의 start_url을 자기 마음대로 해석(hash·query 제거, '.'을 root로)해
      // 학생 토큰을 잃어버리는 문제 때문에 manifest 자동 주입 자체를 비활성화한다.
      // 대신 pwa/public/manifest.webmanifest를 정적 파일로 두고, index.html의 inline script가
      // 학생 path가 아닐 때만 <link rel="manifest"> 태그를 동적으로 추가한다.
      // 학생 path에서는 manifest 자체가 없으므로 iOS가 "홈 화면에 추가" 시 현재 페이지 URL을 그대로 박는다.
      manifest: false,
      workbox: {
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/intro$/, /^\/pricing$/],
        runtimeCaching: [
          {
            // Cloudflare Worker API는 항상 네트워크에서 가져옴 (최신 데이터)
            urlPattern: /^https:\/\/.*\.workers\.dev\/.*/,
            handler: 'NetworkOnly',
          },
          {
            // Pretendard 폰트는 캐시
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts-cache',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    })]),
  ],
  };
});
