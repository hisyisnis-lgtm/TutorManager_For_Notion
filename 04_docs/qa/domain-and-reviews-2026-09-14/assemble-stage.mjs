import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const root = 'C:/development/TutorManager_For_Notion';
const work = path.join(root, '.tmp_qa/pricing-domain-release-20260914');
const baseline = path.join(root, '.tmp_qa/game-toast-release-20260911/site-staging');
const stage = path.join(work, 'site-staging');
const build = path.join(work, 'site-build');
const pricing = path.join(root, '99_external/pwa-live-service-release-20260913/pwa/dist-pricing');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const inventory = dir => Object.fromEntries(walk(dir).map(file => ['/' + path.relative(dir, file).replaceAll('\\', '/'), sha(fs.readFileSync(file))]));
const original = inventory(baseline);
const before = inventory(stage);
const priorPath = path.join(work, 'stage-manifest.json');
const prior = fs.existsSync(priorPath) ? JSON.parse(fs.readFileSync(priorPath, 'utf8')) : null;
assert.equal(Object.keys(original).length, 920);
assert.deepEqual(before, prior?.filesSha256 || original, 'Stage changed outside this assembly script');
assert.ok(fs.existsSync(path.join(build, 'reviews/index.html')), 'Reviews build is not ready');

const pending = new Map();
const dependencies = new Set();
const retiredCheckout = '/_astro/WorkbookCheckout.R5WACr9n.js';
const retired = new Set([retiredCheckout]);
const copyRules = {
  '/books/index.html': ['출간 일정과 가격', '출간 일정', 1],
  '/books/pronunciation-workbook/index.html': ['출간 일정과 가격', '출간 일정', 3],
  '/game/index.html': ['PC · 모바일 · 무료 플레이', 'PC · 모바일', 1],
};
const copyChanges = [];
const headerIsland = html => [...html.matchAll(/<astro-island\b[^>]*>[\s\S]*?<\/astro-island>/g)].filter(m => /component-url="[^\"]*\/Header\.[^\"]+"/.test(m[0]));
const footer = html => [...html.matchAll(/<footer\b[^>]*>[\s\S]*?<\/footer>/g)];
const footerNav = html => html.match(/<nav\b(?=[^>]*\bclass="footer__right[^\"]*")[^>]*>[\s\S]*?<\/nav>/)?.[0];
const stripReviews = html => html.replace(/<a\b(?=[^>]*\bhref="\/reviews\/")[^>]*>[\s\S]*?<\/a>/g, '');
const innerIsland = html => html.slice(html.indexOf('>') + 1, html.lastIndexOf('</astro-island>'));
const removeNavigation = html => {
  let result = html;
  for (const match of [...headerIsland(html), ...footer(html)]) result = result.replace(match[0], '');
  return result;
};
function put(name, bytes) {
  const value = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (pending.has(name)) assert.equal(sha(pending.get(name)), sha(value), `Conflicting staged content: ${name}`);
  pending.set(name, value);
}
function depend(name) {
  if (dependencies.has(name)) return;
  const file = path.resolve(build, '.' + name);
  assert.ok(file.startsWith(path.resolve(build) + path.sep), `Dependency outside build: ${name}`);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return;
  assert.ok(!retired.has(name), `New page still references retired price asset: ${name}`);
  dependencies.add(name);
  const bytes = fs.readFileSync(file);
  if (Object.hasOwn(original, name)) assert.equal(sha(bytes), original[name], `Build would overwrite unrelated existing asset: ${name}`);
  else put(name, bytes);
  if (/\.(?:js|css|html)$/.test(name)) collect(bytes.toString('utf8'), name);
}
function collect(text, source) {
  for (const match of text.matchAll(/["'`](\/[^"'`<>\s]+|\.{1,2}\/[^"'`<>\s]+)["'`]/g)) {
    const raw = match[1].split(/[?#]/)[0];
    const name = raw.startsWith('/') ? raw : path.posix.resolve(path.posix.dirname(source), raw);
    if (/\.(?:js|css|png|webp|jpg|jpeg|svg|woff2?|ttf|avif)$/.test(name)) depend(name);
  }
  for (const match of text.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) {
    if (/^(?:data:|https?:|#)/.test(match[1])) continue;
    const raw = match[1].split(/[?#]/)[0];
    depend(raw.startsWith('/') ? raw : path.posix.resolve(path.posix.dirname(source), raw));
  }
}

const navigation = [];
let commonFooter;
for (const name of Object.keys(original).filter(name => name.endsWith('.html'))) {
  const old = fs.readFileSync(baseline + name, 'utf8');
  const oldHeaders = headerIsland(old);
  if (!oldHeaders.length) continue;
  assert.equal(oldHeaders.length, 1, `Unexpected Header count: ${name}`);
  const next = fs.readFileSync(build + name, 'utf8');
  const nextHeaders = headerIsland(next);
  assert.equal(nextHeaders.length, 1, `New Header missing: ${name}`);
  assert.ok(stripReviews(innerIsland(nextHeaders[0][0])) === innerIsland(oldHeaders[0][0]), `Header change exceeds reviews navigation: ${name}`);
  const oldFooters = footer(old), nextFooters = footer(next);
  assert.equal(oldFooters.length, 1);
  assert.equal(nextFooters.length, 1);
  const oldNav = footerNav(oldFooters[0][0]), newNav = footerNav(nextFooters[0][0]);
  assert.ok(oldNav && newNav);
  assert.ok(stripReviews(newNav) === oldNav, `Footer navigation change exceeds reviews link: ${name}`);
  const selectedFooter = oldFooters[0][0].replace(oldNav, newNav);
  assert.ok(stripReviews(selectedFooter) === oldFooters[0][0], `Unrelated Footer content changed: ${name}`);
  commonFooter ??= selectedFooter;
  let result = old.replace(oldHeaders[0][0], nextHeaders[0][0]).replace(oldFooters[0][0], selectedFooter);
  let expectedBody = removeNavigation(old);
  if (copyRules[name]) {
    const [from, to, count] = copyRules[name];
    assert.equal(result.split(from).length - 1, count, `Unexpected retired-copy count: ${name}`);
    result = result.replaceAll(from, to);
    expectedBody = expectedBody.replaceAll(from, to);
    copyChanges.push({ path: name, from, to, occurrences: count, previousSha256: original[name] });
  }
  assert.equal(removeNavigation(result), expectedBody, `Existing page outside navigation and approved copy changed: ${name}`);
  put(name, result);
  collect(nextHeaders[0][0], name);
  collect(selectedFooter, name);
  navigation.push({ path: name, mainAndOtherHtmlUnchangedExceptApprovedCopy: true, headerOnlyReviewsAdded: true, footerOnlyReviewsAdded: true });
}

let reviewHtml = fs.readFileSync(path.join(build, 'reviews/index.html'), 'utf8');
assert.equal(footer(reviewHtml).length, 1);
reviewHtml = reviewHtml.replace(footer(reviewHtml)[0][0], commonFooter);
put('/reviews/index.html', reviewHtml);
collect(reviewHtml.toString('utf8'), '/reviews/index.html');
const oldMap = fs.readFileSync(path.join(baseline, 'sitemap-0.xml'), 'utf8');
const reviewEntry = '<url><loc>https://tiantianchinese.com/reviews/</loc></url>';
assert.ok(!oldMap.includes('/reviews/'));
put('/sitemap-0.xml', oldMap.replace('</urlset>', reviewEntry + '</urlset>'));
const oldHeaders = fs.readFileSync(path.join(baseline, '_headers'), 'utf8');
put('/_headers', oldHeaders + '\n# Directly shared tuition page is excluded from search.\n/pricing\n  X-Robots-Tag: noindex, nofollow\n\n/pricing/*\n  X-Robots-Tag: noindex, nofollow\n');
const oldRedirects = fs.existsSync(path.join(baseline, '_redirects')) ? fs.readFileSync(path.join(baseline, '_redirects'), 'utf8') : '';
put('/_redirects', retiredCheckout + ' /books/ 302\n' + oldRedirects);
for (const file of walk(pricing)) {
  const name = '/pricing/' + path.relative(pricing, file).replaceAll('\\', '/');
  assert.ok(!Object.hasOwn(original, name));
  put(name, fs.readFileSync(file));
}

// All source checks finish before replacing any baseline page.
for (const name of retired) {
  assert.ok(Object.hasOwn(original, name), `Retired asset missing from the known baseline: ${name}`);
  const file = path.resolve(stage, '.' + name);
  assert.ok(file.startsWith(path.resolve(stage) + path.sep));
  if (fs.existsSync(file)) {
    assert.equal(sha(fs.readFileSync(file)), original[name]);
    fs.unlinkSync(file);
  }
}
for (const name of prior?.added || []) {
  if (pending.has(name)) continue;
  assert.ok(!Object.hasOwn(original, name));
  const file = path.resolve(stage, '.' + name);
  assert.ok(file.startsWith(path.resolve(stage) + path.sep));
  assert.equal(sha(fs.readFileSync(file)), prior.filesSha256[name]);
  fs.unlinkSync(file);
}
for (const [name, bytes] of pending) {
  fs.mkdirSync(path.dirname(stage + name), { recursive: true });
  fs.writeFileSync(stage + name, bytes);
}
const final = inventory(stage);
const allowed = new Set([...navigation.map(n => n.path), '/sitemap-0.xml', '/_headers', '/_redirects']);
const changed = Object.keys(original).filter(name => Object.hasOwn(final, name) && original[name] !== final[name]);
for (const name of Object.keys(original)) {
  if (retired.has(name)) { assert.ok(!Object.hasOwn(final, name)); continue; }
  assert.ok(Object.hasOwn(final, name), `Deleted baseline file: ${name}`);
  if (!allowed.has(name)) assert.equal(final[name], original[name], `Unexpected baseline change: ${name}`);
}
const game = Object.keys(original).filter(name => name.startsWith('/game/tone/'));
for (const name of game) assert.equal(final[name], original[name]);
assert.equal(final['/robots.txt'], original['/robots.txt']);
assert.equal(final['/sitemap-index.xml'], original['/sitemap-index.xml']);
const summary = {
  baselineDeployment: '03f92a8a-b9b0-4aca-ad0e-4f0bd8c5a3e4', baselineFiles: 920,
  files: Object.keys(final).length, bytes: walk(stage).reduce((total, f) => total + fs.statSync(f).size, 0),
  changed, added: Object.keys(final).filter(name => !Object.hasOwn(original, name)),
  removed: [...retired].map(name => ({ path: name, previousSha256: original[name], redirect: '/books/', status: 302, reason: 'Unreferenced legacy checkout chunk contains total-payment and test-payment copy.' })),
  approvedCopyChanges: copyChanges,
  navigation, dependencyClosure: [...dependencies], gameFilesUnchanged: game.length,
  unchangedBaselineFiles: 920 - changed.length - retired.size, robotsUnchanged: true, sitemapAddedOnlyReviews: true,
  filesSha256: final,
};
fs.writeFileSync(path.join(work, 'stage-manifest.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ ...summary, filesSha256: undefined }, null, 2));
