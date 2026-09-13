import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, mkdirSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const output = path.join(root, 'dist-pricing');

export default defineConfig({
  root,
  base: '/pricing/',
  resolve: { alias: { '@': path.join(root, 'src') } },
  build: {
    outDir: output,
    copyPublicDir: false,
    sourcemap: false,
    rollupOptions: {
      input: path.join(root, 'pricing-share.html'),
      output: {
        entryFileNames: 'assets/pricing-[hash].js',
        manualChunks(id) { return id.includes('node_modules') ? 'vendor' : undefined; },
      },
    },
  },
  plugins: [
    react(),
    {
      name: 'pricing-share-assets',
      closeBundle() {
        renameSync(path.join(output, 'pricing-share.html'), path.join(output, 'index.html'));
        // 소개 영상·게임·앱 설치 파일을 복사하지 않고 안내에 필요한 자산만 배포한다.
        for (const name of ['icon.svg', 'img/profile.jpg', 'img/og-group-class.png', 'logo/logo-red.png', 'logo/symbol-white.png', 'fonts']) {
          const destination = path.join(output, name);
          mkdirSync(path.dirname(destination), { recursive: true });
          cpSync(path.join(root, 'public', name), destination, { recursive: true });
        }
      },
    },
  ],
});
