import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertNoPublicPriceText, checkPublicPrice, legacyPriceAssets, legacyPriceImageNames } from './public-price-check.mjs';
import { retainPreviousAssets } from './pages-release.mjs';
import { sha256 } from './release-guard.mjs';
const root = path.resolve(import.meta.dirname, '..');

async function temporary(action) {
  const dist = await mkdtemp(path.join(tmpdir(), 'tutor-public-price-'));
  try { return await action(dist); }
  finally {
    assert.equal(path.dirname(dist), path.resolve(tmpdir()));
    assert.ok(path.basename(dist).startsWith('tutor-public-price-'));
    await rm(dist, { recursive: true, force: true });
  }
}
const put = async (dist, name, text) => { const file = path.join(dist, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text); };

test('공개 약정액·홍보 가격은 잡고 내부 결제 필드와 개인정보 설명은 허용한다', () => {
  for (const text of ['시간당 50,000원', '월 80,000원', '950,000원', '할인 적용 수업', '무료 상담 신청', '\\uD560인 적용 수업']) assert.throws(() => assertNoPublicPriceText(text, '/assets/old.js'), /공개 가격/);
  assert.doesNotThrow(() => assertNoPublicPriceText('actualAmount refundAmount unitPrice 할인 이벤트 수강료 관리 무료상담 신청 0원으로 저장하면 환불 취소 수강료 안내 · 개별 공유용', 'teacher.js'));
});

test('개별 공유 가격은 PWA 전용 청크만 허용하고 공개 진입·사이트·사전 캐시에는 허용하지 않는다', async () => temporary(async dist => {
  const asset = 'assets/PricingPage-fixture.js';
  await put(dist, 'index.html', '<html>학생앱</html>');
  await put(dist, 'pricing.html', '<meta name="robots" content="noindex, nofollow"><meta http-equiv="refresh" content="0; url=/#/pricing">');
  await put(dist, 'sw.js', 'const precache = [];');
  await put(dist, asset, 'const price = "시간당 50,000원";');
  assert.deepEqual((await checkPublicPrice('pwa', { dist })).sharedPricingAssets, ['/' + asset]);
  await assert.rejects(checkPublicPrice('site', { dist }), /공개 가격/);
  await put(dist, 'assets/index-main.js', 'const price = "시간당 50,000원";');
  await assert.rejects(checkPublicPrice('pwa', { dist }), /공개 가격/);
  await put(dist, 'assets/index-main.js', 'const page = "수강료 안내 · 개별 공유용";');
  await put(dist, 'sw.js', `const precache = ['${asset}'];`);
  await assert.rejects(checkPublicPrice('pwa', { dist }), /설치 캐시/);
  await put(dist, 'sw.js', 'const precache = [];');
  await put(dist, 'pricing.html', '<meta http-equiv="refresh" content="0; url=/#/pricing">');
  await assert.rejects(checkPublicPrice('pwa', { dist }), /검색 제외/);
}));

test('새 HTML·JS·이미지 이름·인코딩 OG 참조와 과거 파일을 검사한다', async () => temporary(async dist => {
  await put(dist, 'index.html', '<html>공식 응대 09:00~23:00 · 100% 온라인</html>');
  await put(dist, 'assets/new.js', 'export const amount = payment.actualAmount;');
  assert.equal((await checkPublicPrice('pwa', { dist })).textFiles, 2);
  await put(dist, 'assets/new.js', 'const copied = "시간당 50,000원";');
  await assert.rejects(checkPublicPrice('pwa', { dist }), /공개 가격/);
  await put(dist, 'assets/new.js', 'export default {};');
  await put(dist, 'index.html', `<img src="/img/${encodeURIComponent(legacyPriceImageNames[0])}">`);
  await assert.rejects(checkPublicPrice('pwa', { dist }), /OG 이미지 참조/);
  await put(dist, 'index.html', '<html>수업 안내</html>');
  await put(dist, legacyPriceAssets[0].slice(1), 'old code');
  await assert.rejects(checkPublicPrice('pwa', { dist }), /기존 가격 번들/);
}));

