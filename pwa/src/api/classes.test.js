// 수업 API 로직 검증 — 실제 Notion 대신 notionClient를 가짜(mock)로 대체해
// "어떤 필터/요청을 만들어 보내는가"만 확인한다. 운영 데이터 무영향.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// notionClient 전체를 가짜로 — queryPage/createPage 호출 인자를 캡처한다.
vi.mock('./notionClient.js', () => ({
  CLASSES_DB: 'DUMMY_CLASS_DB',
  queryPage: vi.fn(async () => ({ results: [], has_more: false, next_cursor: null })),
  createPage: vi.fn(async () => ({ id: 'new-page' })),
  updatePage: vi.fn(async () => ({})),
  deletePage: vi.fn(async () => ({})),
  getPage: vi.fn(async () => ({})),
}));

import { queryPage, createPage } from './notionClient.js';
import { fetchClassesPage, bulkCreateClasses } from './classes.js';

beforeEach(() => vi.clearAllMocks());

describe('fetchClassesPage — 완료 탭 날짜 필터 병합 (버그 수정 검증)', () => {
  it('완료 탭 + 기간 지정: on_or_before(현재)와 on_or_after(dateFrom)가 AND로 함께 걸린다', async () => {
    await fetchClassesPage({ completedOnly: true, dateFrom: '2026-07-01T00:00:00+09:00' });
    const filter = queryPage.mock.calls[0][1];
    // 이전 버그: 완료 탭이면 dateFrom을 통째로 무시했음 → 필터가 단일 on_or_before뿐
    expect(filter.and).toBeDefined();
    const hasAfter = filter.and.some((f) => f.date?.on_or_after === '2026-07-01T00:00:00+09:00');
    const hasBefore = filter.and.some((f) => f.date?.on_or_before);
    expect(hasAfter).toBe(true);   // 기간 시작이 실제로 반영됨
    expect(hasBefore).toBe(true);  // 완료(현재 이전) 조건도 유지
  });

  it('완료 탭 + dateTo가 현재보다 과거면 상한을 dateTo로 좁힌다', async () => {
    await fetchClassesPage({ completedOnly: true, dateTo: '2020-01-01T00:00:00+09:00' });
    const filter = queryPage.mock.calls[0][1];
    const upper = (filter.and ? filter.and : [filter]).find((f) => f.date?.on_or_before);
    expect(upper.date.on_or_before).toBe('2020-01-01T00:00:00+09:00');
  });

  it('완료 탭 정렬은 최신순(descending)', async () => {
    await fetchClassesPage({ completedOnly: true });
    const sorts = queryPage.mock.calls[0][2];
    expect(sorts[0].direction).toBe('descending');
  });

  it('예정 탭은 기존대로 dateFrom/dateTo를 그대로 사용', async () => {
    await fetchClassesPage({ dateFrom: '2026-07-10T00:00:00+09:00', dateTo: '2026-07-20T00:00:00+09:00' });
    const filter = queryPage.mock.calls[0][1];
    expect(filter.and).toHaveLength(2);
    expect(filter.and.some((f) => f.date?.on_or_after === '2026-07-10T00:00:00+09:00')).toBe(true);
    expect(filter.and.some((f) => f.date?.on_or_before === '2026-07-20T00:00:00+09:00')).toBe(true);
  });
});

describe('bulkCreateClasses — 반복 등록 부분 실패 (중복 생성 방지 검증)', () => {
  const item = () => ({ studentIds: ['s1'], classTypeId: 'ct1', datetime: '2026-07-12T10:00:00+09:00', duration: '60' });

  it('전부 성공하면 생성 결과 배열을 반환', async () => {
    createPage.mockResolvedValue({ id: 'ok' });
    const res = await bulkCreateClasses([item(), item(), item()]);
    expect(res).toHaveLength(3);
    expect(createPage).toHaveBeenCalledTimes(3);
  });

  it('중간 실패 시 "몇 개까지 생성됐는지"를 에러에 담아 던진다 → 재시도 중복 방지', async () => {
    createPage
      .mockResolvedValueOnce({ id: '1' })
      .mockResolvedValueOnce({ id: '2' })
      .mockRejectedValueOnce(new Error('네트워크 오류'));
    let caught;
    try {
      await bulkCreateClasses([item(), item(), item(), item()]);
    } catch (e) { caught = e; }
    expect(caught).toBeDefined();
    expect(caught.createdCount).toBe(2);           // 앞 2개는 이미 생성됨을 사용자에게 알림
    expect(caught.message).toContain('2개');
    expect(createPage).toHaveBeenCalledTimes(3);    // 실패 후 나머지는 시도 안 함(중복 방지)
  });
});
