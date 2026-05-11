import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'fs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  base: '/',
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    sourcemap: false,
  },
  plugins: [
    react(),
    VitePWA({
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
    }),
  ],
});