test('구매 도메인의 공유 수강료는 전용 경로만 허용하고 홈페이지 링크·사이트맵·일반 번들 유입을 막는다', async () => temporary(async dist => {
  const asset = '/pricing/assets/pricing-fixture.js';
  await put(dist, 'index.html', '<html>공식 홈페이지</html>');
  await put(dist, 'pricing/index.html', `<meta name="robots" content="noindex, nofollow"><script type="module" src="${asset}"></script>`);
  await put(dist, '_headers', '/pricing/*\n  X-Robots-Tag: noindex, nofollow\n');
  await put(dist, asset, 'const price = "시간당 50,000원";');
  assert.deepEqual((await checkPublicPrice('site', { dist })).sharedPricingAssets, [asset]);
  await put(dist, 'index.html', '<a href="/pricing/">수강료 안내</a>');
  await assert.rejects(checkPublicPrice('site', { dist }), /경로를 노출/);
  await put(dist, 'index.html', '<html>공식 홈페이지</html>');
  await put(dist, 'sitemap.xml', '<loc>https://tiantianchinese.com/pricing/</loc>');
  await assert.rejects(checkPublicPrice('site', { dist }), /경로를 노출/);
  await put(dist, 'sitemap.xml', '<loc>https://tiantianchinese.com/lessons/</loc>');
  await put(dist, 'pricing/assets/vendor-fixture.js', 'const price = "시간당 50,000원";');
  await assert.rejects(checkPublicPrice('site', { dist }), /공개 가격/);
  await put(dist, 'pricing/assets/vendor-fixture.js', 'export default {};');
  await put(dist, '_headers', '/*\n  X-Content-Type-Options: nosniff\n');
  await assert.rejects(checkPublicPrice('site', { dist }), /검색 제외 헤더/);
  await put(dist, '_headers', '/pricing/*\n  X-Robots-Tag: noindex, nofollow\n');
  await put(dist, 'pricing/index.html', `<script type="module" src="${asset}"></script>`);
  await assert.rejects(checkPublicPrice('site', { dist }), /검색 제외 설정/);
}));

test('실제 운영·로컬 과거 번들은 다운로드하지 않고 제외하며 모르는 가격 번들도 보존 전에 막는다', async () => temporary(async dist => {
  const policy = JSON.parse(await readFile(path.join(root, '02_devtools/release-asset-policy.json'), 'utf8'));
  await put(dist, 'index.html', '<html>수업 안내</html>'); await put(dist, 'assets/new.js', 'new code');
  const previous = { url: 'https://old.example', files: Object.fromEntries(legacyPriceAssets.map(name => [name, 'old'])) };
  const retained = await retainPreviousAssets({ dist, previous, exclusions: policy.pwa, fetchImpl: async () => { throw new Error('제외 파일 요청 금지'); } });
  assert.deepEqual(Object.keys(retained.excluded).sort(), [...legacyPriceAssets].sort());
  previous.files = { '/assets/unknown-old.js': 'old' };
  await assert.rejects(retainPreviousAssets({ dist, previous, exclusions: policy.pwa, fetchImpl: async () => new Response('const x = "시간당 50,000원";', { headers: { 'content-type': 'application/javascript' } }) }), /공개 가격/);
  await assert.rejects(readFile(path.join(dist, 'assets/unknown-old.js')), /ENOENT/);
}));

test('수강료 페이지는 현재 빌드의 같은 청크를 유지하고 이전 버전만 보존에서 제외한다', async () => temporary(async dist => {
  const policy = JSON.parse(await readFile(path.join(root, '02_devtools/release-asset-policy.json'), 'utf8'));
  const currentName = '/assets/PricingPage-current.js', oldName = '/assets/PricingPage-old.js';
  const current = 'const price = "시간당 50,000원";';
  const hashes = { [currentName]: sha256(Buffer.from(current)), [oldName]: 'old' };
  await put(dist, currentName.slice(1), current);
  const previous = { url: 'https://old.example', files: { ...hashes, '/release-assets.json': 'manifest' } };
  const retained = await retainPreviousAssets({ dist, previous, exclusions: policy.pwa, fetchImpl: async url => {
    assert.equal(new URL(url).pathname, '/release-assets.json', '이전 수강료 청크를 내려받으면 안 된다');
    return new Response(JSON.stringify({ schema: 1, builtAssets: hashes }), { headers: { 'content-type': 'application/json' } });
  } });
  assert.deepEqual(Object.keys(retained.excluded), [oldName]);
  assert.equal(await readFile(path.join(dist, currentName), 'utf8'), current);
}));
