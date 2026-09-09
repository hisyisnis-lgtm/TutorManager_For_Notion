import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setAuth, clearAuth } from '../api/authUtils.js';
import { notifyAuthChange } from '../api/authState.js';
import { saveNtfyTopic } from '../api/ntfy.js';
import { fixtureSession } from '../api/authFixtures.js';
import NotificationsPage from './NotificationsPage.jsx';

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); setAuth(fixtureSession());
  saveNtfyTopic('fixture-topic');
});
afterEach(() => {
  cleanup(); localStorage.clear(); sessionStorage.clear(); notifyAuthChange();
  vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers();
});
const renderPage = () => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><NotificationsPage /></MemoryRouter>);
const message = JSON.stringify({ event: 'message', id: 'fixture', message: '가상 알림\n두 번째 줄', time: 1 });
const mockHistory = () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(`${message}\n`))
    .mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal('fetch', fetch);
  return fetch;
};

describe('설정한 ntfy 코드로 알림 연결', () => {
  it('같은 토픽의 최근 24시간 이력과 스트림을 요청하고 앱 인증정보는 전송하지 않는다', async () => {
    const fetch = mockHistory();
    renderPage();
    const body = await screen.findByText(/가상 알림/);
    expect(body.textContent).toBe('가상 알림\n두 번째 줄');
    expect(body.className).toContain('whitespace-pre-wrap');
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[0][0]).toBe('https://ntfy.sh/fixture-topic/json?poll=1&since=24h');
    expect(fetch.mock.calls[1][0]).toBe('https://ntfy.sh/fixture-topic/sse');
    for (const [, options] of fetch.mock.calls) {
      expect(options.headers).toBeUndefined();
      expect(options.credentials).toBe('omit');
      expect(options.cache).toBe('no-store');
      expect(options.redirect).toBe('error');
    }
    expect(localStorage.getItem('ntfy_notifications')).toBeNull();
    expect(sessionStorage.getItem('ntfy_history_topic')).toBe('fixture-topic');
    act(() => clearAuth());
    expect(screen.queryByText(/가상 알림/)).toBeNull();
    expect(sessionStorage.getItem('ntfy_notifications')).toBeNull();
    expect(fetch.mock.calls[1][1].signal.aborted).toBe(true);
  });

  it('코드가 없으면 연결 안내와 설정 링크를 보이고 조회하지 않는다', () => {
    saveNtfyTopic('');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    renderPage();
    expect(screen.getByRole('link', { name: '알림 코드 설정' }).getAttribute('href')).toBe('/settings');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('로그아웃 후 늦게 도착한 이력은 저장하거나 표시하지 않는다', async () => {
    let respond;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { respond = resolve; })));
    renderPage();
    act(() => clearAuth());
    await act(async () => respond(new Response(message)));
    expect(screen.queryByText(/가상 알림/)).toBeNull();
    expect(sessionStorage.getItem('ntfy_notifications')).toBeNull();
  });

  it.each([401, 403])('ntfy의 %s 응답은 연결 오류이지 강사 로그아웃이 아니다', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status })));
    const token = localStorage.getItem('auth_token');
    renderPage();
    expect(await screen.findByText('ntfy 연결 오류 · 자동 재연결 중')).toBeTruthy();
    expect(localStorage.getItem('auth_token')).toBe(token);
  });

  it('실시간 SSE의 분할 청크·중복 알림을 처리하고 연결 해제 시 읽기를 취소한다', async () => {
    let source;
    const cancel = vi.fn();
    const stream = new globalThis.ReadableStream({ start(controller) { source = controller; }, cancel });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(''))
      .mockResolvedValueOnce(new Response(stream)));
    renderPage();
    await screen.findByText('ntfy 연결됨');
    const encoder = new TextEncoder();
    await act(async () => {
      source.enqueue(encoder.encode('event: message\ndata: ' + message.slice(0, 20)));
      source.enqueue(encoder.encode(message.slice(20) + '\n\ndata: ' + message + '\n\n'));
    });
    expect(screen.getAllByText(/가상 알림/)).toHaveLength(1);
    act(() => saveNtfyTopic(''));
    await act(async () => { source.enqueue(encoder.encode('\n')); });
    await waitFor(() => expect(cancel).toHaveBeenCalled());
    expect(screen.queryByText(/가상 알림/)).toBeNull();
  });

  it('토픽 변경 후 이전 토픽의 늦은 응답과 캐시를 표시하지 않는다', async () => {
    let respond;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { respond = resolve; }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ event: 'message', id: 'new', time: 2, message: '새 토픽 알림' })))
      .mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetch);
    renderPage();
    act(() => saveNtfyTopic('new-topic'));
    await screen.findByText('새 토픽 알림');
    await act(async () => respond(new Response(message)));
    expect(screen.queryByText(/가상 알림/)).toBeNull();
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(sessionStorage.getItem('ntfy_history_topic')).toBe('new-topic');
  });

  it('다른 탭에서 연결을 해제해도 현재 연결과 알림을 정리한다', async () => {
    const fetch = mockHistory(); renderPage();
    await screen.findByText(/가상 알림/);
    act(() => {
      localStorage.removeItem('ntfy_topic');
      window.dispatchEvent(new StorageEvent('storage', { key: 'ntfy_topic', newValue: null }));
    });
    expect(screen.queryByText(/가상 알림/)).toBeNull();
    expect(screen.getByRole('link', { name: '알림 코드 설정' })).toBeTruthy();
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('백그라운드에서 돌아오면 이전 요청을 취소하고 이력을 다시 조회한다', async () => {
    const fetch = mockHistory(); renderPage();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(fetch.mock.calls[1][1].signal.aborted).toBe(true);
    visibility.mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[2][0]).toContain('/json?poll=1&since=24h');
    expect(fetch.mock.calls[2][1].signal.aborted).toBe(false);
  });

  it('저장된 다른 토픽의 이력은 초기 화면에도 노출하지 않는다', () => {
    sessionStorage.setItem('ntfy_history_topic', 'different-topic');
    sessionStorage.setItem('ntfy_notifications', `[${message}]`);
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderPage();
    expect(screen.queryByText(/가상 알림/)).toBeNull();
  });
});
