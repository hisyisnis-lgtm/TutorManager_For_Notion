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
      manifest: {
        name: '하늘하늘중국어',
        short_name: '하늘하늘중국어',
        description: '중국어 튜터링 관리 시스템',
        theme_color: '#830009',
        background_color: '#F9FAFB',
        display: 'standalone',
        orientation: 'portrait',
        // start_url을 '.'(현재 URL)로 — iOS Safari PWA에서 manifest의 동적 교체나 hash·query는
        // 무시되지만, 정적 manifest의 start_url을 '.'로 두면 "홈 화면에 추가" 시점의 페이지 URL이
        // 그대로 보존된다. 학생이 path 기반 URL(`/personal/{token}`)에서 PWA 설치하면 그 URL이 박힘.
        start_url: '.',
        scope: '/',
        lang: 'ko',
        icons: [
          {
            src: 'pwa-64x64.png',
            sizes: '64x64',
            type: 'image/png',
          },
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
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
