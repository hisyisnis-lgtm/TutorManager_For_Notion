import { describe, it, expect } from 'vitest';
import { stripEmoji, normalizeId, normalizePhone } from './string.js';

describe('stripEmoji', () => {
  it('상태 이모지(🟢🟡⚫)를 제거한다', () => {
    expect(stripEmoji('🟢 김학생')).toBe('김학생');
    expect(stripEmoji('🟡 이학생')).toBe('이학생');
    expect(stripEmoji('⚫ 박학생')).toBe('박학생');
  });

  it('Notion 도형 심볼(◆◇▲▼ 등)을 제거한다', () => {
    expect(stripEmoji('◆ 학생A')).toBe('학생A');
    expect(stripEmoji('▲ 학생B')).toBe('학생B');
    expect(stripEmoji('★ 학생C')).toBe('학생C');
  });

  it('이모지 뒤에 공백이 없어도 처리한다', () => {
    expect(stripEmoji('🟢김학생')).toBe('김학생');
    expect(stripEmoji('◆학생A')).toBe('학생A');
  });

  it('이모지가 없으면 원본 그대로 반환한다', () => {
    expect(stripEmoji('김학생')).toBe('김학생');
    expect(stripEmoji('Hello World')).toBe('Hello World');
  });

  it('null/undefined/빈 문자열을 안전하게 처리한다', () => {
    expect(stripEmoji(null)).toBe('');
    expect(stripEmoji(undefined)).toBe('');
    expect(stripEmoji('')).toBe('');
  });

  it('앞뒤 공백을 제거한다', () => {
    expect(stripEmoji('  김학생  ')).toBe('김학생');
    expect(stripEmoji('🟢   김학생   ')).toBe('김학생');
  });

  it('이름 중간의 이모지는 보존한다 (앞에 있는 것만 제거)', () => {
    expect(stripEmoji('🟢 김🌟학생')).toBe('김🌟학생');
  });
});

describe('normalizeId', () => {
  it('하이픈을 모두 제거한다', () => {
    expect(normalizeId('314838fa-f2a6-8143-a6c7-e59c50f3bbdb'))
      .toBe('314838faf2a68143a6c7e59c50f3bbdb');
  });

  it('하이픈이 없으면 원본 그대로 반환한다', () => {
    expect(normalizeId('314838faf2a68143a6c7e59c50f3bbdb'))
      .toBe('314838faf2a68143a6c7e59c50f3bbdb');
  });

  it('null/undefined를 빈 문자열로 처리한다', () => {
    expect(normalizeId(null)).toBe('');
    expect(normalizeId(undefined)).toBe('');
    expect(normalizeId('')).toBe('');
  });

  it('하이픈만 있는 문자열은 빈 문자열로 변환한다', () => {
    expect(normalizeId('---')).toBe('');
  });
});

describe('normalizePhone', () => {
  it('하이픈·공백 있는 국내 번호를 표준형으로', () => {
    expect(normalizePhone('010-1234-5678')).toBe('01012345678');
    expect(normalizePhone('010 1234 5678')).toBe('01012345678');
    expect(normalizePhone('01012345678')).toBe('01012345678');
  });

  it('국가코드 +82를 0으로 변환한다', () => {
    expect(normalizePhone('+821012345678')).toBe('01012345678');
    expect(normalizePhone('+82 10 1234 5678')).toBe('01012345678');
    expect(normalizePhone('821012345678')).toBe('01012345678');
    expect(normalizePhone('+82 010 1234 5678')).toBe('01012345678'); // 82 뒤 0 중복도 정리
  });

  it('구형 011/016~019 10자리도 허용한다', () => {
    expect(normalizePhone('011-234-5678')).toBe('0112345678');
    expect(normalizePhone('019-123-4567')).toBe('0191234567');
  });

  it('휴대폰 패턴이 아니면 null', () => {
    expect(normalizePhone('02-123-4567')).toBe(null);   // 지역번호
    expect(normalizePhone('1234')).toBe(null);
    expect(normalizePhone('010-12-34')).toBe(null);     // 자리수 부족
    expect(normalizePhone('')).toBe(null);
    expect(normalizePhone(null)).toBe(null);
    expect(normalizePhone(undefined)).toBe(null);
    expect(normalizePhone('abc')).toBe(null);
  });
});
