import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LandingPage from './LandingPage.jsx';

const replace = vi.fn();
beforeEach(() => {
  replace.mockReset();
  vi.stubGlobal('location', { replace });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each([
  { name: '기존 소개 주소', state: undefined, target: 'https://tiantianchinese.com/lessons/', link: '공식 수업 안내 열기' },
  { name: '상담 탭 진입', state: { tab: '상담' }, target: 'https://tiantianchinese.com/consult/', link: '상담 신청 페이지 열기' },
])('$name을 공식 홈페이지로 이동하고 수동 이동 링크를 제공한다', ({ state, target, link }) => {
  render(<MemoryRouter initialEntries={[{ pathname: '/intro', state }]}><LandingPage /></MemoryRouter>);
  expect(replace).toHaveBeenCalledExactlyOnceWith(target);
  expect(screen.getByRole('link', { name: link }).getAttribute('href')).toBe(target);
  expect(screen.queryByRole('textbox')).toBeNull();
});
