// 빌드 후: /game/tone 공유 링크에 "게임 전용 OG"가 뜨도록 dist/game/tone.html 생성.
//
// 왜: 앱은 SPA(index.html)라 모든 라우트가 같은 OG(메인 사이트)를 물려받는다. 카카오톡·SNS는
// JS를 안 돌리고 HTML의 OG만 읽으므로, /game/tone에 게임 OG가 박힌 정적 HTML을 따로 둔다.
// 정적 파일은 _redirects(/* → index.html 200)보다 우선 서빙되고, 내용은 index.html 복사본이라
// 사용자는 앱이 그대로 로드되어 BrowserRouter가 /game/tone → 성조게임으로 라우팅한다.
//
// 이미지 교체: public/game-og.png 파일만 바꾸면 됨(아래 URL은 그대로 유지).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIST = path.join(ROOT, 'pwa', 'dist');
const SRC = path.join(DIST, 'index.html');

const ORIGIN = 'https://tiantian-chinese.pages.dev';
const OG = {
  title: '성조 빨리찾기 — 중국어 4성 게임',
  description: '중국어 4성을 게임으로 빠르게 익히기. 하늘하늘중국어 성조 트레이닝.',
  image: `${ORIGIN}/game-og.png`, // 썸네일 교체 시 public/game-og.png만 바꾸면 됨
  url: `${ORIGIN}/game/tone`,
};

if (!existsSync(SRC)) {
  console.error('⏭  dist/index.html 없음 — 게임 OG 라우트 생성 건너뜀 (main 빌드 후 실행되어야 함)');
  process.exit(0);
}

let html = readFileSync(SRC, 'utf8');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// 기존 태그를 게임 값으로 치환(property/name 기준, 내용 무관)
const setProp = (prop, val) => {
  const re = new RegExp(`(<meta\\s+property="${prop}"\\s+content=")[^"]*(")`, 'i');
  if (re.test(html)) html = html.replace(re, `$1${esc(val)}$2`);
  else html = html.replace(/<\/head>/i, `    <meta property="${prop}" content="${esc(val)}" />\n  </head>`);
};
setProp('og:title', OG.title);
setProp('og:description', OG.description);
setProp('og:image', OG.image);
setProp('og:url', OG.url);
setProp('og:image:width', '1200');
setProp('og:image:height', '630');

// name="description" · <title> 도 게임용으로
html = html.replace(/(<meta\s+name="description"\s+content=")[^"]*(")/i, `$1${esc(OG.description)}$2`);
html = html.replace(/<title>[^<]*<\/title>/i, `<title>${esc(OG.title)}</title>`);

// 파비콘·apple-touch-icon 도 게임용으로 (탭·홈스크린 아이콘)
html = html.replace(/<link rel="icon"[^>]*>/i, '<link rel="icon" type="image/png" href="/favicon-game.png" />');
html = html.replace(/<link rel="apple-touch-icon"[^>]*>/i, '<link rel="apple-touch-icon" href="/favicon-game.png" />');

// twitter 카드(없으면 head에 추가)
if (!/name="twitter:card"/i.test(html)) {
  html = html.replace(/<\/head>/i,
    `    <meta name="twitter:card" content="summary_large_image" />\n` +
    `    <meta name="twitter:image" content="${esc(OG.image)}" />\n  </head>`);
}

const outDir = path.join(DIST, 'game');
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'tone.html'), html, 'utf8');
console.log('✅ dist/game/tone.html 생성 — /game/tone 공유 시 게임 OG 노출');
