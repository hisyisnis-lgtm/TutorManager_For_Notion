import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertNoPublicPriceText, checkPublicPrice, legacyPriceAssets, legacyPriceImageNames } from './public-price-check.mjs';
import { retainPreviousAssets } from './pages-release.mjs';
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
  for (const text of ['시간당 50,000원', '월 80,000원', '950,000원', '할인 적용 수업', '무료 상담 신청', '\\uC218강료 안내']) assert.throws(() => assertNoPublicPriceText(text, '/assets/old.js'), /공개 가격/);
  assert.doesNotThrow(() => assertNoPublicPriceText('actualAmount refundAmount unitPrice 할인 이벤트 수강료 관리 무료상담 신청 0원으로 저장하면 환불 취소', 'teacher.js'));
});

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
