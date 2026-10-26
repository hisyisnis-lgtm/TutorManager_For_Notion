import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomeworkProgressOverlay from './HomeworkProgressOverlay.jsx';
import { Dialog, DialogContent, DialogTitle } from '../shadcn/dialog';

let frames;
let frameId;
let now;
let motion;
let motionListeners;
const glyph = () => document.querySelector('.homework-progress-glyph');
const advance = (duration) => act(() => {
  while (duration > 0) {
    const step = Math.min(duration, 20);
    duration -= step; now += step;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(now));
  }
});

beforeEach(() => {
  frames = new Map(); frameId = 0; now = 0; motionListeners = new Set();
  motion = { matches: false,
    addEventListener: (_name, handler) => motionListeners.add(handler),
    removeEventListener: (_name, handler) => motionListeners.delete(handler),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => motion));
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { frames.set(++frameId, callback); return frameId; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id) => frames.delete(id)));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('숙제 진행 오버레이', () => {
  it('단계가 없으면 배경을 막지 않고 작업이 끝나면 즉시 닫고 RAF를 정리한다', () => {
    const { rerender } = render(<HomeworkProgressOverlay />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(frames.size).toBe(0);
    rerender(<HomeworkProgressOverlay stage="checking" />);
    expect(screen.getByRole('dialog', { name: '파일 용량을 확인하고 있어요' })).toBeTruthy();
    expect(frames.size).toBe(1);
    rerender(<HomeworkProgressOverlay stage={null} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(frames.size).toBe(0);
    expect(motionListeners.size).toBe(0);
  });

  it('각 단계는 한 번 진입한 뒤 같은 아이콘의 idle만 반복한다', () => {
    render(<HomeworkProgressOverlay stage="compressing" />);
    advance(660);
    expect(glyph().dataset.motion).toBe('idle');
    expect(glyph().dataset.stage).toBe('compressing');
    advance(6000);
    expect(glyph().dataset.motion).toBe('idle');
    expect(glyph().dataset.stage).toBe('compressing');
  });

  it('실제 전송 문구가 바뀌어도 동일 단계의 애니메이션은 재시작하지 않는다', () => {
    const { rerender } = render(<HomeworkProgressOverlay stage="uploading" detail="전송 10%" />);
    advance(660);
    rerender(<HomeworkProgressOverlay stage="uploading" detail="전송 45%" />);
    expect(screen.getByRole('status').textContent).toContain('전송 45%');
    expect(glyph().dataset.motion).toBe('idle');
    expect(frames.size).toBe(1);
  });

  it('진행 중 연속 변경되면 현재 out을 끝낸 뒤 최신 단계로 바로 진입한다', () => {
    const { rerender } = render(<HomeworkProgressOverlay stage="checking" />);
    advance(660);
    rerender(<HomeworkProgressOverlay stage="compressing" />);
    expect(glyph().dataset.motion).toBe('out');
    advance(100);
    rerender(<HomeworkProgressOverlay stage="uploading" />);
    rerender(<HomeworkProgressOverlay stage="saving" />);
    advance(260);
    expect(glyph().dataset.stage).toBe('saving');
    expect(glyph().dataset.motion).toBe('in');
    advance(660);
    expect(glyph().dataset.motion).toBe('idle');
  });

  it('빠른 완료 후에는 완료 아이콘을 유지하며 RAF를 멈춘다', () => {
    const { rerender } = render(<HomeworkProgressOverlay stage="checking" />);
    rerender(<HomeworkProgressOverlay stage="complete" message="숙제 제출 완료" />);
    advance(1000);
    expect(glyph().dataset.stage).toBe('complete');
    expect(glyph().dataset.motion).toBe('idle');
    expect(frames.size).toBe(0);
    expect(screen.getByRole('status').textContent).toContain('숙제 제출 완료');
    rerender(<HomeworkProgressOverlay stage="deleting" />);
    advance(1020);
    expect(glyph().dataset.stage).toBe('deleting');
    expect(glyph().dataset.motion).toBe('idle');
    expect(frames.size).toBe(1);
  });

  it('움직임 줄이기에서는 정적 아이콘으로 최신 단계를 즉시 알린다', () => {
    motion.matches = true;
    const { rerender } = render(<HomeworkProgressOverlay stage="checking" />);
    expect(frames.size).toBe(0);
    expect(glyph().dataset.motion).toBe('idle');
    rerender(<HomeworkProgressOverlay stage="uploading" />);
    expect(glyph().dataset.stage).toBe('uploading');
    expect(frames.size).toBe(0);
    act(() => { motion.matches = false; motionListeners.forEach((listener) => listener()); });
    expect(frames.size).toBe(1);
    act(() => { motion.matches = true; motionListeners.forEach((listener) => listener()); });
    expect(frames.size).toBe(0);
    expect(glyph().dataset.motion).toBe('idle');
  });

  it('StrictMode에서도 RAF와 미디어 리스너를 한 개씩만 유지한다', () => {
    const { unmount } = render(<StrictMode><HomeworkProgressOverlay stage="preparing" /></StrictMode>);
    expect(frames.size).toBe(1);
    expect(motionListeners.size).toBe(1);
    advance(660);
    expect(glyph().dataset.motion).toBe('idle');
    unmount();
    expect(frames.size).toBe(0);
    expect(motionListeners.size).toBe(0);
  });

  it('첨부 모달 위에서 배경과 ESC를 막고 닫힌 뒤 기존 포커스로 돌아간다', async () => {
    let finish;
    function Nested() {
      const [stage, setStage] = useState(null);
      finish = () => setStage(null);
      return <Dialog defaultOpen><DialogContent aria-describedby={undefined}>
        <DialogTitle>첨부 파일</DialogTitle>
        <button onClick={() => setStage('preparing')}>파일 준비</button>
        <HomeworkProgressOverlay stage={stage} />
      </DialogContent></Dialog>;
    }
    render(<Nested />);
    const trigger = screen.getByRole('button', { name: '파일 준비' });
    trigger.focus(); fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: '파일을 준비하고 있어요' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '파일 준비' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: '파일을 준비하고 있어요' })).toBeTruthy();
    act(() => finish());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.getByRole('button', { name: '파일 준비' })).toBeTruthy();
  });
});
