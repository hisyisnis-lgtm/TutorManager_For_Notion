import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PandaWardrobeArtwork from './PandaWardrobeArtwork.jsx';
import { PANDA_ART_VIEWBOX, PANDA_PART_LAYERS } from '../../constants/pandaWardrobe.js';

const layers = Object.values(PANDA_PART_LAYERS).flat();
const originals = root => [...root.querySelectorAll('image[data-part^="accessory-"]')];
const flashes = root => [...root.querySelectorAll('[data-equip-flash]')];
const loadAll = root => {
  originals(root).forEach(image => fireEvent.load(image));
  flashes(root).forEach(image => fireEvent.load(image));
};
function Figure({ wardrobe }) {
  return <svg>{layers.map(slot => <g key={slot} data-layer={slot}>
    <PandaWardrobeArtwork wardrobe={wardrobe} slot={slot} motion={slot === 'hat-back' ? 'head' : slot === 'hand' ? 'arm-right' : undefined} />
  </g>)}</svg>;
}
const setup = wardrobe => render(<Figure wardrobe={wardrobe} />, { wrapper: StrictMode });
let frames, frameId, media, mediaListeners;
const nextFrame = () => act(() => {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach(callback => callback(0));
});
const advance = time => act(() => vi.advanceTimersByTime(time));
const setReducedMotion = value => act(() => {
  media.matches = value;
  [...mediaListeners].forEach(callback => callback({ matches: value }));
});

