// 수업 유형 이름 판정 — 그룹결제·무료상담·고정가격 분기의 근거 predicate.
import { describe, it, expect } from 'vitest';
import { isOnlineGroupTitle, isFreeConsultTitle, isFixedPriceTitle } from './classTypeKind.js';

describe('classTypeKind predicates', () => {
  it('isOnlineGroupTitle', () => {
    expect(isOnlineGroupTitle('온라인그룹수업')).toBe(true);
    expect(isOnlineGroupTitle('온라인그룹수업 (수요반)')).toBe(true);
    expect(isOnlineGroupTitle('1:1 정규수업')).toBe(false);
  });
  it('isFreeConsultTitle', () => {
    expect(isFreeConsultTitle('무료상담')).toBe(true);
    expect(isFreeConsultTitle('정규수업')).toBe(false);
  });
  it('isFixedPriceTitle — 원데이클래스·체험수업', () => {
    expect(isFixedPriceTitle('원데이클래스')).toBe(true);
    expect(isFixedPriceTitle('체험수업')).toBe(true);
    expect(isFixedPriceTitle('온라인그룹수업')).toBe(false);
  });
  it('null/undefined 안전 (선택 전)', () => {
    expect(isOnlineGroupTitle(undefined)).toBe(false);
    expect(isFreeConsultTitle(null)).toBe(false);
    expect(isFixedPriceTitle(undefined)).toBe(false);
  });
});
