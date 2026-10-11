import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureSession } from './authFixtures.js';
import { notifyAuthChange } from './authState.js';
import { setStudentSession } from './studentAuth.js';
import { studentRequest } from './studentRequest.js';
import { fetchStudentByToken, fetchMyClasses } from './bookingApi.js';
import { fetchMyHomework, submitHomework } from './homework.js';
import { fetchStudentNotices } from './notices.js';

vi.mock('../config.js', () => ({ WORKER_URL: 'https://dummy.workers.dev' }));
const token = 'PERF12345TOKEN';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, bad) => { resolve = ok; reject = bad; });
  return { promise, resolve, reject };
};
const read = operation => studentRequest(token, 'GET', '/homework/student', operation);
const result = value => ({ ok: true, status: 200, json: async () => value });
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); notifyAuthChange();
  setStudentSession(token, fixtureSession('student', `personal:${token}`));
});
afterEach(() => {
  vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear(); notifyAuthChange();
});

describe('JWT 학생 요청의 진행 중 GET 공유', () => {
  it('같은 인증과 경로의 진행 중 GET만 공유하고 완료 값을 남기지 않는다', async () => {
    const response = deferred();
    const operation = vi.fn(() => response.promise);
    const first = read(operation);
    const second = read(operation);
    expect(first).toBe(second);
    expect(operation).toHaveBeenCalledOnce();
    response.resolve(['숙제']);
    expect(await first).toEqual(['숙제']);
    expect(await read(operation)).toEqual(['숙제']);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('실패한 GET은 다음 조회를 막지 않는다', async () => {
    const operation = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
    await expect(read(operation)).rejects.toThrow('offline');
    expect(await read(operation)).toEqual([]);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('다른 학생과 다른 경로는 공유하지 않는다', async () => {
    const other = 'OTHER12345TOKEN';
    setStudentSession(other, fixtureSession('student', `personal:${other}`));
    const response = deferred();
    const operation = vi.fn(() => response.promise);
    const first = read(operation);
    const second = studentRequest(other, 'GET', '/homework/student', operation);
    const third = studentRequest(token, 'GET', '/booking/student', operation);
    expect(operation).toHaveBeenCalledTimes(3);
    response.resolve([]);
    await Promise.all([first, second, third]);
  });

  it('같은 credential을 재로그인해도 이전 인증 revision의 응답은 사용하지 않는다', async () => {
    const response = deferred();
    const operation = vi.fn().mockReturnValueOnce(response.promise).mockResolvedValueOnce(['새 목록']);
    const first = read(operation);
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    notifyAuthChange();
    expect(await read(operation)).toEqual(['새 목록']);
    response.resolve(['이전 목록']);
    await rejected;
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('credential이 바뀌면 revision 이벤트 없이도 진행 중 조회를 재사용하지 않는다', async () => {
    const response = deferred();
    const operation = vi.fn().mockReturnValueOnce(response.promise).mockResolvedValueOnce(['새 목록']);
    const first = read(operation);
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    localStorage.setItem(`student_session_${token}`, fixtureSession('student', `personal:${token}`, { iat: Math.floor(Date.now() / 1000) - 10 }));
    expect(await read(operation)).toEqual(['새 목록']);
    response.resolve(['이전 목록']);
    await rejected;
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('쓰기 시작과 완료 경계마다 이전 GET을 제외하고 POST는 공유하지 않는다', async () => {
    const responses = [deferred(), deferred(), deferred()];
    const operation = vi.fn().mockImplementationOnce(() => responses[0].promise)
      .mockImplementationOnce(() => responses[1].promise).mockImplementationOnce(() => responses[2].promise);
    const old = read(operation);
    const oldRejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    const mutation = deferred();
    const write = studentRequest(token, 'POST', '/homework/submit', () => mutation.promise);
    const during = read(operation);
    const duringRejected = expect(during).rejects.toMatchObject({ name: 'AbortError' });
    mutation.resolve({ ok: true });
    await write;
    const fresh = read(operation);
    expect(operation).toHaveBeenCalledTimes(3);
    responses.forEach((response, index) => response.resolve([index]));
    await Promise.all([oldRejected, duringRejected]);
    expect(await fresh).toEqual([2]);
    const post = vi.fn(async () => ({ ok: true }));
    await Promise.all([studentRequest(token, 'POST', '/homework/submit', post), studentRequest(token, 'POST', '/homework/submit', post)]);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('실패한 쓰기도 시작·완료 사이의 GET을 재사용하지 않는다', async () => {
    const mutation = deferred();
    const write = studentRequest(token, 'POST', '/homework/submit', () => mutation.promise);
    const writeRejected = expect(write).rejects.toThrow('offline');
    const response = deferred();
    const during = read(() => response.promise);
    const duringRejected = expect(during).rejects.toMatchObject({ name: 'AbortError' });
    mutation.reject(new Error('offline'));
    await writeRejected;
    response.resolve([]);
    await duringRejected;
    expect(await read(async () => ['재조회'])).toEqual(['재조회']);
  });

  it('인증 전 조회는 공유하지 않아 기존 서버 인증 응답을 유지한다', async () => {
    localStorage.clear(); notifyAuthChange();
    const operation = vi.fn(async () => []);
    await Promise.all([read(operation), read(operation)]);
    expect(operation).toHaveBeenCalledTimes(2);
  });
});

describe('기존 JWT 학생 API에 공유 helper 적용', () => {
  it.each([
    ['학생 정보', () => fetchStudentByToken(token)],
    ['월 수업', () => fetchMyClasses(token, '2026-10')],
    ['숙제 목록', () => fetchMyHomework(token)],
    ['공지 목록', () => fetchStudentNotices(token)],
  ])('%s 동시 읽기에서 네트워크 요청 1개와 동일 JWT 헤더를 사용한다', async (_name, call) => {
    const response = deferred();
    const network = vi.fn(() => response.promise);
    vi.stubGlobal('fetch', network);
    const first = call(); const second = call();
    expect(network).toHaveBeenCalledOnce();
    expect(network.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${localStorage.getItem(`student_session_${token}`)}`);
    response.resolve(result([]));
    expect(await first).toEqual([]); expect(await second).toEqual([]);
    await call();
    expect(network).toHaveBeenCalledTimes(2);
  });

  it('숙제 제출은 네트워크 POST를 각각 보내며 완료 후 조회를 재사용하지 않는다', async () => {
    const network = vi.fn(async () => result({ ok: true }));
    vi.stubGlobal('fetch', network);
    await Promise.all([submitHomework(token, 'hw', []), submitHomework(token, 'hw', [])]);
    expect(network).toHaveBeenCalledTimes(2);
    expect(network.mock.calls.every(([, options]) => options.method === 'POST')).toBe(true);
  });
});