beforeEach(() => {
  vi.useFakeTimers();
  frames = new Map(); frameId = 0; mediaListeners = new Set();
  media = {
    matches: false,
    addEventListener: vi.fn((type, listener) => mediaListeners.add(listener)),
    removeEventListener: vi.fn((type, listener) => mediaListeners.delete(listener)),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => media));
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { frames.set(++frameId, callback); return frameId; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn(id => frames.delete(id)));
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('파츠 장착의 흰 실루엣에서 원래 색 드러내기', () => {
  it('초기 착장과 같은 아이템의 객체 갱신은 흰 효과나 이미지 재마운트를 만들지 않는다', () => {
    const wardrobe = { hat: 'gardener', costume: 'reader' };
    const view = setup(wardrobe);
    const images = originals(view.container);
    loadAll(view.container);
    expect(flashes(view.container)).toHaveLength(0);
    expect(frames.size).toBe(0);
    view.rerender(<Figure wardrobe={{ ...wardrobe }} />);
    expect(originals(view.container)).toEqual(images);
    expect(flashes(view.container)).toHaveLength(0);
    expect(images.every(image => !image.classList.contains('panda-wardrobe-equip-pending'))).toBe(true);
  });

  it('추가 첫 렌더부터 색 원본은 숨기고 흰 실루엣을 놓으며, 로드와 RAF 뒤 같은 흰 DOM을 걷는다', () => {
    const view = setup(null);
    view.rerender(<Figure wardrobe={{ neck: 'gardener' }} />);
    const [original] = originals(view.container), [white] = flashes(view.container);
    expect(original.classList.contains('panda-wardrobe-equip-pending')).toBe(true);
    expect(white.classList.contains('is-waiting')).toBe(true);
    expect(white.dataset.flashPhase).toBe('waiting');
    expect(white.getAttribute('href')).toBe(original.getAttribute('href'));
    for (const [index, attribute] of ['x', 'y', 'width', 'height'].entries()) {
      expect(white.getAttribute(attribute)).toBe(String(PANDA_ART_VIEWBOX[index]));
      expect(original.getAttribute(attribute)).toBe(white.getAttribute(attribute));
    }
    fireEvent.load(original);
    expect(frames.size).toBe(0);
    expect(original.classList.contains('panda-wardrobe-equip-pending')).toBe(true);
    fireEvent.load(white);
    expect(frames.size).toBe(1);
    expect(white.dataset.flashPhase).toBe('waiting');
    nextFrame();
    expect(originals(view.container)[0]).toBe(original);
    expect(flashes(view.container)[0]).toBe(white);
    expect(white.dataset.flashPhase).toBe('revealing');
    expect(original.classList.contains('panda-wardrobe-equip-pending')).toBe(false);
    advance(299);
    expect(flashes(view.container)[0]).toBe(white);
    advance(1);
    expect(flashes(view.container)).toHaveLength(0);
    expect(originals(view.container)[0]).toBe(original);
  });

  it('다른 부위는 그대로 두고 교체되는 모자의 앞뒤만 처음부터 흰색으로 표시한다', () => {
    const view = setup({ hat: 'gardener', costume: 'reader' });
    const costume = view.container.querySelector('[data-part="accessory-costume"]');
    view.rerender(<Figure wardrobe={{ hat: 'strawberry', costume: 'reader' }} />);
    expect(flashes(view.container).map(image => image.dataset.equipFlash).sort()).toEqual(['hat-back', 'hat-front']);
    expect(view.container.querySelector('[data-part="accessory-costume"]')).toBe(costume);
    expect(costume.classList.contains('panda-wardrobe-equip-pending')).toBe(false);
    expect(flashes(view.container).every(image => image.getAttribute('href').includes('/strawberry-'))).toBe(true);
    const rear = view.container.querySelector('[data-equip-flash="hat-back"]');
    expect(rear.closest('[data-motion-part="hat-back"]')).not.toBeNull();
  });

  it('코스튬과 양 소매·뒤 레이어는 모두 흰색으로 기다렸다가 같은 프레임에 함께 색을 드러낸다', () => {
    const view = setup(null);
    view.rerender(<Figure wardrobe={{ costume: 'gardener' }} />);
    const whites = flashes(view.container);
    expect(whites).toHaveLength(PANDA_PART_LAYERS.costume.length);
    expect(originals(view.container).every(image => image.classList.contains('panda-wardrobe-equip-pending'))).toBe(true);
    originals(view.container).forEach(image => fireEvent.load(image));
    whites.slice(0, -1).forEach(image => fireEvent.load(image));
    expect(frames.size).toBe(0);
    expect(whites.every(image => image.dataset.flashPhase === 'waiting')).toBe(true);
    fireEvent.load(whites.at(-1));
    expect(frames.size).toBe(1);
    nextFrame();
    expect(new Set(whites.map(image => image.dataset.flashId)).size).toBe(1);
    expect(whites.every(image => image.dataset.flashPhase === 'revealing')).toBe(true);
    advance(300);
    expect(flashes(view.container)).toHaveLength(0);
  });

  it('빠른 교체는 이전 예약 프레임을 취소하고 새 파츠의 로드 전까지 색을 노출하지 않는다', () => {
    const view = setup(null);
    view.rerender(<Figure wardrobe={{ hand: 'gardener' }} />);
    loadAll(view.container);
    expect(frames.size).toBe(1);
    const old = [...originals(view.container), ...flashes(view.container)];
    view.rerender(<Figure wardrobe={{ hand: 'reader' }} />);
    expect(frames.size).toBe(0);
    old.forEach(image => fireEvent.load(image));
    nextFrame();
    expect(flashes(view.container)[0].dataset.flashPhase).toBe('waiting');
    expect(originals(view.container)[0].classList.contains('panda-wardrobe-equip-pending')).toBe(true);
    loadAll(view.container);
    nextFrame();
    expect(flashes(view.container)[0].dataset.flashPhase).toBe('revealing');
    expect(flashes(view.container)[0].closest('[data-motion-part="hand-prop"]')).not.toBeNull();
    advance(300);
    expect(flashes(view.container)).toHaveLength(0);
  });

  it('장착을 해제하면 대기·진행 효과를 취소하고 새 효과를 만들지 않는다', () => {
    const view = setup(null);
    view.rerender(<Figure wardrobe={{ neck: 'reader' }} />);
    loadAll(view.container);
    nextFrame();
    expect(flashes(view.container)).toHaveLength(1);
    view.rerender(<Figure wardrobe={null} />);
    expect(originals(view.container)).toHaveLength(0);
    expect(flashes(view.container)).toHaveLength(0);
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(mediaListeners.size).toBe(0);
  });

  it('같은 세트를 보여주는 다른 미리보기의 로드 상태나 효과와 섞이지 않는다', () => {
    const view = render(<><Figure /><Figure /></>);
    view.rerender(<><Figure wardrobe={{ neck: 'reader' }} /><Figure wardrobe={{ neck: 'reader' }} /></>);
    const [first, second] = view.container.querySelectorAll('svg');
    loadAll(first);
    nextFrame();
    expect(flashes(first)[0].dataset.flashPhase).toBe('revealing');
    expect(flashes(second)[0].dataset.flashPhase).toBe('waiting');
    loadAll(second);
    nextFrame();
    expect(flashes(first)[0].dataset.flashId).not.toBe(flashes(second)[0].dataset.flashId);
  });

  it('동작 줄이기에서는 처음부터 정상 색으로 즉시 장착한다', () => {
    media.matches = true;
    const view = setup(null);
    view.rerender(<Figure wardrobe={{ costume: 'gardener' }} />);
    expect(originals(view.container)).toHaveLength(4);
    expect(originals(view.container).every(image => !image.classList.contains('panda-wardrobe-equip-pending'))).toBe(true);
    expect(flashes(view.container)).toHaveLength(0);
    loadAll(view.container);
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('대기 중 동작 줄이기로 바꾸면 흰 가림과 예약 프레임을 즉시 제거한다', () => {
    const view = setup(null);
    view.rerender(<Figure wardrobe={{ costume: 'gardener' }} />);
    loadAll(view.container);
    expect(frames.size).toBe(1);
    setReducedMotion(true);
    expect(flashes(view.container)).toHaveLength(0);
    expect(originals(view.container).every(image => !image.classList.contains('panda-wardrobe-equip-pending'))).toBe(true);
    expect(frames.size).toBe(0);
    expect(mediaListeners.size).toBe(0);
    setReducedMotion(false);
    view.rerender(<Figure wardrobe={{ costume: 'gardener' }} />);
    expect(flashes(view.container)).toHaveLength(0);
  });

  it('이미지 실패는 그룹의 흰 가림을 풀고 기다리던 효과를 정리한다', () => {
    const view = setup(null);
    view.rerender(<Figure wardrobe={{ hat: 'gardener' }} />);
    fireEvent.error(originals(view.container)[0]);
    expect(flashes(view.container)).toHaveLength(0);
    expect(originals(view.container).every(image => !image.classList.contains('panda-wardrobe-equip-pending'))).toBe(true);
    expect(frames.size).toBe(0);
    expect(mediaListeners.size).toBe(0);
  });

  it.each([false, true])('언마운트는 예약 RAF와 재생 타이머를 모두 정리한다: 재생 %s', revealing => {
    const view = setup(null);
    view.rerender(<Figure wardrobe={{ neck: 'gardener' }} />);
    loadAll(view.container);
    if (revealing) nextFrame();
    view.unmount();
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(mediaListeners.size).toBe(0);
    advance(1000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
