// 일반 공개 배포물의 가격 재노출을 막는다. 강사가 개별 공유하는 전용 수강료 청크만 허용한다.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, TARGETS, inventory, safeFile } from './release-guard.mjs';

export const legacyPriceAssets = [
  '/assets/index-Dgh3ZfNf.js', // 확인한 운영 공개 번들
  '/assets/index-kC_0tvip.js', // 정리 직전 로컬 공개 번들
];
export const legacyPriceImageNames = [
  '카카오톡링크미리보기이미지_수강료안내.png',
  '카카오톡링크미리보기이미지_소개및무료상담신청.png',
];
const legacyPriceImageHashes = new Set([
  '5b4e0f1e08bb143690bb1e75905f95e55bdae1ba063013c36be543d0426f19f2',
  '96c8137683cceb8372baeff79c848108042af1a2d017b414b5056009b2e3435d',
]);

export function assertNoPublicPriceText(text, name) {
  const decoded = text.replace(/\\u([\da-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replaceAll('&amp;', '&');
  // 강사 업무명 '무료상담 신청', 개인정보처리방침의 수강료 관리 설명은 유지한다.
  const forbidden = /할인 적용 수업|완전 무료|무료 플레이|무료 상담 신청|30분 무료 상담|출간 일정과 가격|상품 구성과 가격|총 결제금액|테스트 결제|(?:[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{3,})\s*원/;
  assert.ok(!forbidden.test(decoded), `${name}: 공개 가격 안내가 남아 있습니다. 이전 자산이라면 제외 정책에 명시해 주세요.`);
}

export async function checkPublicPrice(target, { root = ROOT, dist = path.join(root, TARGETS[target]?.dist || '') } = {}) {
  assert.ok(['pwa', 'site'].includes(target), '검사 대상은 pwa 또는 site입니다.');
  const files = await inventory(dist);
  const textFiles = Object.keys(files).filter(name => /\.(?:html|js|json|xml)$/.test(name));
  assert.ok(textFiles.length > 0, '공개 배포물이 없습니다. 먼저 빌드해 주세요.');
  const sharedPricingAssets = textFiles.filter(name => target === 'pwa'
    ? /^\/assets\/PricingPage-[A-Za-z0-9_-]+\.js$/.test(name)
    : /^\/pricing\/assets\/pricing-[A-Za-z0-9_-]+\.js$/.test(name));
  assert.ok(sharedPricingAssets.length <= 1, '이전 수강료 안내 청크를 함께 배포할 수 없습니다.');
  if (target === 'pwa' && sharedPricingAssets.length) {
    const wrapper = await readFile(safeFile(dist, '/pricing.html'), 'utf8');
    assert.match(wrapper, /<meta\s+name=["']robots["']\s+content=["']noindex,\s*nofollow["']/i, '개별 공유 수강료 페이지에 검색 제외 설정이 필요합니다.');
    assert.match(wrapper, /url=\/#\/pricing/i, '수강료 공유 주소가 해당 화면으로 연결되어야 합니다.');
    const sw = await readFile(safeFile(dist, '/sw.js'), 'utf8');
    const entry = await readFile(safeFile(dist, '/index.html'), 'utf8');
    for (const asset of sharedPricingAssets) {
      assert.ok(!sw.includes(path.basename(asset)), '수강료 안내를 일반 앱 설치 캐시에 미리 저장할 수 없습니다.');
      assert.ok(!entry.includes(asset), '수강료 안내를 일반 진입 HTML에서 미리 불러올 수 없습니다.');
    }
  }
  if (target === 'site' && sharedPricingAssets.length) {
    const entry = await readFile(safeFile(dist, '/pricing/index.html'), 'utf8');
    assert.match(entry, /<meta\s+name=["']robots["']\s+content=["']noindex,\s*nofollow["']/i, '개별 공유 수강료 페이지에 검색 제외 설정이 필요합니다.');
    assert.ok(entry.includes(sharedPricingAssets[0]), '수강료 전용 진입 HTML에서 해당 청크를 불러와야 합니다.');
    const headers = await readFile(safeFile(dist, '/_headers'), 'utf8');
    assert.match(headers, /(?:^|\n)\/pricing\/\*\r?\n\s+X-Robots-Tag:\s*noindex,\s*nofollow/i, '수강료 경로에 검색 제외 헤더가 필요합니다.');
  }
  for (const name of Object.keys(files)) {
    assert.ok(!legacyPriceAssets.includes(name), `${name}: 기존 가격 번들이 남아 있습니다.`);
    assert.ok(!legacyPriceImageNames.some(image => name.endsWith(`/${image}`)), `${name}: 기존 가격 관련 OG 이미지가 남아 있습니다.`);
    assert.ok(!legacyPriceImageHashes.has(files[name]), `${name}: 이름이 바뀐 기존 가격 OG 이미지가 남아 있습니다.`);
  }
  for (const name of textFiles) {
    const text = await readFile(safeFile(dist, name), 'utf8');
    if (!sharedPricingAssets.includes(name)) assertNoPublicPriceText(text, name);
    if (target === 'site' && !name.startsWith('/pricing/')) {
      assert.ok(!text.includes('/pricing/') && !/(?:href|src)=["'](?:https:\/\/tiantianchinese\.com)?\/pricing(?:["'#?]|\s)/i.test(text), `${name}: 공식 홈페이지·게임·사이트맵에서 개별 공유 수강료 경로를 노출할 수 없습니다.`);
    }
    assert.ok(!legacyPriceImageNames.some(image => text.includes(image) || text.includes(encodeURIComponent(image))), `${name}: 기존 OG 이미지 참조가 남아 있습니다.`);
  }
  return { target, textFiles: textFiles.length, files: Object.keys(files).length, sharedPricingAssets };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkPublicPrice(process.argv[2]).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
