import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
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
let navigatePage;
let pageLocation;
function RouterProbe() {
  navigatePage = useNavigate();
  pageLocation = useLocation();
  return null;
}
const renderPage = (initialEntry = '/notifications') => render(
  <MemoryRouter initialEntries={[initialEntry]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <RouterProbe />
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
    expect(await within(dialog).findByText('일일리포트')).toBeTruthy();
    expect(within(dialog).getByText(/두 번째 상세 내용까지 전부 표시/)).toBeTruthy();
    expect(screen.getAllByText(/두 번째 상세 내용까지 전부 표시/)[0].className).toContain('whitespace-pre-wrap');
  });

  it('조회가 느려도 팝업을 먼저 열고 원문의 줄바꿈·빈 줄을 보존한다', async () => {
    let respond;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { respond = resolve; })));
    renderPage('/notifications?id=fixture');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('알림 내용을 불러오는 중이에요.')).toBeTruthy();
    const body = '[오늘 수업]\n오후 3시 수업\n\n[숙제]\n제출 확인';
    await act(async () => respond(new Response(JSON.stringify({ event: 'message', id: 'fixture', message: body, time: 1 }))));
    const description = within(dialog).getByText(/제출 확인/);
    expect(description.textContent).toBe(body);
    expect(description.className).toContain('whitespace-pre-wrap');
  });

  it('알림 내역에 없는 id도 조용히 무시하지 않고 팝업에서 안내한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('')));
    renderPage('/notifications?id=missing');
    expect(await within(screen.getByRole('dialog')).findByText('보관된 알림 내역에서 이 알림을 찾을 수 없어요.')).toBeTruthy();
  });

  it('캐시된 짧은 푸시 본문을 같은 id의 서버 전체 본문으로 교체한다', async () => {
    const short = { event: 'message', id: 'fixture', title: '요약 제목', message: '짧은 요약…', time: 1 };
    sessionStorage.setItem('teacher_push_notifications', JSON.stringify([short]));
    let respond;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { respond = resolve; })));
    renderPage('/notifications?id=fixture');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(short.message)).toBeTruthy();
    const full = { ...short, title: '서버 전체 제목', message: '[전체 내용]\n\n마지막 줄까지 표시' };
    await act(async () => respond(new Response(JSON.stringify(full))));
    expect(within(dialog).getByText(full.title)).toBeTruthy();
    expect(within(dialog).getByText(/마지막 줄까지 표시/).textContent).toBe(full.message);
    expect(JSON.parse(sessionStorage.getItem('teacher_push_notifications'))).toEqual([full]);
  });

  it('뒤늦게 온 짧은 푸시가 전체 본문을 덮지 않으며 클릭한 이전 id를 유지한다', async () => {
    const messages = [
      { event: 'message', id: 'newest', message: '누르지 않은 최신 알림', time: 2 },
      { event: 'message', id: 'fixture', message: '클릭한 이전 알림 전체 본문', time: 1 },
    ];
    const serviceWorker = new window.EventTarget();
    vi.stubGlobal('navigator', { serviceWorker });
    const fetch = vi.fn(async () => new Response(messages.map((item) => JSON.stringify(item)).join('\n')));
    vi.stubGlobal('fetch', fetch);
    renderPage('/notifications?id=fixture');
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText(messages[1].message)).toBeTruthy();
    await act(async () => serviceWorker.dispatchEvent(new window.MessageEvent('message', { data: {
      type: 'teacher-push', notification: { ...messages[1], message: '짧은 요약…' },
    } })));
    expect(within(dialog).getByText(messages[1].message)).toBeTruthy();
    expect(within(dialog).queryByText(messages[0].message)).toBeNull();
    expect(within(dialog).queryByText('짧은 요약…')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('상세 조회 연결 오류도 팝업에서 안내한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    renderPage('/notifications?id=fixture');
    expect(await within(screen.getByRole('dialog')).findByText(/알림 내용을 불러오지 못했어요/)).toBeTruthy();
  });

  it('팝업을 닫으면 id만 지우고 같은 알림을 다시 누르거나 다른 id가 오면 다시 표시한다', async () => {
    const messages = [
      { event: 'message', id: 'fixture', title: '첫 알림', message: '첫 내용', time: 1 },
      { event: 'message', id: 'second', title: '다음 알림', message: '다음 내용', time: 2 },
    ].map((item) => JSON.stringify(item)).join('\n');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(messages)));
    renderPage('/notifications?id=fixture&view=all');
    expect(await within(screen.getByRole('dialog')).findByText('첫 내용')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: '닫기' })[0]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pageLocation.search).toBe('?view=all');

    act(() => navigatePage('/notifications?id=fixture&view=all'));
    expect(await within(screen.getByRole('dialog')).findByText('첫 내용')).toBeTruthy();
    act(() => navigatePage('/notifications?id=second'));
    expect(await within(screen.getByRole('dialog')).findByText('다음 내용')).toBeTruthy();
    expect(within(screen.getByRole('dialog')).queryByText('첫 내용')).toBeNull();
  });
});
