import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync, renameSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// The member-only artifact is independent of the existing teacher/legacy PWA build.
export default defineConfig({
  base: '/personal/',
  define: { __APP_VERSION__: JSON.stringify(version), __GAME_APP__: 'false' },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  esbuild: { pure: ['console.log', 'console.table', 'console.group', 'console.groupEnd', 'console.debug'] },
  build: {
    outDir: 'dist-student', sourcemap: false,
    rollupOptions: {
      input: fileURLToPath(new URL('./student.html', import.meta.url)),
      output: { manualChunks(id) { return /[\\/]node_modules[\\/](?:react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id) ? 'vendor' : undefined; } },
    },
  },
  plugins: [react(), {
      name: 'student-app-security-and-assets',
      transform(code, id) {
        const sourcePath = id.replaceAll('\\', '/');
        // API의 /panda/action은 요청 경로이므로 정적 자산 base 치환에서 제외한다.
        if (!sourcePath.includes('/src/') || sourcePath.includes('/src/api/') || !/\.[jt]sx?(?:\?|$)/.test(id)) return null;
        return { code: code.replace(/(["'`])\/(panda|logo|fonts)\//g, '$1/personal/$2/')
          .replace(/(["'`])\/(pwa-[^"'`]+\.png|maskable-icon-[^"'`]+\.png)/g, '$1/personal/$2'), map: null };
      },
      transformIndexHtml() {
        return [{ tag: 'meta', attrs: {
          'http-equiv': 'content-security-policy',
          content: ["default-src 'self'", "base-uri 'none'", "object-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "style-src-attr 'unsafe-inline'", "font-src 'self' https://cdn.jsdelivr.net", "img-src 'self' data: blob: https:", "media-src 'self' blob: https:", "connect-src 'self'", "worker-src 'self'", "manifest-src 'self'", "form-action 'self'"].join('; '),
        }, injectTo: 'head-prepend' }];
      },
      closeBundle() {
        const from = path.resolve('dist-student/student.html');
        if (existsSync(from)) renameSync(from, path.resolve('dist-student/index.html'));
      },

  }, VitePWA({
    registerType: 'prompt', scope: '/personal/', base: '/personal/',
    includeAssets: ['symbol-red.png', 'icon.svg', 'apple-touch-icon-180x180.png', 'pwa-*.png', 'maskable-icon-512x512.png'],
    manifest: {
      id: '/personal/', name: '하늘하늘중국어 학생 앱', short_name: '하늘하늘 학생 앱',
      description: '내 수업과 숙제를 확인하는 학생 앱', display: 'standalone', lang: 'ko',
      theme_color: '#7f0005', background_color: '#f9fafb', start_url: '/personal/', scope: '/personal/',
      icons: [
        { src: '/personal/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/personal/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        { src: '/personal/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      clientsClaim: true, cacheId: 'hanul-student-app',
      globPatterns: ['assets/**/*.{js,css,woff,woff2}', 'panda/**/*.{png,svg,webp}', 'logo/**/*.{png,svg}', 'pwa-*.png', 'maskable-icon-512x512.png', 'favicon.png', 'apple-touch-icon-180x180.png'],
      navigateFallback: undefined, navigateFallbackDenylist: [],
      runtimeCaching: [{ urlPattern: ({ url, request }) => request.mode === 'navigate' || url.pathname.startsWith('/api/site/'), handler: 'NetworkOnly' }],
    },
  })],
});
