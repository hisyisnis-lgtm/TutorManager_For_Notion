import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ModalCard } from './shared.jsx';
import { HomeScreen } from './HomeScreen.jsx';
import { PauseModal } from './PauseModal.jsx';
import { TitleScreen } from './TitleScreen.jsx';

vi.mock('../tgSfx.js', () => ({ play: vi.fn(), isSfxMuted: () => true, setSfxMuted: vi.fn() }));

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  localStorage.setItem('tab_tips_v1', JSON.stringify({ 'game-home': true }));
  localStorage.setItem('tg_home_intro', '1');
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function DialogHarness() {
  const [open, setOpen] = useState(false);
  const [nested, setNested] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>열기</button>
    {open && <ModalCard ariaLabel="첫 안내" onClose={() => setOpen(false)}>
      <button onClick={() => setNested(true)}>다음 안내</button>
      <button onClick={() => setOpen(false)}>닫기</button>
      {nested && <ModalCard ariaLabel="두 번째 안내" onClose={() => setNested(false)} zIndex={62}>
        <button onClick={() => setNested(false)}>안쪽 닫기</button>
      </ModalCard>}
    </ModalCard>}
  </>;
}

describe('게임 모달의 키보드 접근', () => {
  it('초점을 모달 안에 가두고 Escape 후 열기 버튼으로 돌려준다', async () => {
    render(<DialogHarness />);
    const trigger = screen.getByRole('button', { name: '열기' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '첫 안내' });
    const first = within(dialog).getByRole('button', { name: '다음 안내' });
    const last = within(dialog).getByRole('button', { name: '닫기' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('중첩 안내는 맨 위 창만 닫고 바깥 안내의 버튼으로 돌아온다', async () => {
    render(<DialogHarness />);
    fireEvent.click(screen.getByRole('button', { name: '열기' }));
    const trigger = screen.getByRole('button', { name: '다음 안내' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: '두 번째 안내' })).toBeTruthy();
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '두 번째 안내' })).toBeNull());
    expect(screen.getByRole('dialog', { name: '첫 안내' })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('일시정지에서 Escape를 누르면 게임을 계속한다', () => {
    const onResume = vi.fn();
    render(<PauseModal score={40} combo={2} onResume={onResume} />);
    fireEvent.keyDown(screen.getByRole('dialog', { name: '잠깐 멈췄어요' }), { key: 'Escape' });
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('성조 상세는 닫기 버튼에 초점을 놓고 시트 종료 후 캐릭터로 돌려준다', async () => {
    render(<HomeScreen />);
    const trigger = screen.getByRole('button', { name: '2성 상세 보기' });
    expect(trigger.tagName).toBe('BUTTON');
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '2성 상세' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '2성 상세 닫기' }));
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: '2성 상세' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('타이틀은 이름 있는 기본 버튼으로 시작할 수 있다', () => {
    const onStart = vi.fn();
    render(<TitleScreen onStart={onStart} />);
    const start = screen.getByRole('button', { name: '성조다락방 시작' });
    expect(start.tagName).toBe('BUTTON');
    expect(start.tabIndex).toBe(0);
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
