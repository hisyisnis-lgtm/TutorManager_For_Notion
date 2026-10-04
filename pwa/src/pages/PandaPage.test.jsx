import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PandaPage from './PandaPage.jsx';

const fixture = vi.hoisted(() => ({ token: 'STUDENTAAAA1', navigate: vi.fn(), fetchStudent: vi.fn() }));
vi.mock('react-router-dom', () => ({ useParams: () => ({ studentToken: fixture.token }), useNavigate: () => fixture.navigate }));
vi.mock('../api/bookingApi.js', () => ({ fetchStudentByToken: (...args) => fixture.fetchStudent(...args) }));
vi.mock('../components/ui/PandaWidget.jsx', () => ({
  PANDA_FEED_KEY: 'panda_fed_total', getPandaStorageKey: token => `panda_fed_total_${token}`,
  default: props => <div data-testid="game" data-token={props.studentToken} data-sources={JSON.stringify(props.foodSources)} />,
}));
vi.mock('../components/ui/PandaMascot.jsx', () => ({ default: () => <span /> }));

beforeEach(() => {
  fixture.token = 'STUDENTAAAA1'; fixture.fetchStudent.mockReset(); fixture.navigate.mockReset();
  vi.stubGlobal('matchMedia', vi.fn(query => ({ media: query, matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('랴오랴오 페이지의 학생 조회', () => {
  it('이전 학생의 늦은 응답이 현재 학생과 먹이를 덮어쓰지 않는다', async () => {
    let resolveFirst;
    fixture.fetchStudent.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ sharedAt: '2026-09-01', completedMinutes: 90, submittedHomeworkFood: 2, feedbackSeenHomeworkFood: 1 });
    const { rerender } = render(<PandaPage />);
    fixture.token = 'STUDENTBBBB2';
    rerender(<PandaPage />);
    await waitFor(() => expect(screen.getByTestId('game').dataset.token).toBe('STUDENTBBBB2'));
    resolveFirst({ sharedAt: '2026-09-01', completedMinutes: 9000 });
    await waitFor(() => expect(JSON.parse(screen.getByTestId('game').dataset.sources).map(source => source.count)).toEqual([3, 2, 1]));
  });

  it('도움말은 자동으로 열리지 않고 헤더 버튼으로만 연다', async () => {
    fixture.fetchStudent.mockResolvedValue({ sharedAt: '2026-09-01', completedMinutes: 30 });
    vi.spyOn(window.Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage blocked'); });
    render(<PandaPage />);
    await waitFor(() => expect(screen.getByTestId('game')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '도움말' }));
    expect(screen.getByRole('dialog', { name: '랴오랴오와 함께 자라요' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '알겠어요' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('학생페이지 공유 전에는 모든 먹이 출처를 0으로 전달한다', async () => {
    fixture.fetchStudent.mockResolvedValue({ completedMinutes: 90, submittedHomeworkFood: 2, feedbackSeenHomeworkFood: 1 });
    render(<PandaPage />);
    await waitFor(() => expect(JSON.parse(screen.getByTestId('game').dataset.sources).map(source => source.count)).toEqual([0, 0, 0]));
  });

  it.each([
    ['도움말', '랴오랴오와 함께 자라요', '알겠어요'],
    ['뒤로', '잠깐, 벌써 가려고요?', '계속하기'],
  ])('%s 창은 제목에 초점을 주고 닫으면 진입 버튼으로 복귀한다', async (label, title, close) => {
    fixture.fetchStudent.mockResolvedValue({ sharedAt: '2026-09-01', completedMinutes: 30 });
    render(<PandaPage />);
    await waitFor(() => expect(screen.getByTestId('game')).toBeTruthy());
    const trigger = screen.getByRole('button', { name: label, exact: true });
    trigger.focus(); fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: title }));
    fireEvent.click(screen.getByRole('button', { name: close }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('도움말과 나가기의 닫힘 모션 중 동작 줄이기를 켜면 팝업과 배경을 제거한다', async () => {
    const listeners = new Set();
    let reduced = false;
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      get matches() { return reduced; },
      addEventListener: (_, listener) => listeners.add(listener),
      removeEventListener: (_, listener) => listeners.delete(listener),
    })));
    const originalStyle = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation(node => {
      const style = originalStyle(node);
      const motion = node.classList.contains('panda-ui-dialog') ? 'dialog'
        : node.classList.contains('panda-ui-overlay') ? 'fade' : null;
      if (!motion) return style;
      // jsdom does not play CSS animations; expose the live names Radix uses for exit presence.
      return new Proxy(style, { get(target, key) {
        if (key === 'animationName') return `panda-ui-${motion}-${node.dataset.state === 'open' ? 'in' : 'out'}`;
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    });
    fixture.fetchStudent.mockResolvedValue({ sharedAt: '2026-09-01', completedMinutes: 30 });
    render(<PandaPage />);
    await waitFor(() => expect(screen.getByTestId('game')).toBeTruthy());
    for (const [label, title, close] of [
      ['도움말', '랴오랴오와 함께 자라요', '알겠어요'],
      ['뒤로', '잠깐, 벌써 가려고요?', '계속하기'],
    ]) {
      act(() => { reduced = false; listeners.forEach(listener => listener({ matches: false })); });
      const trigger = screen.getByRole('button', { name: label, exact: true });
      trigger.focus(); fireEvent.click(trigger);
      const dialog = screen.getByRole('dialog', { name: title });
      const overlay = document.querySelector('.panda-page__overlay[data-state="open"]');
      fireEvent.animationStart(dialog); fireEvent.animationStart(overlay);
      await act(async () => fireEvent.click(screen.getByRole('button', { name: close })));
      expect(dialog.isConnected).toBe(true);
      expect(overlay.isConnected).toBe(true);
      expect(dialog.dataset.state).toBe('closed');
      expect(dialog.hasAttribute('inert')).toBe(true);
      expect(dialog.getAttribute('aria-hidden')).toBe('true');
      act(() => { reduced = true; listeners.forEach(listener => listener({ matches: true })); });
      expect(dialog.isConnected).toBe(false);
      expect(overlay.isConnected).toBe(false);
      await waitFor(() => expect(document.activeElement).toBe(trigger));
    }
    expect(fixture.navigate).not.toHaveBeenCalled();
  });
});
