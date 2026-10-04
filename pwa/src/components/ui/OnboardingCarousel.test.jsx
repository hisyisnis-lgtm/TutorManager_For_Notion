import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import OnboardingCarousel, { ONBOARDING_KEY } from './OnboardingCarousel.jsx';

vi.mock('./PandaMascot.jsx', () => ({ default: () => null }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

describe('온보딩 완료 저장 실패', () => {
  it.each(['건너뛰기', '시작하기'])('%s는 저장이 거부되어도 완료 콜백을 실행한다', action => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage blocked'); });
    const onDone = vi.fn();
    render(<OnboardingCarousel onDone={onDone} />);
    if (action === '시작하기') fireEvent.click(screen.getByRole('button', { name: '4번째 슬라이드' }));
    fireEvent.click(screen.getByRole('button', { name: action }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('랴오랴오 키우기 안내', () => {
  it.each([
    { showHomework: true, lastSlide: 4 },
    { showHomework: false, lastSlide: 3 },
  ])('숙제 사용 여부($showHomework)에 맞는 먹이 경로를 안내하고 완료한다', ({ showHomework, lastSlide }) => {
    const onDone = vi.fn();
    const { container } = render(<OnboardingCarousel onDone={onDone} showHomework={showHomework} />);
    expect(container.textContent).not.toContain('팬더');
    fireEvent.click(screen.getByRole('button', { name: `${lastSlide}번째 슬라이드` }));
    expect(screen.getByText('랴오랴오 키우기')).toBeTruthy();
    expect(container.textContent).toContain('알부터 함께 키워요.');
    if (showHomework) {
      expect(container.textContent).toContain('수업·숙제 제출·피드백 확인으로');
    } else {
      expect(container.textContent).toContain('수업으로 모은 먹이를 주며');
      expect(container.textContent).not.toContain('숙제');
      expect(container.textContent).not.toContain('피드백');
    }
    fireEvent.click(screen.getByRole('button', { name: '시작하기' }));
    expect(localStorage.getItem(ONBOARDING_KEY)).toBe('1');
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
