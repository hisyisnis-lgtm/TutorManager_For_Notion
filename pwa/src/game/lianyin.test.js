import { describe, it, expect } from 'vitest';
import { findLianyin, findToneSandhi } from './lianyin.js';

describe('findLianyin', () => {
  it('인접한 3성+2성이면 첫 3성 인덱스', () => {
    expect(findLianyin([3, 2])).toBe(0);        // 美国 měiguó
    expect(findLianyin([1, 3, 2])).toBe(1);     // 다음절 중간 쌍
    expect(findLianyin([3, 2, 4])).toBe(0);
  });

  it('연음 아니면 -1', () => {
    expect(findLianyin([3, 3])).toBe(-1);       // 3+3은 표기상 [3,3] → 제외(하늘쌤 규칙은 3+2)
    expect(findLianyin([2, 3])).toBe(-1);       // 순서 반대
    expect(findLianyin([1, 4])).toBe(-1);
    expect(findLianyin([3, 0, 2])).toBe(-1);    // 경성 끼면 인접 아님
    expect(findLianyin([3])).toBe(-1);
    expect(findLianyin([])).toBe(-1);
  });

  it('여러 쌍이면 첫 번째만', () => {
    expect(findLianyin([3, 2, 3, 2])).toBe(0);
  });

  it('잘못된 입력은 -1', () => {
    expect(findLianyin(null)).toBe(-1);
    expect(findLianyin(undefined)).toBe(-1);
    expect(findLianyin('32')).toBe(-1);
  });
});

describe('findToneSandhi', () => {
  it('인접한 3성+3성이면 첫 3성 인덱스(발음상 2성)', () => {
    expect(findToneSandhi([3, 3])).toBe(0);        // 你好 nǐhǎo→ní hǎo
    expect(findToneSandhi([1, 3, 3])).toBe(1);     // 다음절 중간 쌍
    expect(findToneSandhi([3, 3, 2])).toBe(0);     // 첫 3+3
  });

  it('3+3 아니면 -1', () => {
    expect(findToneSandhi([3, 2])).toBe(-1);       // 연음(3+2)은 findLianyin 담당
    expect(findToneSandhi([2, 3])).toBe(-1);
    expect(findToneSandhi([3, 0, 3])).toBe(-1);    // 경성 끼면 인접 아님
    expect(findToneSandhi([3])).toBe(-1);
    expect(findToneSandhi([])).toBe(-1);
  });

  it('여러 쌍이면 첫 번째만', () => {
    expect(findToneSandhi([3, 3, 3])).toBe(0);
  });

  it('잘못된 입력은 -1', () => {
    expect(findToneSandhi(null)).toBe(-1);
    expect(findToneSandhi(undefined)).toBe(-1);
    expect(findToneSandhi('33')).toBe(-1);
  });
});
