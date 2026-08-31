// useTabTip 최소 동작 테스트 — 게임 화면들과 학생앱 PersonalPage가 공유하는 탭 팁 훅.
// 노출 조건(온보딩 완료 + 미열람)과 dismiss의 localStorage 소진 처리를 고정한다.
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTabTip, resetAllTabTips } from './useTabTip.js';

beforeEach(() => {
  localStorage.clear();
});

describe('useTabTip', () => {
  it('온보딩이 끝나지 않았으면 팁을 보여주지 않는다', () => {
    const { result } = renderHook(() => useTabTip('home', false));
    expect(result.current.visible).toBe(false);
  });

  it('온보딩 완료 + 아직 안 본 탭이면 팁을 보여준다', () => {
    const { result } = renderHook(() => useTabTip('home', true));
    expect(result.current.visible).toBe(true);
  });

  it('dismiss하면 팁이 사라지고, 다음 마운트에서도 다시 보이지 않는다 (localStorage 소진)', () => {
    const first = renderHook(() => useTabTip('home', true));
    act(() => first.result.current.dismiss());
    expect(first.result.current.visible).toBe(false);

    // 새로 마운트해도(앱 재방문 시나리오) seen 기록 때문에 안 보인다
    const second = renderHook(() => useTabTip('home', true));
    expect(second.result.current.visible).toBe(false);

    // 다른 탭 키는 영향받지 않는다
    const other = renderHook(() => useTabTip('archive', true));
    expect(other.result.current.visible).toBe(true);
  });

  it('resetAllTabTips 후에는 소진된 탭 팁이 다시 보인다', () => {
    const first = renderHook(() => useTabTip('home', true));
    act(() => first.result.current.dismiss());

    resetAllTabTips();
    const again = renderHook(() => useTabTip('home', true));
    expect(again.result.current.visible).toBe(true);
  });

  it('localStorage에 깨진 JSON이 있어도 죽지 않고 팁을 보여준다', () => {
    localStorage.setItem('tab_tips_v1', 'not-json{');
    const { result } = renderHook(() => useTabTip('home', true));
    expect(result.current.visible).toBe(true);
  });
});
