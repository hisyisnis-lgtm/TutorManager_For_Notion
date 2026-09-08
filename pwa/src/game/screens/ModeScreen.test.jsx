import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { THEME_MODE_NOTICE } from '../../constants/toneGameWords.js';

let ModeScreen;
beforeAll(async () => {
  // 장식 파티클만 생략하고 실제 카드·잠금 버튼·트레이닝 모달은 그대로 검증한다.
  vi.stubGlobal('matchMedia', vi.fn(query => ({
    matches: query === '(prefers-reduced-motion: reduce)',
  })));
  ({ ModeScreen } = await import('./ModeScreen.jsx'));
}, 300000);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('tab_tips_v1', JSON.stringify({ 'game-mode': true }));
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});
afterAll(() => vi.unstubAllGlobals());

describe('모드 선택 — 테마 준비 중', () => {
  it('준비 중 테마를 누르면 안내만 표시하고 테마 선택으로 이동하지 않는다', () => {
    const onTheme = vi.fn();
    const onLocked = vi.fn();
    render(<ModeScreen onTheme={onTheme} onLocked={onLocked} />);

    const themeCard = screen.getByRole('button', { name: '테마 모드, 준비 중' });
    expect(themeCard.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(themeCard);

    expect(onTheme).not.toHaveBeenCalled();
    expect(onLocked).toHaveBeenCalledExactlyOnceWith(THEME_MODE_NOTICE, 'info');
  });

  it('난이도 선택과 트레이닝 안내를 거친 게임 시작은 계속 사용할 수 있다', () => {
    const onDifficulty = vi.fn();
    const onTraining = vi.fn();
    render(<ModeScreen onDifficulty={onDifficulty} onTraining={onTraining} />);

    fireEvent.click(screen.getByRole('button', { name: '난이도 모드' }));
    expect(onDifficulty).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '트레이닝', exact: true }));
    expect(screen.getByText('약한 단어 위주')).toBeTruthy();
    expect(onTraining).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '시작 하기' }));
    expect(onTraining).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '시작 하기' })).toBeNull();
  });
});
