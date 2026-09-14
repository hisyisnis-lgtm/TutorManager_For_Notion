// Local synthetic UI only. No outbound network access; no production requests.
// Run: node .tmp_qa/consult-site-release-20260914/serve-contact-form-fixture.cjs
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');
const workspace = path.resolve(__dirname, '../..');
const pwaRequire = Module.createRequire(path.join(workspace, 'pwa/package.json'));
const port = Number(process.env.CONTACT_FIXTURE_PORT || 5207);
const bundle = pwaRequire('esbuild').buildSync({
  entryPoints: [path.join(__dirname, 'contact-form-fixture.jsx')], bundle: true, write: false,
  format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  nodePaths: [path.join(workspace, 'site/node_modules')], logLevel: 'silent',
}).outputFiles[0].text;
const css = ['tokens.css', 'global.css', 'contact.css'].map(name => fs.readFileSync(path.join(workspace, 'site/src/styles', name), 'utf8').replace(/@import\s+'\.\/tokens\.css';/g, '')).join('\n') + `
.fixture-main{max-width:700px;margin:0 auto;padding:32px 20px;display:flex;flex-direction:column;gap:28px}
.fixture-controls{display:flex;flex-direction:column;gap:12px;padding:20px;border:2px dashed var(--border-neutral);border-radius:12px;font-size:14px}
.fixture-controls label{font-weight:600}.fixture-controls select{font:inherit;min-height:44px;padding:8px 12px;border:1px solid var(--border-neutral);border-radius:12px;background:var(--bg-card)}
`;
const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>출강·협업 문의 · 모의 검증</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="fixture-root"></div><script defer src="/fixture.js"></script></body></html>';
const server = http.createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'");
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end('Synthetic fixture accepts no submissions.'); return; }
  const route = request.url.split('?')[0];
  const asset = route === '/' || route === '/contact/' ? ['text/html; charset=utf-8', html]
    : route === '/fixture.js' ? ['text/javascript; charset=utf-8', bundle]
      : route === '/fixture.css' ? ['text/css; charset=utf-8', css] : null;
  if (!asset) { response.writeHead(404); response.end('Not found'); return; }
  response.writeHead(200, { 'Content-Type': asset[0] }); response.end(request.method === 'HEAD' ? '' : asset[1]);
});
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${port}/contact/`, mode: 'synthetic-only', productionRequests: false, preview5199Changed: false })));
