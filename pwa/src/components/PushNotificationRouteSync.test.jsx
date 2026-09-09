import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HashRouter, useLocation, useNavigate } from 'react-router-dom';
import { setAuth } from '../api/authUtils.js';
import { notifyAuthChange } from '../api/authState.js';
import { fixtureSession } from '../api/authFixtures.js';
import PushNotificationRouteSync from './PushNotificationRouteSync.jsx';

function RouterProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <output data-testid="route">{location.pathname}{location.search}</output>
    <button onClick={() => navigate('/notifications?via=push', { replace: true })}>닫기</button>
  </>;
}

function renderRouter() {
  return render(<HashRouter>
    <PushNotificationRouteSync />
    <RouterProbe />
  </HashRouter>);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setAuth(fixtureSession());
  window.history.replaceState(null, '', '/#/home');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  notifyAuthChange();
  delete document.visibilityState;
});

describe('native 알림 주소와 강사 라우터 동기화', () => {
  it.each(['focus', 'pageshow', 'visibilitychange'])('이벤트 없이 URL만 바뀐 warm query는 %s 복귀에서 상세 화면으로 동기화한다', (type) => {
    renderRouter();
    window.history.replaceState(window.history.state, '', '/?push_notification=warm-fixture');
    expect(screen.getByTestId('route').textContent).toBe('/home');
    act(() => (type === 'visibilitychange' ? document : window).dispatchEvent(new Event(type)));
    expect(screen.getByTestId('route').textContent).toBe('/notifications?id=warm-fixture&via=push');
    expect(window.location.search).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    act(() => window.dispatchEvent(new Event('focus')));
    expect(screen.getByTestId('route').textContent).toBe('/notifications?via=push');
  });

  it('popstate와 hashchange가 모두 누락된 native hash도 포커스 복귀에서 동기화한다', () => {
    renderRouter();
    window.history.replaceState(window.history.state, '', '/#/notifications?id=hash-fixture&via=push');
    expect(screen.getByTestId('route').textContent).toBe('/home');
    act(() => window.dispatchEvent(new Event('focus')));
    expect(screen.getByTestId('route').textContent).toBe('/notifications?id=hash-fixture&via=push');
  });

  it('popstate 없이 hashchange만 전달되어도 알림 상세를 동기화한다', () => {
    renderRouter();
    window.history.replaceState(window.history.state, '', '/#/notifications?id=hash-only&via=push');
    act(() => window.dispatchEvent(new Event('hashchange')));
    expect(screen.getByTestId('route').textContent).toBe('/notifications?id=hash-only&via=push');
  });

  it.each(['/#/students', '/#/intro', '/personal/student#/notifications?id=fixture'])('학생·공개·알림 외 URL은 강사 상세로 보정하지 않는다: %s', (url) => {
    renderRouter();
    window.history.replaceState(window.history.state, '', url);
    act(() => window.dispatchEvent(new Event('focus')));
    expect(screen.getByTestId('route').textContent).toBe('/home');
  });

  it('로그아웃 후 늦은 복귀 이벤트는 라우터를 변경하지 않는다', () => {
    renderRouter();
    localStorage.removeItem('auth_token');
    act(() => notifyAuthChange());
    window.history.replaceState(window.history.state, '', '/#/notifications?id=after-logout');
    act(() => window.dispatchEvent(new Event('focus')));
    expect(screen.getByTestId('route').textContent).toBe('/home');
  });

  it('이미 일치하는 알림 주소는 다시 navigate하지 않는다', () => {
    window.history.replaceState({ usr: 'preserved' }, '', '/#/notifications?id=current&via=push');
    renderRouter();
    const before = window.history.state;
    act(() => window.dispatchEvent(new Event('focus')));
    expect(window.history.state).toEqual(before);
    expect(screen.getByTestId('route').textContent).toBe('/notifications?id=current&via=push');
  });
});
