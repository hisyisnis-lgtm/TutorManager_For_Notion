import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setAuth, clearAuth } from '../api/authUtils.js';
import { notifyAuthChange } from '../api/authState.js';
import { fixtureSession } from '../api/authFixtures.js';
import NotificationsPage from './NotificationsPage.jsx';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.location.hash = '#/notifications';
  Element.prototype.scrollIntoView = vi.fn();
  setAuth(fixtureSession());
});
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); notifyAuthChange(); vi.unstubAllGlobals(); });
const renderPage = (initialEntry = '/notifications') => render(
  <MemoryRouter initialEntries={[initialEntry]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <NotificationsPage />
  </MemoryRouter>,
);
const message = JSON.stringify({ event: 'message', id: 'fixture', message: '가상 알림', time: 1 });

describe('강사 알림 인증 프록시', () => {
  it('토픽을 브라우저에 두지 않고 Worker에 강사 인증을 붙여 이력·스트림을 요청한다', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(`${message}\n`));
    vi.stubGlobal('fetch', fetch);
    renderPage();
    await screen.findByText('가상 알림');
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    for (const [url, options] of fetch.mock.calls) {
      expect(url).toContain('/notifications');
      expect(url).not.toContain('ntfy.sh');
      expect(options.headers.Authorization).toBe(`Bearer ${localStorage.getItem('auth_token')}`);
      expect(options.cache).toBe('no-store');
    }
    expect(localStorage.getItem('teacher_push_notifications')).toBeNull();
    act(() => clearAuth());
    expect(screen.queryByText('가상 알림')).toBeNull();
    expect(sessionStorage.getItem('teacher_push_notifications')).toBeNull();
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('로그아웃 후 늦게 도착한 알림 이력은 저장하거나 표시하지 않는다', async () => {
    let respond;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { respond = resolve; })));
    renderPage();
    act(() => clearAuth());
    await act(async () => respond(new Response(message)));
    expect(screen.queryByText('가상 알림')).toBeNull();
    expect(sessionStorage.getItem('teacher_push_notifications')).toBeNull();
  });

  it('알림 상세 조회가 불가능하면 비밀 토픽 입력 대신 관련 화면을 안내한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    renderPage();
    expect(await screen.findByText('알림 상세 내역을 표시할 수 없어요')).toBeTruthy();
    expect(screen.getByText('수업·상담 등 자세한 정보는 강사앱의 해당 화면에서 확인해 주세요.')).toBeTruthy();
    expect(screen.queryByText(/ntfy.sh/)).toBeNull();
  });

  it('푸시 알림의 id로 진입하면 해당 알림 전체 내용을 팝업으로 표시한다', async () => {
    const detailed = JSON.stringify({
      event: 'message', id: 'fixture', title: '일일리포트',
      message: '첫 번째 요약\n\n두 번째 상세 내용까지 전부 표시', time: 1,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`${detailed}\n`)));

    renderPage('/notifications?id=fixture');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('일일리포트')).toBeTruthy();
    expect(within(dialog).getByText(/두 번째 상세 내용까지 전부 표시/)).toBeTruthy();
    expect(screen.getAllByText(/두 번째 상세 내용까지 전부 표시/)[0].className).toContain('whitespace-pre-wrap');
  });
});
