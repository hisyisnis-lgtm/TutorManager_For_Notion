import { describe, it, expect, vi } from 'vitest';
vi.mock('./notionClient.js', () => ({ queryAll: vi.fn(), updatePage: vi.fn() }));
import { normalizePhone, matchConsults } from './consults.js';

describe('normalizePhone', () => {
  it('하이픈·공백·국가번호를 정리한다', () => {
    expect(normalizePhone('010-1234-5678')).toBe('01012345678');
    expect(normalizePhone(' 010 1234 5678 ')).toBe('01012345678');
    expect(normalizePhone('+82 10-1234-5678')).toBe('01012345678');
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone(null)).toBe('');
  });
});

describe('matchConsults — 학생 등록 시 상담 자동 매칭', () => {
  const consults = [
    { id: 'c3', name: '김하늘', phone: '010-1111-2222', appliedAt: '2026-09-01' }, // 최신
    { id: 'c2', name: '김하늘', phone: '01011112222', appliedAt: '2026-08-01' },
    { id: 'c1', name: '이소미', phone: '', appliedAt: '2026-07-01' },
    { id: 'c0', name: '박유인', phone: '01099998888', appliedAt: '2026-06-01' },
  ];

  it('전화번호가 같으면 가장 최근 1건을 byPhone으로', () => {
    const r = matchConsults(consults, { name: '김 하늘', phone: '010 1111 2222' });
    expect(r.byPhone?.id).toBe('c3');
    expect(r.byName.map((c) => c.id)).toEqual(['c2']); // 같은 이름의 나머지(전화 동일)는 byName에
  });

  it('전화가 없고 이름만 같으면 byName에만 (자동 연결 안 함)', () => {
    const r = matchConsults(consults, { name: '이소미', phone: '' });
    expect(r.byPhone).toBeNull();
    expect(r.byName.map((c) => c.id)).toEqual(['c1']);
  });

  it('이름은 같은데 전화가 다르면 후보에서 뺀다(동명이인)', () => {
    const r = matchConsults(consults, { name: '박유인', phone: '01000000000' });
    expect(r.byPhone).toBeNull();
    expect(r.byName).toEqual([]);
  });

  it('아무것도 없으면 빈 결과', () => {
    const r = matchConsults(consults, { name: '없는사람', phone: '01012341234' });
    expect(r.byPhone).toBeNull();
    expect(r.byName).toEqual([]);
  });
});
