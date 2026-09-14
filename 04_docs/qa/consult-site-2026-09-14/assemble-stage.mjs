import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root = 'C:/development/TutorManager_For_Notion';
const work = path.join(root, '.tmp_qa/consult-site-release-20260914');
const record = JSON.parse(fs.readFileSync(path.join(work, 'candidate-baseline.json')));
const baseline = record.siteBaseline, stage = record.siteStage, build = path.join(work, 'site-build');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const inventory = dir => Object.fromEntries(walk(dir).map(f => ['/' + path.relative(dir, f).replaceAll('\\', '/'), sha(fs.readFileSync(f))]));
const original = record.siteFiles;
assert.deepEqual(inventory(baseline), original);
const manifestFile = path.join(work, 'stage-manifest.json');
assert.deepEqual(inventory(stage), fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile)).files : original);
const one = (html, re, label) => { const matches = [...html.matchAll(re)]; assert.equal(matches.length, 1, label); return matches[0][0]; };
const header = html => one(html, /<astro-island\b(?=[^>]*component-url="[^\"]*\/Header\.[^\"]+")[^>]*>[\s\S]*?<\/astro-island>/g, 'header');
const hero = html => one(html, /<astro-island\b(?=[^>]*component-url="[^\"]*\/Hero\.[^\"]+")[^>]*>[\s\S]*?<\/astro-island>/g, 'hero');
const footer = html => one(html, /<footer\b[^>]*>[\s\S]*?<\/footer>/g, 'footer');
const css = html => one(html, /<link\b[^>]*href="\/_astro\/Footer\.[^"]+\.css"[^>]*>/g, 'global CSS');
const main = html => one(html, /<main\b[^>]*>[\s\S]*?<\/main>/g, 'main');
const csp = html => one(html, /<meta\b(?=[^>]*http-equiv="content-security-policy")[^>]*>/g, 'CSP');
function carousel(html) {
  const opening = [...html.matchAll(/<div\b(?=[^>]*class="reviews-page__carousel")[^>]*>/g)];
  assert.equal(opening.length, 1, 'review carousel wrapper');
  const start = opening[0].index;
  let depth = 0;
  for (const match of html.slice(start).matchAll(/<\/?div\b[^>]*>/g)) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(start, start + match.index + match[0].length);
  }
  assert.fail('Unclosed review carousel wrapper');
}
const pending = new Map(), dependencies = new Set(), pages = [];
let reviewNavigationScriptHash;
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
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { assert.ok(original[name], 'Missing dependency ' + name); return; }
  dependencies.add(name);
  const bytes = fs.readFileSync(file);
  if (original[name]) assert.equal(sha(bytes), original[name], 'Unrelated asset changed: ' + name);
  else pending.set(name, bytes);
  if (/\.(?:js|css)$/.test(name)) collect(bytes.toString('utf8'), name);
}
function withoutHeaderActions(text) {
  return text.replace(/<a\b(?=[^>]*class="header__util[^\"]*")[^>]*>[\s\S]*?<\/a>/g, '').replace(/<a\b(?=[^>]*class="sheet__consult[^\"]*")[^>]*>[\s\S]*?<\/a>/g, '').replace(/<a\b(?=[^>]*href="\/contact\/")[^>]*>[\s\S]*?<\/a>/g, '');
}
function footerWithContact(old, next) {
  const originalFooter = footer(old);
  const nav = html => one(footer(html), /<nav\b(?=[^>]*class="[^\"]*\bfooter__right\b[^\"]*")[^>]*>[\s\S]*?<\/nav>/g, 'footer navigation');
  const originalNav = nav(old), updatedNav = nav(next);
  assert.ok(!originalNav.includes('href="/contact/"'), 'Contact already present in baseline footer');
  const contact = one(updatedNav, /<a\b(?=[^>]*href="\/contact\/")[^>]*>[\s\S]*?<\/a>/g, 'footer Contact link');
  assert.equal(contact, '<a href="/contact/">Contact</a>', 'Unexpected Contact footer link');
  assert.equal(updatedNav.replace(contact, ''), originalNav, 'Other footer navigation changed');
  return originalFooter.replace(originalNav, updatedNav);
}
const inner = island => island.slice(island.indexOf('>') + 1, island.lastIndexOf('</astro-island>'));
for (const name of Object.keys(original).filter(n => n.endsWith('.html'))) {
  const old = fs.readFileSync(baseline + name, 'utf8');
  if (!/component-url="[^\"]*\/Header\./.test(old)) continue;
  const next = fs.readFileSync(build + name, 'utf8');
  assert.equal((header(next).match(/href="\/contact\/"/g) || []).length, 2, 'PC and mobile Contact links required: ' + name);
  assert.equal(withoutHeaderActions(inner(header(next))), withoutHeaderActions(inner(header(old))), 'Header change beyond approved CTA: ' + name);
  const selectedFooter = footerWithContact(old, next);
  let selected = old.replace(header(old), header(next)).replace(css(old), css(next)).replace(footer(old), selectedFooter);
  let expectedBody = old.replace(footer(old), selectedFooter);
  if (name === '/index.html') {
    const profile = one(next, /<section\b(?=[^>]*class="[^\"]*\bteacher-profile\b[^\"]*")[^>]*>[\s\S]*?<\/section>/g, 'teacher profile section');
    const previousWhy = one(main(old), /<section class="section" style="padding-top: 0">(?:(?!<\/section>)[\s\S])*?<h2 class="t-h2">왜 하늘하늘 중국어인가<\/h2>(?:(?!<\/section>)[\s\S])*?<\/section>/g, 'original why section');
    assert.ok(!old.includes('id="teacher-profile"'), 'Teacher profile already present in baseline');
    assert.ok(profile.includes('id="teacher-profile"'), 'Integrated teacher profile anchor missing');
    assert.match(profile, /<h2\b[^>]*>왜 하늘하늘 중국어인가<\/h2>/, 'Integrated why heading missing');
    assert.equal((main(next).match(/id="teacher-profile"/g) || []).length, 1, 'Only one integrated teacher profile is allowed');
    assert.ok(!/<script\b|<astro-island\b/.test(profile), 'Teacher profile must remain static');
    assert.equal(main(next).replace(profile, '#TEACHER_WHY#').replace(hero(next), '#HERO#'), main(old).replace(previousWhy, '#TEACHER_WHY#').replace(hero(old), '#HERO#'), 'Home changes outside original why section');
    assert.equal(inner(hero(next)), inner(hero(old)), 'Hero SSR body changed');
    assert.ok(hero(old).includes('href="#learn-preview"'), 'Original Hero scroll target changed');
    selected = selected.replace(previousWhy, profile);
    expectedBody = expectedBody.replace(previousWhy, profile);
    const images = [...profile.matchAll(/<img\b[^>]*>/g)];
    assert.equal(images.length, 1, 'Exactly one teacher portrait is expected');
    const imageUrls = new Set();
    for (const attribute of images[0][0].matchAll(/\b(?:src|srcset)="([^\"]+)"/g)) {
      for (const item of attribute[1].split(',')) imageUrls.add(item.trim().split(/\s+/)[0]);
    }
    assert.equal(imageUrls.size, 3, 'Teacher portrait must include all three generated sizes');
    for (const url of imageUrls) {
      assert.match(url, /^\/_astro\/teacher-profile\.[\w-]+\.webp$/);
      depend(url);
    }
  }
  if (name === '/lessons/index.html') {
    const oldMain = main(old), newMain = main(next);
    const testimonial = one(oldMain, /<section\b[^>]*>(?:(?!<\/section>)[\s\S])*?<h2 class="t-h2">수강생이 말하는 하늘하늘<\/h2>(?:(?!<\/section>)[\s\S])*?<\/section>/g, 'lesson testimonial section');
    assert.ok(!newMain.includes('수강생이 말하는 하늘하늘'), 'New build still includes the removed testimonial section');
    const oldStart = oldMain.lastIndexOf('<section class="container"');
    const newStart = newMain.lastIndexOf('<section class="container"');
    assert.ok(oldStart > 0 && newStart > 0);
    const removedSteps = /<section class="section section--warm">(?:(?!<\/section>)[\s\S])*?이렇게 상담해요(?:(?!<\/section>)[\s\S])*?<\/section>/g;
    assert.equal((newMain.slice(0, newStart).match(removedSteps) || []).length, 1);
    const preservedPrefix = oldMain.slice(0, oldStart).replace(testimonial, '');
    assert.equal(newMain.slice(0, newStart).replace(removedSteps, ''), preservedPrefix, 'Other lesson body changed');
    const selectedMain = preservedPrefix + newMain.slice(newStart);
    assert.ok(!selectedMain.includes('이렇게 상담해요'));
    selected = selected.replace(oldMain, selectedMain);
    expectedBody = expectedBody.replace(oldMain, selectedMain);
  }
  if (name === '/reviews/index.html') {
    const reviewList = /<ul\b(?=[^>]*class="[^\"]*reviews-page__links[^\"]*")[^>]*>[\s\S]*?<\/ul>/g;
    const oldList = one(old, reviewList, 'original review list');
    const newList = one(next, reviewList, 'updated review list');
    const newCarousel = carousel(next);
    assert.ok(newCarousel.includes(newList));
    assert.equal(main(old).replace(oldList, '#REVIEW_CAROUSEL#'), main(next).replace(newCarousel, '#REVIEW_CAROUSEL#'), 'Review changes outside carousel');
    const reviewUrls = html => [...html.matchAll(/<a\b[^>]*href="([^\"]+)"[^>]*>/g)].map(m => m[1]);
    const imageUrls = html => [...html.matchAll(/<img\b[^>]*src="([^\"]+)"[^>]*>/g)].map(m => m[1]);
    assert.equal(reviewUrls(oldList).length, 3);
    assert.deepEqual(reviewUrls(newList), reviewUrls(oldList), 'Review article URLs changed');
    assert.equal(imageUrls(oldList).length, 3);
    assert.deepEqual(imageUrls(newList), imageUrls(oldList), 'Review thumbnail URLs changed');
    const fallback = /<script\b[^>]*>[^<]*reviews-page__thumb[^<]*<\/script>/g;
    assert.equal(one(next, fallback, 'updated image fallback'), one(old, fallback, 'original image fallback'), 'Image fallback behavior changed');
    const scripts = html => [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(m => !/\bsrc=/.test(m[1]) && m[2]);
    const oldScripts = scripts(old), newScripts = scripts(next);
    for (const script of oldScripts) assert.ok(newScripts.some(m => m[0] === script[0]), 'Existing review script changed');
    const additions = newScripts.filter(script => !oldScripts.some(m => m[0] === script[0]));
    assert.equal(additions.length, 1, 'Exactly one carousel behavior script is allowed');
    const navigationScript = additions[0];
    assert.ok(navigationScript[2].includes('reviews-page__carousel') && navigationScript[2].includes('scrollBy'), 'Unexpected added review script');
    const scriptHash = "'sha256-" + crypto.createHash('sha256').update(navigationScript[2]).digest('base64') + "'";
    reviewNavigationScriptHash = scriptHash;
    assert.ok(csp(next).includes(scriptHash), 'Astro CSP does not authorize its carousel script');
    const oldCsp = csp(old);
    assert.equal((oldCsp.match(/script-src [^;]+/g) || []).length, 1);
    const selectedCsp = oldCsp.replace(/script-src [^;]+/, directive => directive + ' ' + scriptHash);
    selected = selected.replace(oldList, newCarousel).replace(oldCsp, selectedCsp) + navigationScript[0];
    expectedBody = expectedBody.replace(oldList, newCarousel).replace(oldCsp, selectedCsp) + navigationScript[0];
  }
  const scrub = h => h.replace(header(h), '#HEADER#').replace(css(h), '#CSS#');
  assert.equal(scrub(selected), scrub(expectedBody), 'Other HTML changed: ' + name);
  assert.equal(footer(selected), selectedFooter);
  pending.set(name, Buffer.from(selected));
  collect(header(next), name); collect(css(next), name);
  pages.push(name);
}
const newContact = fs.readFileSync(path.join(build, 'contact/index.html'), 'utf8');
const newConsult = fs.readFileSync(path.join(build, 'consult/index.html'), 'utf8');
assert.ok(reviewNavigationScriptHash);
const consultCsp = csp(newConsult);
const styleHashes = html => [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(match => "'sha256-" + crypto.createHash('sha256').update(match[1]).digest('base64') + "'");
let selectedConsultCsp = consultCsp.replace(' ' + reviewNavigationScriptHash, '');
const consultStyleHashes = new Set(styleHashes(newConsult));
for (const hash of styleHashes(newContact)) {
  if (!consultStyleHashes.has(hash)) selectedConsultCsp = selectedConsultCsp.replace(' ' + hash, '');
}
const baselineLessons = fs.readFileSync(path.join(baseline, 'lessons/index.html'), 'utf8');
const selectedConsult = newConsult.replace(footer(newConsult), footerWithContact(baselineLessons, newConsult))
  .replace(consultCsp, selectedConsultCsp);
pending.set('/consult/index.html', Buffer.from(selectedConsult));
collect(selectedConsult, '/consult/index.html');
assert.equal((header(newContact).match(/href="\/contact\/"/g) || []).length, 2, 'Contact page navigation missing');
const contactCsp = csp(newContact);
const selectedContact = newContact.replace(footer(newContact), footerWithContact(baselineLessons, newContact))
  .replace(contactCsp, contactCsp.replace(' ' + reviewNavigationScriptHash, ''));
pending.set('/contact/index.html', Buffer.from(selectedContact));
collect(selectedContact, '/contact/index.html');
const sitemap = fs.readFileSync(path.join(baseline, 'sitemap-0.xml'), 'utf8');
assert.ok(!sitemap.includes('/consult/') && !sitemap.includes('/contact/'));
pending.set('/sitemap-0.xml', Buffer.from(sitemap.replace('</urlset>', '<url><loc>https://tiantianchinese.com/consult/</loc></url><url><loc>https://tiantianchinese.com/contact/</loc></url></urlset>')));
for (const [name, bytes] of pending) {
  const file = path.resolve(stage, '.' + name); assert.ok(file.startsWith(path.resolve(stage) + path.sep));
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes);
}
const files = inventory(stage), changed = Object.keys(original).filter(n => files[n] !== original[n]);
assert.deepEqual(changed.sort(), [...pages, '/sitemap-0.xml'].sort());
const protectedFiles = Object.keys(original).filter(n => n.startsWith('/pricing/') || n.startsWith('/game/tone/'));
for (const name of protectedFiles) assert.equal(files[name], original[name]);
const sources = {};
for (const name of ['site/src/config.js', 'site/src/components/Header.jsx', 'site/src/styles/global.css', 'site/src/pages/index.astro', 'site/src/assets/teacher-profile.jpg', 'site/src/pages/lessons.astro', 'site/src/pages/reviews.astro', 'site/src/pages/consult.astro', 'site/src/components/ConsultForm.jsx', 'site/src/styles/consult.css', 'site/src/pages/contact.astro', 'site/src/components/ContactForm.jsx', 'site/src/styles/contact.css']) sources[name] = sha(fs.readFileSync(path.join(root, name)));
const result = { preparedAt: new Date().toISOString(), baselineDeployment: '014aca80-27f4-494e-9352-d523ced901f2', baselineFiles: record.siteFileCount, fileCount: Object.keys(files).length, bytes: walk(stage).reduce((n,f)=>n+fs.statSync(f).size,0), changed, added: Object.keys(files).filter(n=>!original[n]), preserved: record.siteFileCount-changed.length, footerContactLinkAdded: true, footerOtherContentPreserved: true, homeHeroPreserved: true, teacherProfileInserted: true, lessonStepsExcluded: true, lessonTestimonialsRemoved: true, reviewCardListUpdated: true, reviewNavigationScriptAdded: true, pricingFilesPreserved: protectedFiles.filter(n=>n.startsWith('/pricing/')).length, gameFilesPreserved: protectedFiles.filter(n=>n.startsWith('/game/tone/')).length, dependencyClosure: [...dependencies], sources, files };
fs.writeFileSync(manifestFile, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, files: undefined }, null, 2));
