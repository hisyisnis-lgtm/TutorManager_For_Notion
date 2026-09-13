// 공개 배포물의 기존 가격 안내 재노출을 막는다. 인증된 개인 내역의 동적 숫자는 검사 대상이 아니다.
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
  const forbidden = /수강료 안내|할인 적용 수업|완전 무료|무료 플레이|무료 상담 신청|30분 무료 상담|출간 일정과 가격|상품 구성과 가격|총 결제금액|테스트 결제|(?:[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{3,})\s*원/;
  assert.ok(!forbidden.test(decoded), `${name}: 공개 가격 안내가 남아 있습니다. 이전 자산이라면 제외 정책에 명시해 주세요.`);
}

export async function checkPublicPrice(target, { root = ROOT, dist = path.join(root, TARGETS[target]?.dist || '') } = {}) {
  assert.ok(['pwa', 'site'].includes(target), '검사 대상은 pwa 또는 site입니다.');
  const files = await inventory(dist);
  const textFiles = Object.keys(files).filter(name => /\.(?:html|js|json)$/.test(name));
  assert.ok(textFiles.length > 0, '공개 배포물이 없습니다. 먼저 빌드해 주세요.');
  for (const name of Object.keys(files)) {
    assert.ok(!legacyPriceAssets.includes(name), `${name}: 기존 가격 번들이 남아 있습니다.`);
    assert.ok(!legacyPriceImageNames.some(image => name.endsWith(`/${image}`)), `${name}: 기존 가격 관련 OG 이미지가 남아 있습니다.`);
    assert.ok(!legacyPriceImageHashes.has(files[name]), `${name}: 이름이 바뀐 기존 가격 OG 이미지가 남아 있습니다.`);
  }
  for (const name of textFiles) {
    const text = await readFile(safeFile(dist, name), 'utf8');
    assertNoPublicPriceText(text, name);
    assert.ok(!legacyPriceImageNames.some(image => text.includes(image) || text.includes(encodeURIComponent(image))), `${name}: 기존 OG 이미지 참조가 남아 있습니다.`);
  }
  return { target, textFiles: textFiles.length, files: Object.keys(files).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkPublicPrice(process.argv[2]).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
