import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const work = 'C:/development/TutorManager_For_Notion/.tmp_qa/consult-site-release-20260914';
const manifest = JSON.parse(fs.readFileSync(work + '/stage-manifest.json'));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function decodeEmail(hex) {
  const bytes = Buffer.from(hex, 'hex');
  const email = Buffer.from(bytes.subarray(1).map(value => value ^ bytes[0])).toString('utf8');
  assert.equal(email, 'tiantianchinese_@naver.com');
  return email;
}
function normalizeCloudflareEmail(html) {
  return html
    .replace(/href="\/cdn-cgi\/l\/email-protection#([a-f0-9]+)"/g, (_, hex) => `href="mailto:${decodeEmail(hex)}"`)
    .replace(/<span class="__cf_email__" data-cfemail="([a-f0-9]+)">\[email&#160;protected\]<\/span>/g, (_, hex) => decodeEmail(hex))
    .replace('<script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script>', '');
}
const routes = ['/', '/contact/', '/consult/', '/reviews/', '/games/tone/', '/lessons/', '/pricing/', '/game/tone/'];
const results = await Promise.all(routes.map(async route => {
  const response = await fetch('https://tiantianchinese.com' + route, { headers: { 'Cache-Control': 'no-cache' } });
  const bytes = Buffer.from(await response.arrayBuffer());
  const expected = manifest.files[route + 'index.html'];
  const normalized = normalizeCloudflareEmail(bytes.toString('utf8'));
  return { route, status: response.status, hash: digest(bytes), expected, exactMatch: digest(bytes) === expected, normalizedMatch: digest(normalized) === expected };
}));
const report = { checkedAt: new Date().toISOString(), commit: '78d5c5264cf8e7f9db03c50884b142353807d9d6', deployment: 'https://54bed96a.tiantianchinese.pages.dev', normalization: 'Only the observed Cloudflare business-email obfuscation and its decoder script are reversed; decoded email is asserted.', results };
fs.writeFileSync(work + '/site-live-check.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
assert.ok(results.every(result => result.status === 200 && result.normalizedMatch), 'Live content mismatch');
