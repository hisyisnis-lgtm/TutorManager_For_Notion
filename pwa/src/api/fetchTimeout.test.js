import { describe, it, expect, vi } from 'vitest';
import { retryTransient } from './fetchTimeout.js';

const withStatus = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

describe('retryTransient — 일시적 실패만 재시도', () => {
  it('성공하면 그대로 값을 돌려주고 재시도하지 않는다', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(retryTransient(fn, { baseDelayMs: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('네트워크 오류(status 없음)는 재시도한다', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('요청 시간이 초과됐어요'))
      .mockResolvedValue('ok');
    await expect(retryTransient(fn, { baseDelayMs: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('5xx는 재시도한다', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(withStatus(500))
      .mockResolvedValue('ok');
    await expect(retryTransient(fn, { baseDelayMs: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // 파일이 크거나(413) 형식이 틀리면(415) 다시 보내도 같은 결과 — 학생을 기다리게만 한다.
  it('413(용량 초과)은 재시도하지 않고 즉시 실패', async () => {
    const fn = vi.fn().mockRejectedValue(withStatus(413));
    await expect(retryTransient(fn, { baseDelayMs: 1 })).rejects.toThrow('HTTP 413');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('415(형식 불가)도 즉시 실패', async () => {
    const fn = vi.fn().mockRejectedValue(withStatus(415));
    await expect(retryTransient(fn, { baseDelayMs: 1 })).rejects.toThrow('HTTP 415');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('계속 실패하면 attempts 횟수만큼 시도한 뒤 마지막 에러를 던진다', async () => {
    const fn = vi.fn().mockRejectedValue(withStatus(503));
    await expect(retryTransient(fn, { attempts: 3, baseDelayMs: 1 })).rejects.toThrow('HTTP 503');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
