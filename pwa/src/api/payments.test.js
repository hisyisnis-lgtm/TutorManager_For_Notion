// 돈 계산 순수 함수 테스트 — 결제 예정액·부분환불 환산·표시 포맷.
// 매출 숫자라 틀리면 손해가 커서 경계값 위주로 고정한다.
import { describe, it, expect } from 'vitest';
import { calcPaymentAmount, refundSessions, formatSessions, isWholeSession, validatePaymentForm } from './payments.js';

describe('validatePaymentForm — 온라인그룹수업 결제 편집 (버그 수정 검증)', () => {
  const groupForm = { classTypeId: 'ct-group', sessionCount: '0', actualAmount: '140000', studentId: '' };

  it('그룹수업 편집: 회차 0이어도 검증 통과 (이전엔 "회차는 0보다 커야" 로 저장 불가였음)', () => {
    expect(validatePaymentForm(groupForm, { isOnlineGroup: true, isEdit: true })).toBeNull();
  });
  it('그룹수업 편집: 학생 없이도 통과 (그룹은 수강생 이름만)', () => {
    expect(validatePaymentForm({ ...groupForm, studentId: '' }, { isOnlineGroup: true, isEdit: true })).toBeNull();
  });
  it('그룹수업: 금액이 비면 금액 에러 (회차 에러가 아니라)', () => {
    expect(validatePaymentForm({ ...groupForm, actualAmount: '' }, { isOnlineGroup: true, isEdit: true }))
      .toBe('실제 결제 금액을 입력하세요.');
  });
  it('일반 결제는 여전히 회차 검증 유지', () => {
    expect(validatePaymentForm({ classTypeId: 'ct1', sessionCount: '0', actualAmount: '100000', studentId: 's1' }, { isOnlineGroup: false, isEdit: true }))
      .toBe('시간 회차는 0보다 커야 합니다.');
    expect(validatePaymentForm({ classTypeId: 'ct1', sessionCount: '', actualAmount: '100000', studentId: 's1' }, { isOnlineGroup: false, isEdit: true }))
      .toBe('시간 회차를 입력하세요.');
  });
  it('일반 결제 신규는 학생 필수, 편집은 학생 없어도 됨', () => {
    const f = { classTypeId: 'ct1', sessionCount: '4', actualAmount: '200000', studentId: '' };
    expect(validatePaymentForm(f, { isOnlineGroup: false, isEdit: false })).toBe('학생을 선택하세요.');
    expect(validatePaymentForm(f, { isOnlineGroup: false, isEdit: true })).toBeNull();
  });
  it('수업 종류 미선택은 최우선 차단', () => {
    expect(validatePaymentForm({ classTypeId: '', sessionCount: '4', actualAmount: '1' }, { isOnlineGroup: false, isEdit: false }))
      .toBe('수업 종류를 선택하세요.');
  });
});

describe('calcPaymentAmount — 결제 예정 금액', () => {
  it('기본: 회차 × 단가', () => {
    expect(calcPaymentAmount(4, 50000, 0)).toBe(200000);
  });
  it('할인율 적용 후 반올림', () => {
    expect(calcPaymentAmount(4, 50000, 10)).toBe(180000);
    // 소수 회차 + 할인 → 반올림 확인 (1.5 * 50000 * 0.85 = 63750)
    expect(calcPaymentAmount(1.5, 50000, 15)).toBe(63750);
  });
  it('discountRate 미지정(null/undefined)은 0% 취급', () => {
    expect(calcPaymentAmount(2, 50000, null)).toBe(100000);
    expect(calcPaymentAmount(2, 50000, undefined)).toBe(100000);
  });
  it('회차 0이면 0', () => {
    expect(calcPaymentAmount(0, 50000, 10)).toBe(0);
  });
});

describe('refundSessions — 환불 금액 → 환산 회차', () => {
  it('할인 없는 단가 기준 환산', () => {
    expect(refundSessions({ refundAmount: 100000, unitPrice: 50000, discountRate: 0 })).toBe(2);
  });
  it('할인 적용 단가 기준 환산 (Notion 유효 회차 formula와 동일식)', () => {
    // 단가 50000, 10% 할인 → 회차당 45000. 90000 환불 = 2회차
    expect(refundSessions({ refundAmount: 90000, unitPrice: 50000, discountRate: 10 })).toBe(2);
  });
  it('소수 회차는 반올림 없이 그대로', () => {
    expect(refundSessions({ refundAmount: 75000, unitPrice: 50000, discountRate: 0 })).toBe(1.5);
  });
  it('단가 0(학생 없는 그룹 결제)은 div-by-zero 없이 0', () => {
    expect(refundSessions({ refundAmount: 100000, unitPrice: 0, discountRate: 0 })).toBe(0);
  });
  it('환불액 0/미지정이면 0', () => {
    expect(refundSessions({ refundAmount: 0, unitPrice: 50000 })).toBe(0);
    expect(refundSessions({})).toBe(0);
    expect(refundSessions()).toBe(0);
  });
});

describe('formatSessions / isWholeSession — 회차 표시', () => {
  it('정수는 정수로', () => {
    expect(formatSessions(2)).toBe('2');
    expect(formatSessions(2.000001)).toBe('2'); // 반올림 2자리
  });
  it('소수는 최대 2자리, 불필요한 0 제거', () => {
    expect(formatSessions(1.5)).toBe('1.5');
    expect(formatSessions(1.3333)).toBe('1.33');
  });
  it('isWholeSession — 정수 판정 (부동소수 오차 허용)', () => {
    expect(isWholeSession(2)).toBe(true);
    expect(isWholeSession(2 + 1e-12)).toBe(true);
    expect(isWholeSession(1.5)).toBe(false);
  });
});
