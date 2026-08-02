import { describe, it, expect } from 'vitest';
import { scaleFor, compressImage } from './imageCompress.js';

describe('scaleFor — 장변 축소 비율', () => {
  it('장변이 상한보다 작으면 축소하지 않는다', () => {
    expect(scaleFor(800, 600)).toBe(1);
    expect(scaleFor(1600, 1200)).toBe(1);
  });

  it('가로가 긴 사진은 가로 기준으로 줄인다', () => {
    expect(scaleFor(3200, 2400)).toBe(0.5);
  });

  it('세로가 긴 사진은 세로 기준으로 줄인다 (폰 세로 촬영)', () => {
    expect(scaleFor(2400, 3200)).toBe(0.5);
  });

  it('잘못된 값은 1로 처리해 원본을 유지한다', () => {
    expect(scaleFor(0, 0)).toBe(1);
    expect(scaleFor(NaN, NaN)).toBe(1);
  });

  it('maxEdge를 바꾸면 그 기준으로 계산한다', () => {
    expect(scaleFor(2000, 1000, 1000)).toBe(0.5);
  });
});

describe('compressImage — 압축 대상 판정', () => {
  const fakeFile = (name, type, size) => ({ name, type, size });

  it('PDF는 손대지 않는다', async () => {
    const f = fakeFile('숙제.pdf', 'application/pdf', 8 * 1024 * 1024);
    expect(await compressImage(f)).toBe(f);
  });

  it('GIF는 애니메이션이 죽으므로 제외', async () => {
    const f = fakeFile('a.gif', 'image/gif', 8 * 1024 * 1024);
    expect(await compressImage(f)).toBe(f);
  });

  it('1MB 이하 사진은 재인코딩하지 않는다', async () => {
    const f = fakeFile('small.jpg', 'image/jpeg', 500 * 1024);
    expect(await compressImage(f)).toBe(f);
  });

  it('파일이 없으면 그대로 반환 (호출부에서 방어 불필요)', async () => {
    expect(await compressImage(null)).toBe(null);
  });
});
