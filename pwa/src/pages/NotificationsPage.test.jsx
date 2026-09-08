import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setAuth, clearAuth } from '../api/authUtils.js';
import { notifyAuthChange } from '../api/authState.js';
import { fixtureSession } from '../api/authFixtures.js';
import NotificationsPage from './NotificationsPage.jsx';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setAuth(fixtureSession()); });
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); notifyAuthChange(); vi.unstubAllGlobals(); });
const renderPage = () => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><NotificationsPage /></MemoryRouter>);
const message = JSON.stringify({ event: 'message', id: 'fixture', message: '가상 알림', time: 1 });

describe('강사 알림 인증 프록시', () => {
  it('토픽을 브라우저에 두지 않고 Worker에 강사 인증을 붙여 이력·스트림을 요청한다', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(`${message}\n`))
      .mockImplementationOnce(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetch);
    renderPage();
    await screen.findByText('가상 알림');
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    for (const [url, options] of fetch.mock.calls) {
      expect(url).toContain('/notifications');
      expect(url).not.toContain('ntfy.sh');
      expect(options.headers.Authorization).toBe(`Bearer ${localStorage.getItem('auth_token')}`);
      expect(options.cache).toBe('no-store');
    }
    expect(fetch.mock.calls[1][0]).toContain('?stream=1');
    expect(localStorage.getItem('ntfy_notifications')).toBeNull();
    act(() => clearAuth());
    expect(screen.queryByText('가상 알림')).toBeNull();
    expect(sessionStorage.getItem('ntfy_notifications')).toBeNull();
    expect(fetch.mock.calls[1][1].signal.aborted).toBe(true);
  });

  it('로그아웃 후 늦게 도착한 알림 이력은 저장하거나 표시하지 않는다', async () => {
    let respond;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { respond = resolve; })));
    renderPage();
    act(() => clearAuth());
    await act(async () => respond(new Response(message)));
    expect(screen.queryByText('가상 알림')).toBeNull();
    expect(sessionStorage.getItem('ntfy_notifications')).toBeNull();
  });

  it('서버 알림 미설정은 비밀 토픽 입력 대신 연결 준비 안내로 표시한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    renderPage();
    expect(await screen.findByText('알림 연결이 준비되지 않았어요')).toBeTruthy();
    expect(screen.queryByText(/ntfy.sh/)).toBeNull();
  });
});
