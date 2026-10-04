import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import usePandaUpdateNotice from './usePandaUpdateNotice.js';
import { pandaUpdateNoticeKey } from '../utils/pandaUpdateNotice.js';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); cleanup(); localStorage.clear(); });

describe('학생별 업데이트 소개 확인', () => {
  it('확인한 학생은 다시 마운트해도 같은 버전 안내를 보지 않는다', () => {
    const first = renderHook(() => usePandaUpdateNotice('student-a'));
    expect(first.result.current.pending).toBe(true);
    act(() => first.result.current.dismiss());
    first.unmount();
    const second = renderHook(() => usePandaUpdateNotice('student-a'));
    expect(second.result.current.pending).toBe(false);
  });

  it('학생을 바꿔도 이전 학생의 확인 상태를 섞지 않는다', () => {
    const { result, rerender } = renderHook(({ token }) => usePandaUpdateNotice(token), { initialProps: { token: 'student-a' } });
    act(() => result.current.dismiss());
    rerender({ token: 'student-b' });
    expect(result.current.pending).toBe(true);
    expect(localStorage.getItem(pandaUpdateNoticeKey('student-b'))).toBeNull();
    rerender({ token: 'student-a' });
    expect(result.current.pending).toBe(false);
  });

  it('다른 버전의 확인 기록은 현재 안내를 숨기지 않는다', () => {
    localStorage.setItem('panda_update_notice:old-version:student-a', '1');
    const { result } = renderHook(() => usePandaUpdateNotice('student-a'));
    expect(result.current.pending).toBe(true);
  });

  it('저장소 읽기와 쓰기가 모두 실패해도 닫히고 학생별 메모리 상태를 유지한다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage full'); });
    const { result, rerender } = renderHook(({ token }) => usePandaUpdateNotice(token), { initialProps: { token: 'student-a' } });
    expect(result.current.pending).toBe(true);
    act(() => result.current.dismiss());
    expect(result.current.pending).toBe(false);
    rerender({ token: 'student-b' });
    expect(result.current.pending).toBe(true);
    rerender({ token: 'student-a' });
    expect(result.current.pending).toBe(false);
  });

  it('학생이 정해지기 전에는 안내나 확인 기록을 만들지 않는다', () => {
    const { result } = renderHook(() => usePandaUpdateNotice(undefined));
    expect(result.current.pending).toBe(false);
    act(() => result.current.dismiss());
    expect(localStorage.length).toBe(0);
  });
});
