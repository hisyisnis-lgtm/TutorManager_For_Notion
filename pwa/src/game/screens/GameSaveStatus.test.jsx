import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GameSaveStatus } from './HomeScreen.jsx';

afterEach(cleanup);
describe('홈 저장 상태 안내', () => {
  it('조회·저장 실패 상태를 알리고 수동 재시도를 제공한다', () => {
    const retry = vi.fn();
    const { rerender } = render(<GameSaveStatus status="read-error" onRetry={retry} />);
    expect(screen.getByRole('status').textContent).toContain('서버 저장을 보류');
    fireEvent.click(screen.getByRole('button', { name: '재시도' }));
    expect(retry).toHaveBeenCalledTimes(1);
    rerender(<GameSaveStatus status="save-error" onRetry={retry} />);
    expect(screen.getByRole('status').textContent).toBe('서버 저장이 실패했습니다.');
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
    fireEvent.click(screen.getByRole('button', { name: '재시도' }));
    expect(retry).toHaveBeenCalledTimes(2);
    rerender(<GameSaveStatus status="checking" onRetry={retry} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('서버 기록 확인 중…');
    rerender(<GameSaveStatus status="saved" onRetry={retry} />);
    expect(screen.getByRole('status').textContent).toBe('서버 저장 완료');
  });
  it('인증이 끝났다면 저장 재시도 대신 로그인 동선을 제공한다', () => {
    const login = vi.fn();
    render(<GameSaveStatus status="signed-out" onLogin={login} />);
    expect(screen.queryByRole('button', { name: '재시도' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));
    expect(login).toHaveBeenCalledTimes(1);
  });
});
