import { describe, it, expect } from 'vitest';
import { stripEmoji, normalizeId } from './string.js';

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
