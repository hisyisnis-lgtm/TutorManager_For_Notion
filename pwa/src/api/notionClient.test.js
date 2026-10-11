import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ bearer: 'fixture-teacher', revision: 1, onChange: null }));
vi.mock('./studentRequest.js', () => ({ invalidateStudentReads: vi.fn() }));
vi.mock('../config.js', () => ({ WORKER_URL: 'https://fixture.invalid' }));
vi.mock('./authUtils.js', () => ({ getToken: () => session.bearer, handleTeacherAuthExpiry: vi.fn() }));
vi.mock('./authState.js', () => ({
  getAuthRevision: () => session.revision,
  subscribeAuthChanges: (listener) => { session.onChange = listener; return () => {}; },
}));

let api;
let fetchMock;
const response = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', ...headers },
});
const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  session.bearer = 'fixture-teacher'; session.revision = 1; session.onChange = null;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  api = await import('./notionClient.js');
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Notion 진행 중 읽기 공유', () => {
  it('빠른 재방문의 동일 GET은 공유하고 완료 후에는 새 요청을 보낸다', async () => {
    const pending = deferred();
    fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response({ id: '최신 페이지' }));
    const first = api.getPage('student');
    const revisit = api.getPage('student');
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    pending.resolve(response({ id: '첫 페이지' }));
    expect(await first).toEqual({ id: '첫 페이지' });
    expect(await revisit).toEqual({ id: '첫 페이지' });
    expect(await api.getPage('student')).toEqual({ id: '최신 페이지' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('서로 다른 조회는 FIFO 3개 버스트와 350ms 충전 간격을 그대로 지킨다', async () => {
    fetchMock.mockImplementation(async (url) => response({ id: url.split('/').at(-1) }));
    const requests = ['a', 'b', 'c', 'd', 'e'].map((id) => api.getPage(id));
    const queuedDuplicate = api.getPage('d');
    await flush();
    expect(fetchMock.mock.calls.map(([url]) => url.split('/').at(-1))).toEqual(['a', 'b', 'c']);
    await vi.advanceTimersByTimeAsync(350);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock.mock.calls.map(([url]) => url.split('/').at(-1))).toEqual(['a', 'b', 'c', 'd']);
    await vi.advanceTimersByTimeAsync(350);
    expect(fetchMock.mock.calls.map(([url]) => url.split('/').at(-1))).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(await queuedDuplicate).toEqual({ id: 'd' });
    await Promise.all(requests);
  });

  it('같은 전체 조회와 첫 페이지를 공유하고 동일 queryAll 페이지네이션도 하나만 진행한다', async () => {
    const firstPage = deferred(); const secondPage = deferred();
    fetchMock.mockReturnValueOnce(firstPage.promise).mockReturnValueOnce(secondPage.promise)
      .mockResolvedValueOnce(response({ results: [{ id: '새 조회' }], has_more: false }));
    const sorts = [{ property: '결제일', direction: 'descending' }];
    const master = api.queryAll('payments', undefined, sorts);
    const otherMaster = api.queryAll('payments', undefined, sorts);
    const forecast = api.queryPage('payments', undefined, sorts, undefined, 100);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    firstPage.resolve(response({ results: [{ id: 'first' }], has_more: true, next_cursor: 'next' }));
    await flush();
    const revisit = api.queryAll('payments', undefined, sorts);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).start_cursor).toBe('next');
    secondPage.resolve(response({ results: [{ id: 'second' }], has_more: false }));
    expect(await master).toEqual([{ id: 'first' }, { id: 'second' }]);
    expect(await otherMaster).toEqual(await master);
    expect(await revisit).toEqual(await master);
    expect((await forecast).results).toEqual([{ id: 'first' }]);
    expect(await api.queryAll('payments', undefined, sorts)).toEqual([{ id: '새 조회' }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('경로·필터·정렬·페이지 크기가 다르면 서로 다른 읽기로 처리한다', async () => {
    fetchMock.mockImplementation(async () => response({ results: [], has_more: false }));
    const filter = { property: '학생', relation: { contains: 'student' } };
    const sorts = [{ property: '결제일', direction: 'descending' }];
    const requests = [
      api.queryPage('payments', filter, sorts),
      api.queryPage('payments', { ...filter }, [...sorts]),
      api.queryPage('payments', undefined, sorts),
      api.queryPage('other', filter, sorts),
      api.queryPage('payments', filter, sorts, undefined, 100),
      api.queryPage('payments', filter, [{ ...sorts[0], direction: 'ascending' }]),
    ];
    await vi.advanceTimersByTimeAsync(701);
    await Promise.all(requests);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('필요 속성 ID를 한 번만 인코딩해 각 페이지에 보내고 전체 속성 조회와는 공유하지 않는다', async () => {
    const projectedFirst = deferred(); const fullFirst = deferred();
    fetchMock.mockReturnValueOnce(projectedFirst.promise).mockReturnValueOnce(fullFirst.promise)
      .mockResolvedValueOnce(response({ results: [{ id: 'projected-second' }], has_more: false }));
    const options = { filterProperties: ['k%3EA%3E', '%7C~~v'] };
    const projected = api.queryAll('payments', undefined, undefined, options);
    const projectedDuplicate = api.queryAll('payments', undefined, undefined, { filterProperties: [...options.filterProperties] });
    const full = api.queryAll('payments');
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const projectedUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(projectedUrl.searchParams.getAll('filter_properties')).toEqual(['k>A>', '|~~v']);
    expect(projectedUrl.search).not.toContain('%253E');
    expect(new URL(fetchMock.mock.calls[1][0]).search).toBe('');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ page_size: 100 });
    projectedFirst.resolve(response({ results: [{ id: 'projected-first' }], has_more: true, next_cursor: 'next' }));
    fullFirst.resolve(response({ results: [{ id: 'full' }], has_more: false }));
    expect(await projected).toEqual([{ id: 'projected-first' }, { id: 'projected-second' }]);
    expect(await projectedDuplicate).toEqual(await projected);
    expect(await full).toEqual([{ id: 'full' }]);
    expect(fetchMock.mock.calls[2][0]).toBe(fetchMock.mock.calls[0][0]);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).start_cursor).toBe('next');
  });

  it.each(['revision', 'credential'])('인증 %s 변경 후 새 요청은 이전 응답을 공유하지 않는다', async (change) => {
    const old = deferred(); const fresh = deferred();
    fetchMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const oldRequest = api.getPage('student');
    const oldResult = oldRequest.catch((error) => error);
    await flush();
    if (change === 'revision') { session.revision += 1; session.onChange(); }
    else session.bearer = 'fixture-new-teacher';
    const newRequest = api.getPage('student');
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fresh.resolve(response({ id: '현재 인증' }));
    old.resolve(response({ id: '이전 인증' }));
    expect(await newRequest).toEqual({ id: '현재 인증' });
    expect((await oldResult).status).toBe(401);
  });

  it('쓰기 전·중·완료 후의 동일 읽기를 서로 공유하지 않는다', async () => {
    const before = deferred(); const write = deferred(); const during = deferred(); const after = deferred();
    fetchMock.mockReturnValueOnce(before.promise).mockReturnValueOnce(write.promise)
      .mockReturnValueOnce(during.promise).mockReturnValueOnce(after.promise);
    const oldRead = api.getPage('student');
    const saving = api.updatePage('student', { name: '새 이름' });
    const duringRead = api.getPage('student');
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    write.resolve(response({ id: 'saved' }));
    await saving;
    const afterRead = api.getPage('student');
    await vi.advanceTimersByTimeAsync(351);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    before.resolve(response({ id: '쓰기 전' }));
    during.resolve(response({ id: '쓰기 중' }));
    after.resolve(response({ id: '쓰기 완료 후' }));
    expect(await oldRead).toEqual({ id: '쓰기 전' });
    expect(await duringRead).toEqual({ id: '쓰기 중' });
    expect(await afterRead).toEqual({ id: '쓰기 완료 후' });
  });

  it('실패한 공유 요청을 정리해 다음 읽기는 정상 복구한다', async () => {
    fetchMock.mockRejectedValueOnce(new Error('통신 실패')).mockResolvedValueOnce(response({ id: '복구' }));
    const first = api.getPage('student'); const second = api.getPage('student');
    const results = await Promise.allSettled([first, second]);
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await api.getPage('student')).toEqual({ id: '복구' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('읽기 429 재시도도 하나의 진행 중 요청으로 함께 기다린다', async () => {
    fetchMock.mockResolvedValueOnce(response({ error: 'rate limited' }, 429, { 'Retry-After': '1' }))
      .mockResolvedValueOnce(response({ id: '재시도 성공' }));
    const first = api.getPage('student'); const second = api.getPage('student');
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await first).toEqual({ id: '재시도 성공' });
    expect(await second).toEqual(await first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['createPage', 'updatePage', 'deletePage'])('%s 쓰기는 동일 호출을 공유하거나 429를 자동 재시도하지 않는다', async (method) => {
    fetchMock.mockResolvedValueOnce(response({ error: 'rate limited' }, 429, { 'Retry-After': '1' }))
      .mockResolvedValueOnce(response({ id: '두 번째 쓰기' }));
    const args = method === 'createPage' ? ['students', { name: 'fixture' }] : ['student', { name: 'fixture' }];
    const results = await Promise.allSettled([api[method](...args), api[method](...args)]);
    expect(results[0].status).toBe('rejected');
    expect(results[0].reason.message).toBe('Notion API 오류: rate limited');
    expect(results[1].value).toEqual({ id: '두 번째 쓰기' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
