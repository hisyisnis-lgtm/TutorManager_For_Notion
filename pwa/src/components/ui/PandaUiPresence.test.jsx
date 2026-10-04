import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import PandaUiPresence from './PandaUiPresence.jsx';

let mediaListeners;
beforeEach(() => {
  vi.useFakeTimers();
  mediaListeners = new Set();
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false,
    addEventListener: (_, listener) => mediaListeners.add(listener),
    removeEventListener: (_, listener) => mediaListeners.delete(listener),
  })));
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    transitionProperty: 'opacity, translate', transitionDuration: '300ms, 0.1s', transitionDelay: '11ms, 50ms',
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const notice = text => <div className="panda-ui-toast" role="status"><span>{text}</span></div>;
const advance = time => act(() => vi.advanceTimersByTime(time));

describe('Panda transient notice presence', () => {
  it('dismissal keeps only the inert visual until the computed CSS duration, including in StrictMode', () => {
    const view = render(<StrictMode><PandaUiPresence>{notice('첫 안내')}</PandaUiPresence></StrictMode>);
    const node = document.querySelector('.panda-ui-toast');
    view.rerender(<StrictMode><PandaUiPresence>{null}</PandaUiPresence></StrictMode>);
    expect(node.dataset.state).toBe('closed');
    expect(node.getAttribute('aria-hidden')).toBe('true');
    expect(node.hasAttribute('inert')).toBe(true);
    expect(node.hasAttribute('role')).toBe(false);
    advance(310);
    expect(node.isConnected).toBe(true);
    advance(1);
    expect(node.isConnected).toBe(false);
  });

  it('a new notice interrupts exit on the same node and an old timeout/end cannot dismiss it', () => {
    const view = render(<PandaUiPresence>{notice('첫 안내')}</PandaUiPresence>);
    const node = document.querySelector('.panda-ui-toast');
    view.rerender(<PandaUiPresence>{null}</PandaUiPresence>);
    advance(80);
    view.rerender(<PandaUiPresence>{notice('새 안내')}</PandaUiPresence>);
    expect(document.querySelector('.panda-ui-toast')).toBe(node);
    expect(node.textContent).toBe('새 안내');
    expect(node.dataset.state).toBe('open');
    expect(node.hasAttribute('inert')).toBe(false);
    fireEvent.transitionEnd(node, { propertyName: 'opacity' });
    advance(1000);
    expect(node.isConnected).toBe(true);
    view.rerender(<PandaUiPresence>{notice('연속 안내')}</PandaUiPresence>);
    expect(node.textContent).toBe('연속 안내');
    expect(document.querySelectorAll('.panda-ui-toast')).toHaveLength(1);
  });

  it('ignores descendant transition ends and repeated dismissals keep the original deadline', () => {
    const view = render(<PandaUiPresence>{notice('안내')}</PandaUiPresence>);
    const node = document.querySelector('.panda-ui-toast');
    view.rerender(<PandaUiPresence>{null}</PandaUiPresence>);
    fireEvent.transitionEnd(node.firstChild, { propertyName: 'opacity' });
    advance(200);
    view.rerender(<PandaUiPresence>{null}</PandaUiPresence>);
    expect(node.isConnected).toBe(true);
    advance(111);
    expect(node.isConnected).toBe(false);
  });

  it('switching reduced motion on removes an exiting notice immediately and clears its fallback', () => {
    const view = render(<PandaUiPresence>{notice('안내')}</PandaUiPresence>);
    view.rerender(<PandaUiPresence>{null}</PandaUiPresence>);
    expect(document.querySelector('.panda-ui-toast')).toBeTruthy();
    act(() => mediaListeners.forEach(listener => listener({ matches: true })));
    expect(document.querySelector('.panda-ui-toast')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    view.unmount();
    expect(mediaListeners.size).toBe(0);
  });

  it('the surface opacity transition end removes the notice before the fallback fires', () => {
    const view = render(<PandaUiPresence>{notice('안내')}</PandaUiPresence>);
    view.rerender(<PandaUiPresence>{null}</PandaUiPresence>);
    const event = new Event('transitionend', { bubbles: true });
    Object.defineProperty(event, 'propertyName', { value: 'opacity' });
    fireEvent(document.querySelector('.panda-ui-toast'), event);
    expect(document.querySelector('.panda-ui-toast')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('no CSS transition has no artificial exit delay', () => {
    window.getComputedStyle.mockReturnValue({ transitionProperty: 'none', transitionDuration: '0s', transitionDelay: '0s' });
    const view = render(<PandaUiPresence>{notice('안내')}</PandaUiPresence>);
    view.rerender(<PandaUiPresence>{null}</PandaUiPresence>);
    expect(document.querySelector('.panda-ui-toast')).toBeNull();
  });
});
