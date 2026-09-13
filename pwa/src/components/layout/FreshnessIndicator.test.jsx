import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FreshnessIndicator from './FreshnessIndicator.jsx';
import { trackRevalidation } from '../../hooks/useCachedResource.js';
import { notifyAuthChange } from '../../api/authState.js';

vi.mock('@phosphor-icons/react', () => ({
  ArrowsClockwiseIcon: () => null, CheckCircleIcon: () => null, WarningCircleIcon: () => null, CircleNotchIcon: () => null,
}));

beforeEach(() => { notifyAuthChange(); window.history.replaceState({}, '', '/'); });
afterEach(() => { cleanup(); notifyAuthChange(); });
const view = () => render(<MemoryRouter><FreshnessIndicator /></MemoryRouter>);

describe('현재 화면 갱신 결과', () => {
  it('실패한 요청 뒤에는 완료 문구 대신 마지막 확인과 재시도를 제공한다', async () => {
    view();
    const retry = vi.fn(() => trackRevalidation(Promise.resolve([]), { key: 'classes', label: '수업 정보' }));
    await act(async () => {
      await trackRevalidation(Promise.reject(new Error('실패')), {
        key: 'classes', label: '수업 정보', lastSuccessAt: Date.now() - 60000, retry,
      }).catch(() => {});
    });
    expect(screen.getByText('수업 정보 확인에 실패했어요')).toBeTruthy();
    expect(screen.getByText(/마지막 확인/)).toBeTruthy();
    expect(screen.queryByText('방금 업데이트됨')).toBeNull();
    await act(async () => trackRevalidation(Promise.resolve([]), { key: 'notices', label: '공지' }));
    expect(screen.getByText('수업 정보 확인에 실패했어요')).toBeTruthy();
    expect(screen.queryByText('방금 업데이트됨')).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '수업 정보 다시 시도' })));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.queryByText('수업 정보 확인에 실패했어요')).toBeNull();
  });

  it('다른 경로의 요청 종료가 현재 화면에 완료 문구를 띄우지 않는다', async () => {
    let resolve;
    window.history.replaceState({}, '', '/old');
    const pending = trackRevalidation(new Promise(done => { resolve = done; }), { key: 'old' });
    window.history.replaceState({}, '', '/');
    view();
    await act(async () => { resolve([]); await pending; });
    expect(screen.queryByText('방금 업데이트됨')).toBeNull();
    expect(screen.queryByText('업데이트 중…')).toBeNull();
  });

  it('현재 화면의 성공한 갱신에만 완료 문구를 표시한다', async () => {
    view();
    let resolve;
    let pending;
    act(() => { pending = trackRevalidation(new Promise(done => { resolve = done; }), { key: 'current' }); });
    expect(screen.getByText('업데이트 중…')).toBeTruthy();
    await act(async () => { resolve([]); await pending; });
    expect(screen.getByText('방금 업데이트됨')).toBeTruthy();
  });
});
