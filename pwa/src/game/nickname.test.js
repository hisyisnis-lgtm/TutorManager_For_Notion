import { describe, it, expect } from 'vitest';
import { randomNickname, NICKNAME_MAX } from './nickname.js';

describe('randomNickname', () => {
  it('항상 비어있지 않고 NICKNAME_MAX 이내 (서버 GameNicknameSchema 1~12자 충족)', () => {
    for (let i = 0; i < 300; i++) {
      const n = randomNickname();
      expect(n.length).toBeGreaterThanOrEqual(1);
      expect(n.length).toBeLessThanOrEqual(NICKNAME_MAX);
      expect(n.trim()).toBe(n); // 앞뒤 공백 없음
    }
  });
  it('다양성 — 여러 번 뽑으면 서로 다른 값이 나옴', () => {
    const set = new Set();
    for (let i = 0; i < 50; i++) set.add(randomNickname());
    expect(set.size).toBeGreaterThan(1);
  });
});
