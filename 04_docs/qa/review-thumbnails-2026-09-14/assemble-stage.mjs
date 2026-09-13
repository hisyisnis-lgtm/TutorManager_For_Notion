import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const root = 'C:/development/TutorManager_For_Notion';
const work = path.join(root, '.tmp_qa/reviews-thumbnails-release-20260914');
const build = path.join(root, '.tmp_qa/review-thumbnails-20260914/site-build');
const record = JSON.parse(fs.readFileSync(path.join(work, 'production-baseline.json')));
const { baseline, stage } = record;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const inventory = dir => Object.fromEntries(walk(dir).map(f => ['/' + path.relative(dir, f).replaceAll('\\', '/'), sha(fs.readFileSync(f))]));
assert.deepEqual(inventory(baseline), record.files);
const previousManifest = path.join(work, 'stage-manifest.json');
assert.deepEqual(inventory(stage), fs.existsSync(previousManifest) ? JSON.parse(fs.readFileSync(previousManifest)).files : record.files);
const old = fs.readFileSync(path.join(baseline, 'reviews/index.html'), 'utf8');
const next = fs.readFileSync(path.join(build, 'reviews/index.html'), 'utf8');
const one = (html, regex, name) => { const matches = [...html.matchAll(regex)]; assert.equal(matches.length, 1, name); return matches[0][0]; };
const main = /<main\b[^>]*>[\s\S]*?<\/main>/g;
const csp = /<meta\b(?=[^>]*http-equiv="content-security-policy")[^>]*>/g;
const css = /<link\b[^>]*href="\/_astro\/Footer\.[^"]+\.css"[^>]*>/g;
const oldMain = one(old, main, 'old main'), newMain = one(next, main, 'new main');
const oldCsp = one(old, csp, 'old CSP'), newCsp = one(next, csp, 'new CSP');
const oldCss = one(old, css, 'old CSS'), newCss = one(next, css, 'new CSS');
const fallback = one(next, /<script\b[^>]*>[^<]*reviews-page__thumb[^<]*<\/script>/g, 'image fallback script');
assert.equal((newMain.match(/class="reviews-page__thumb"/g) || []).length, 3);
assert.equal((newMain.match(/src="https:\/\/tutor-manager-proxy\.hisyisnis\.workers\.dev\/og-proxy\/image\?/g) || []).length, 3);
assert.ok(!newCsp.includes("script-src 'unsafe-inline'"));
for (const m of oldCsp.matchAll(/'sha256-[^']+'/g)) assert.ok(newCsp.includes(m[0]), 'Existing inline script/style hash lost');
let selected = old.replace(oldMain, newMain).replace(oldCsp, newCsp).replace(oldCss, newCss);
selected += fallback;
const untouched = html => html.replace(one(html, main, 'selected main'), '#MAIN#').replace(one(html, csp, 'selected CSP'), '#CSP#').replace(one(html, css, 'selected CSS'), '#CSS#');
assert.equal(untouched(selected.replace(fallback, '')), untouched(old));
assert.equal(one(selected, /<footer\b[^>]*>[\s\S]*?<\/footer>/g, 'selected footer'), one(old, /<footer\b[^>]*>[\s\S]*?<\/footer>/g, 'old footer'));
const pending = new Map([['/reviews/index.html', Buffer.from(selected)]]);
const dependencies = new Set();
function collect(text, source) {
  for (const m of text.matchAll(/["'`](\/[^"'`<>\s]+|\.{1,2}\/[^"'`<>\s]+)["'`]/g)) {
    const raw = m[1].split(/[?#]/)[0];
    const name = raw.startsWith('/') ? raw : path.posix.resolve(path.posix.dirname(source), raw);
    if (/\.(?:js|css|png|webp|jpg|jpeg|svg|woff2?|ttf|avif)$/.test(name)) depend(name);
  }
  for (const m of text.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) {
    if (/^(?:data:|https?:|#)/.test(m[1])) continue;
    depend(m[1].startsWith('/') ? m[1] : path.posix.resolve(path.posix.dirname(source), m[1]));
  }
}
function depend(name) {
  if (dependencies.has(name)) return;
  const file = path.resolve(build, '.' + name);
  assert.ok(file.startsWith(path.resolve(build) + path.sep));
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return;
  dependencies.add(name);
  const bytes = fs.readFileSync(file);
  if (record.files[name]) assert.equal(sha(bytes), record.files[name], 'Unrelated asset replacement: ' + name);
  else pending.set(name, bytes);
  if (/\.(?:js|css)$/.test(name)) collect(bytes.toString('utf8'), name);
}
collect(selected, '/reviews/index.html');
for (const [name, bytes] of pending) {
  const file = path.resolve(stage, '.' + name);
  assert.ok(file.startsWith(path.resolve(stage) + path.sep));
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes);
}
const files = inventory(stage);
const changed = Object.keys(record.files).filter(name => files[name] !== record.files[name]);
assert.deepEqual(changed, ['/reviews/index.html']);
const added = Object.keys(files).filter(name => !record.files[name]);
assert.equal(added.length, 1);
assert.match(added[0], /^\/_astro\/Footer\.[^/]+\.css$/);
for (const name of Object.keys(record.files).filter(n => n.startsWith('/pricing/') || n.startsWith('/game/tone/'))) assert.equal(files[name], record.files[name]);
const sources = {};
for (const name of ['site/src/pages/reviews.astro', 'site/src/styles/global.css']) sources[name] = sha(fs.readFileSync(path.join(root, name)));
const result = {
  preparedAt: new Date().toISOString(), baselineDeployment: record.deploymentId,
  baselineFiles: record.count, fileCount: Object.keys(files).length,
  bytes: walk(stage).reduce((n, f) => n + fs.statSync(f).size, 0), changed, added,
  preserved: record.count - changed.length, footerPreserved: true,
  pricingFilesPreserved: Object.keys(record.files).filter(n => n.startsWith('/pricing/')).length,
  gameFilesPreserved: Object.keys(record.files).filter(n => n.startsWith('/game/tone/')).length,
  dependencyClosure: [...dependencies], sources, files,
};
fs.writeFileSync(previousManifest, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, files: undefined }, null, 2));
