import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { hash } = require('../../worker/node_modules/blake3-wasm');
const work = 'C:/development/TutorManager_For_Notion/.tmp_qa/reviews-thumbnails-release-20260914';
const manifest = JSON.parse(fs.readFileSync(work + '/stage-manifest.json'));
const start = JSON.parse(fs.readFileSync(work + '/deploy-start.json'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function decodeEmail(hex) {
  assert.match(hex, /^[a-f0-9]+$/i); assert.equal(hex.length % 2, 0);
  const bytes = Buffer.from(hex, 'hex');
  return Buffer.from([...bytes.subarray(1)].map(b => b ^ bytes[0])).toString('utf8');
}
function undoCloudflareEmailProtection(html) {
  return html.replace(/href="\/cdn-cgi\/l\/email-protection#([a-f0-9]+)"><span class="__cf_email__" data-cfemail="([a-f0-9]+)">\[email&#160;protected\]<\/span>/gi, (_, href, label) => {
    const address = decodeEmail(href); assert.equal(address, decodeEmail(label));
    assert.match(address, /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9.-]+$/);
    return `href="mailto:${address}">${address}`;
  }).replace(/<script\b[^>]*src="\/cdn-cgi\/scripts\/[a-f0-9]+\/cloudflare-static\/email-decode\.min\.js"[^>]*><\/script>/gi, '');
}
const api = async route => {
  const r = await fetch('https://api.cloudflare.com/client/v4/accounts/6bb3d7a51e3f42a7ba6367187ee8be16/' + route, { headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }, signal: AbortSignal.timeout(20000) });
  const data = await r.json(); assert.ok(r.ok && data.success); return data.result;
};
const site = await api('pages/projects/tiantianchinese');
const current = await api('pages/projects/tiantianchinese/deployments/' + site.canonical_deployment.id);
assert.ok(current.id.startsWith('014aca80-'));
assert.equal(current.latest_stage.status, 'success');
assert.equal(current.deployment_trigger.metadata.commit_hash, start.commit);
assert.deepEqual(Object.keys(current.files).sort(), Object.keys(manifest.files).filter(n => !['/_headers', '/_redirects'].includes(n)).sort());
for (const [name, expected] of Object.entries(current.files)) {
  const bytes = fs.readFileSync(work + '/site-staging' + name);
  assert.equal(hash(bytes.toString('base64') + path.extname(name).slice(1)).toString('hex').slice(0, 32), expected, 'Remote manifest mismatch: ' + name);
}
const pwa = await api('pages/projects/tiantian-chinese');
assert.equal(pwa.canonical_deployment.id, start.pwaBefore);
const targets = ['/reviews/index.html', ...manifest.added, '/index.html', '/pricing/index.html', '/pricing/assets/pricing-4IH8T82A.js', '/game/tone/index.html', '/game/tone/assets/game-CtldDNEV.js'];
const checked = [];
for (const base of [current.url, 'https://tiantianchinese.com']) {
  for (let i = 0; i < targets.length; i += 4) {
    const results = await Promise.all(targets.slice(i, i + 4).map(async name => {
      const route = name.endsWith('/index.html') ? name.slice(0, -10) : name;
      const r = await fetch(new URL(route, base), { signal: AbortSignal.timeout(30000) });
      assert.equal(r.status, 200, route);
      const bytes = Buffer.from(await r.arrayBuffer());
      const compared = base === 'https://tiantianchinese.com' && name.endsWith('.html') ? Buffer.from(undoCloudflareEmailProtection(bytes.toString('utf8'))) : bytes;
      assert.equal(sha(compared), manifest.files[name], 'GET differs: ' + base + route);
      if (route.startsWith('/pricing/')) assert.match(r.headers.get('x-robots-tag') || '', /noindex.*nofollow/);
      if (base === 'https://tiantianchinese.com' && route === '/reviews/') assert.ok(!/noindex/.test(r.headers.get('x-robots-tag') || ''));
      return { base, route, status: r.status, responseSha256: sha(bytes), sourceSha256: sha(compared), cloudflareEmailProtection: !bytes.equals(compared), robots: r.headers.get('x-robots-tag') };
    })); checked.push(...results);
  }
  const retired = await fetch(new URL('/_astro/WorkbookCheckout.R5WACr9n.js', base), { redirect: 'manual', signal: AbortSignal.timeout(20000) });
  assert.equal(retired.status, 302); assert.equal(new URL(retired.headers.get('location'), base).pathname, '/books/');
}
const result = { verifiedAt: new Date().toISOString(), deployed: { id: current.id, url: current.url, commit: start.commit }, previous: start.previous, remoteAssetHashesVerified: Object.keys(current.files).length, fileCount: manifest.fileCount, bytes: manifest.bytes, preserved: manifest.preserved, pricingFilesPreserved: manifest.pricingFilesPreserved, gameFilesPreserved: manifest.gameFilesPreserved, pwaUnchanged: pwa.canonical_deployment.id, retiredCheckout302: true, checked };
fs.writeFileSync(work + '/live-verification.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, checked: checked.length }, null, 2));
