import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import PandaMascot from './PandaMascot.jsx';
import { PANDA_STAGE_LABELS } from '../../constants/pandaMascot.js';
import { PANDA_FACE_PATHS } from '../../constants/pandaFaceGeometry.js';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const names = ['01-egg', '02-hatching', '03-baby', '04-child', '05-teen', '06-adult'];
const allStages = () => render(<>{names.map((name, stage) => <PandaMascot key={name} stage={stage} />)}</>);
const part = (svg, key) => svg.querySelector('[data-part="' + key + '"]');

describe('사용자 편집 판다 6단계', () => {
  it('별도로 복원 요청한 입을 제외한 사용자 경로와 도형 변환을 보존한다', () => {
    const { container } = allStages();
    expect(screen.getAllByRole('img').map(n => n.querySelector('title').textContent)).toEqual(PANDA_STAGE_LABELS);
    const geometry = root => {
      return [...root.querySelectorAll('path,ellipse,circle,rect,polygon')].filter(n => (
        !n.closest('[data-part="mouth"], [data-group="mouth"], [data-part="mouth-chew-closed"], [data-part^="eye-squeezed-"], defs')
      )).map(n => {
      const result = {};
      for (const name of ['d','cx','cy','r','rx','ry','x','y','width','height','points','transform']) {
        if (n.hasAttribute(name)) result[name] = n.getAttribute(name);
      }
      return result;
      });
    };
    names.forEach((name, i) => {
      const raw = readFileSync(new URL('../../../../05_assets/Mascot/student-panda-user-edits/2026-09-17-growth/' + name + '.svg', import.meta.url), 'utf8');
      const source = new DOMParser().parseFromString(raw, 'image/svg+xml');
      source.querySelectorAll('[data-part="background"],[data-part="ground-shadow"],[data-part="feeding-size"],[data-part="petting-hand-position"],[data-part^="eye-smile-"]').forEach(n => n.remove());
      const actual = part(container.querySelectorAll('svg[data-stage]')[i], 'artwork');
      expect(geometry(actual), name + ' 편집 경로 보존').toEqual(geometry(source));
    });
  }, 15000);

  it('웃는 입과 혀는 수정 전 곡선을 복원하고 입 클립에도 같은 위치·크기를 적용한다', () => {
    const { container } = allStages();
    for(const svg of [...container.querySelectorAll('svg[data-stage]')].slice(2)) {
      const mouth=part(svg,'mouth-cavity').querySelector('path');
      const tongue=part(svg,'tongue').querySelector('path');
      expect(mouth.getAttribute('d')).toBe(PANDA_FACE_PATHS.mouth);
      expect(tongue.getAttribute('d')).toBe(PANDA_FACE_PATHS.tongue);
      expect(tongue.getAttribute('transform')).toBe(mouth.getAttribute('transform'));
      const ref=tongue.closest('[clip-path]').getAttribute('clip-path');
      const clip=[...svg.querySelectorAll('clipPath')].find(n=>ref==='url(#'+n.id+')');
      expect(clip.querySelector('path').getAttribute('d')).toBe(PANDA_FACE_PATHS.mouth);
      expect(clip.querySelector('path').getAttribute('transform')).toBe(mouth.getAttribute('transform'));
    }
  });

  it('알, 부화, 젖병, 블록, 책, 성체를 단계에 맞게 표시한다', () => {
    const { container } = allStages();
    const stages = [...container.querySelectorAll('svg[data-stage]')];
    expect(part(stages[0], 'closed-egg')).not.toBeNull();
    expect(part(stages[0], 'head')).toBeNull();
    expect(part(stages[1], 'pacifier')).not.toBeNull();
    expect(part(stages[1], 'hair-tuft')).toBeNull();
    expect(part(stages[2], 'bottle')).not.toBeNull();
    expect(part(stages[3], 'block')).not.toBeNull();
    expect(part(stages[4], 'book')).not.toBeNull();
    expect(part(stages[5], 'hair-tuft')).not.toBeNull();
    expect(container.querySelector('[data-part^="accessory-"]')).toBeNull();
  });

  it('알에는 입을 추가하지 않고 2~6단계의 씹는 두 프레임을 원래 머리에 고정한다', () => {
    const { container } = allStages();
    const stages = [...container.querySelectorAll('svg[data-stage]')];
    expect(stages[0].querySelector('.panda-mascot__mouth-open,.panda-mascot__mouth-closed')).toBeNull();
    for (const svg of stages.slice(1)) {
      const open = svg.querySelector('.panda-mascot__mouth-open');
      const closed = svg.querySelector('.panda-mascot__mouth-closed');
      expect(open.closest('[data-part="head"]')).toBe(part(svg, 'head'));
      expect(closed.parentElement).toBe(open.parentElement);
      expect(closed.querySelector('path').getAttribute('transform')).toBe(open.querySelector('path').getAttribute('transform'));
      expect(closed.querySelector('path').getAttribute('d')).not.toBe(open.querySelector('path').getAttribute('d'));
    }
    expect(stages[1].querySelector('.panda-mascot__pacifier').contains(part(stages[1], 'pacifier'))).toBe(true);
    expect(stages[1].querySelector('.panda-mascot__baby-mouth').contains(part(stages[1], 'mouth-chew-closed'))).toBe(true);
  });

  it('성체의 >< 반응 눈을 원래 눈 중심에 두고 쓰다듬기와 먹기에도 원본 눈·먹는 입을 유지한다', () => {
    const { container, rerender } = render(<PandaMascot stage={5} />);
    const svg = container.querySelector('svg');
    const mouthFrames = [...svg.querySelectorAll('.panda-mascot__mouth-open,.panda-mascot__mouth-closed')];
    const mouthGeometry = mouthFrames.map(frame => frame.innerHTML);
    const reactionEyes = [...svg.querySelectorAll('.panda-mascot__eyes-squeezed')];
    expect(reactionEyes).toHaveLength(2);
    for (const [side, cx, direction] of [['left', 515, 1], ['right', 735, -1]]) {
      const original = part(svg, 'eye-white-' + side);
      const ellipse = original.querySelector('ellipse');
      const squeezed = part(svg, 'eye-squeezed-' + side);
      const curve = squeezed.querySelector('path');
      expect(ellipse.getAttribute('cx')).toBe(String(cx));
      expect(ellipse.getAttribute('cy')).toBe('532');
      expect([ellipse.getAttribute('rx'), ellipse.getAttribute('ry')]).toEqual(['16', '23']);
      expect(squeezed.parentElement).toBe(original.closest('.panda-mascot__eyes-open').parentElement);
      expect(squeezed.closest('[data-part="eye-' + side + '"]')).toBe(part(svg, 'eye-' + side));
      expect(squeezed.closest('[data-part="head"]')).toBe(part(svg, 'head'));
      expect(squeezed.closest('.panda-mascot__pupil-look')).toBeNull();
      expect(curve.getAttribute('d')).toBe(`M${cx - 16 * direction} 514L${cx + 16 * direction} 532L${cx - 16 * direction} 550`);
      expect(curve.getAttribute('fill')).toBe('none');
      expect(curve.getAttribute('stroke')).toBe('#fff');
    }
    for (const motion of ['petting', 'eating', 'idle']) {
      rerender(<PandaMascot stage={5} motion={motion} />);
      expect([...svg.querySelectorAll('.panda-mascot__eyes-squeezed')]).toEqual(reactionEyes);
      expect([...svg.querySelectorAll('.panda-mascot__mouth-open,.panda-mascot__mouth-closed')]).toEqual(mouthFrames);
      expect(mouthFrames.map(frame => frame.innerHTML)).toEqual(mouthGeometry);
    }
    for (let stage = 0; stage < 5; stage++) {
      rerender(<PandaMascot stage={stage} motion="eating" />);
      expect(container.querySelector('.panda-mascot__eyes-squeezed')).toBeNull();
    }
  });

  it('먹기·쓰다듬기·반복 재생에서 기본 팔과 소품, 얼굴 DOM을 교체하지 않는다', () => {
    for (let stage=0; stage<6; stage++) {
      const { container, rerender, unmount } = render(<PandaMascot stage={stage} />);
      const svg = container.querySelector('svg');
      const artwork = part(svg, 'artwork');
      const original = [...artwork.querySelectorAll('path,ellipse,rect')];
      const appearance = artwork.innerHTML;
      for (const [actionId, motion] of ['eating', 'petting', 'eating', 'idle'].entries()) {
        rerender(<PandaMascot stage={stage} motion={motion} actionId={actionId} />);
        expect(part(svg, 'artwork')).toBe(artwork);
        expect(artwork.innerHTML).toBe(appearance);
        [...artwork.querySelectorAll('path,ellipse,rect')].forEach((n,i) => expect(n).toBe(original[i]));
        expect(svg.querySelector('[data-part="feeding-pose"],[data-part="bamboo"],[data-part^="arm-feeding-"]')).toBeNull();
      }
      unmount();
    }
  });

  it('그라데이션과 입·몸 클립은 같은 SVG 안의 고유 ID로 연결된다', () => {
    const { container } = render(<>{[0,1].map(copy => names.map((name, stage) => <PandaMascot key={copy+name} stage={stage} />))}</>);
    const allIds = [...container.querySelectorAll('[id]')].map(n => n.id);
    expect(new Set(allIds).size).toBe(allIds.length);
    for (const svg of container.querySelectorAll('svg[data-stage]')) {
      const local = new Set([...svg.querySelectorAll('[id]')].map(n => n.id));
      expect(svg.querySelector('image,foreignObject,style,script')).toBeNull();
      for (const n of svg.querySelectorAll('*')) for (const a of [...n.attributes]) {
        for (const match of a.value.matchAll(/url\(#([^)]*)\)/g)) expect(local.has(match[1])).toBe(true);
        if (a.name === 'href') { expect(a.value.startsWith('#')).toBe(true); expect(local.has(a.value.slice(1))).toBe(true); }
      }
    }
  });

  it('애니메이션을 별도 그룹에 적용해 눈·입의 원래 좌표계를 보존한다', () => {
    const { container } = allStages();
    for (const svg of [...container.querySelectorAll('svg[data-stage]')].slice(1)) {
      expect(svg.querySelector('[data-motion-part="head"]').hasAttribute('transform')).toBe(false);
      const mouth = svg.querySelector('[data-motion-part="mouth"]');
      expect(mouth.hasAttribute('transform')).toBe(false);
      expect(mouth.contains(part(svg, 'mouth') || part(svg, 'pacifier'))).toBe(true);
      for (const eye of svg.querySelectorAll('[data-motion-part="eye"]')) {
        expect(eye.querySelector('[data-part^="eye-patch-"]')).toBeNull();
        expect(eye.querySelector('[data-part^="eye-white-"]')).not.toBeNull();
        const pupil = eye.querySelector('[data-motion-part="pupil"]');
        expect(pupil).not.toBeNull();
        expect(pupil.hasAttribute('transform')).toBe(false);
        expect(pupil.querySelectorAll('ellipse')).toHaveLength(1);
        expect(pupil.querySelector('[data-part^="eye-patch-"]')).toBeNull();
      }
    }
  });

  it('먹이마다 머리·입·몸·양팔·손 소품·다리의 반응을 처음부터 함께 재생하고 그림을 보존한다', () => {
    const wardrobe = { hand: 'gardener' };
    const { container, rerender } = render(<PandaMascot stage={5} motion="eating" actionId={1} wardrobe={wardrobe} />);
    const head = container.querySelector('[data-motion-part="head"]');
    const body = container.querySelector('.panda-mascot__body-action');
    const mouthFrames = [...container.querySelectorAll('.panda-mascot__mouth-open,.panda-mascot__mouth-closed')];
    const arms = [...container.querySelectorAll('.panda-mascot__arm-idle')];
    const legs = [...container.querySelectorAll('.panda-mascot__leg-action')];
    expect(mouthFrames).toHaveLength(2);
    expect(arms).toHaveLength(3);
    expect(arms).toContain(container.querySelector('[data-motion-part="hand-prop"]'));
    expect(legs).toHaveLength(2);
    const motionParts = [head, body, ...mouthFrames, ...arms, ...legs];
    const animations = motionParts.map(() => ({ currentTime: 500 }));
    motionParts.forEach((node, i) => { node.getAnimations = vi.fn(() => [animations[i]]); });
    const geometry = body.innerHTML;

    rerender(<PandaMascot stage={5} motion="eating" actionId={2} wardrobe={wardrobe} />);
    expect(animations.map(animation => animation.currentTime)).toEqual(animations.map(() => 0));
    expect(body.innerHTML).toBe(geometry);
    expect([...container.querySelectorAll('.panda-mascot__mouth-open,.panda-mascot__mouth-closed')]).toEqual(mouthFrames);
    expect([...container.querySelectorAll('.panda-mascot__arm-idle')]).toEqual(arms);
    expect([...container.querySelectorAll('.panda-mascot__leg-action')]).toEqual(legs);

    animations.forEach(animation => { animation.currentTime = 700; });
    rerender(<PandaMascot stage={5} motion="idle" actionId={2} wardrobe={wardrobe} />);
    expect(animations.map(animation => animation.currentTime)).toEqual(animations.map(() => 700));
    rerender(<PandaMascot stage={5} motion="eating" actionId={3} wardrobe={wardrobe} />);
    expect(animations.map(animation => animation.currentTime)).toEqual(animations.map(() => 0));
    expect(container.querySelector('.panda-mascot__body-action')).toBe(body);
    expect(container.querySelector('[data-motion-part="head"]')).toBe(head);
    expect(body.innerHTML).toBe(geometry);
    for (let stage=0; stage<6; stage++) {
      rerender(<PandaMascot stage={stage} motion="petting" />);
      expect(part(container, 'petting-hand').querySelectorAll('path').length).toBe(4);
    }
  });

  it('장식용 판다는 접근성 트리에서 제외하고 잘못된 단계 입력을 처리한다', () => {
    const { container, rerender } = render(<PandaMascot stage={NaN} decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('svg').getAttribute('data-stage')).toBe('5');
    rerender(<PandaMascot stage={-5} />);
    expect(container.querySelector('svg').getAttribute('data-stage')).toBe('0');
  });
});

describe('최종 성장형 사용자 의상', () => {
  const outfit = { hat: 'gardener', costume: 'strawberry', neck: 'reader', hand: 'gardener' };
  const accessory = (root, slot) => part(root, 'accessory-' + slot);
  const precedes = (first, second) => Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

  it('성체 이전에는 저장된 의상을 무시하고 기존 성장형을 그대로 그린다', () => {
    const { container, rerender } = render(<PandaMascot stage={0} wardrobe={outfit} />);
    for (let stage = 0; stage < 5; stage++) {
      rerender(<PandaMascot stage={stage} wardrobe={outfit} />);
      expect(container.querySelector('image')).toBeNull();
    }
  });

  it('승인된 세트만 적용하며 잘못된 값은 원래 스카프를 숨기지 않는다', () => {
    const { container, rerender } = render(<PandaMascot stage={5} wardrobe={{ hat: '../../anything', costume: 'old-set', neck: {}, hand: 'toString' }} />);
    expect(container.querySelector('image')).toBeNull();
    expect(part(container, 'scarf').getAttribute('display')).toBeNull();
    rerender(<PandaMascot stage={5} wardrobe={{ hat: 'reader', hand: 'invalid' }} />);
    expect([...container.querySelectorAll('image[data-part]')].map(node => node.getAttribute('href'))).toEqual([
      '/panda/wardrobe/reader-hat-back.svg',
      '/panda/wardrobe/reader-hat-front.svg',
    ]);
    expect(part(container, 'scarf').getAttribute('display')).toBeNull();
    rerender(<PandaMascot stage={5} wardrobe={{ hand: 'gardener' }} />);
    expect(part(container, 'scarf').getAttribute('display')).toBeNull();
    for (const slot of ['neck', 'costume']) {
      rerender(<PandaMascot stage={5} wardrobe={{ [slot]: 'reader' }} />);
      expect(part(container, 'scarf').getAttribute('display')).toBe('none');
    }
  });

  it('원본 캔버스 좌표와 뒤소품·모자 앞뒤·몸통·목장식의 겹침 순서를 유지한다', () => {
    const { container } = render(<PandaMascot stage={5} wardrobe={outfit} />);
    const svg = container.querySelector('svg');
    expect(svg.querySelectorAll('image').length).toBe(8);
    for (const image of svg.querySelectorAll('image')) {
      expect(['x', 'y', 'width', 'height'].map(name => image.getAttribute(name))).toEqual(['0', '0', '1254', '1254']);
      expect(image.hasAttribute('transform')).toBe(false);
    }
    expect(precedes(accessory(svg, 'back'), part(svg, 'base'))).toBe(true);
    const order = [part(svg, 'body-size'), accessory(svg, 'hat-back'), accessory(svg, 'costume'), accessory(svg, 'neck'), part(svg, 'head'), accessory(svg, 'hat-front'), accessory(svg, 'hand')];
    order.slice(1).forEach((node, i) => expect(precedes(order[i], node)).toBe(true));
    expect(accessory(svg, 'back').getAttribute('data-wardrobe-set')).toBe('strawberry');
  });

  it('양쪽 소매는 각 팔의 동작 그룹에, 모자 앞뒤와 손 소품은 같은 축의 동작에 연결한다', () => {
    const { container, rerender } = render(<PandaMascot stage={5} wardrobe={outfit} />);
    for (const side of ['left', 'right']) {
      const arm = part(container, 'arm-' + side);
      const sleeve = accessory(container, 'sleeve-' + side);
      expect(sleeve.parentElement).toBe(arm.parentElement);
      expect(arm.parentElement.classList.contains('panda-mascot__arm-wave--' + side)).toBe(true);
      expect(arm.parentElement.parentElement.classList.contains('panda-mascot__arm-idle--' + side)).toBe(true);
      expect(sleeve.getAttribute('data-wardrobe-set')).toBe('strawberry');
      expect(precedes(arm, sleeve)).toBe(true);
    }
    expect(accessory(container, 'hat-front').parentElement).toBe(part(container, 'head').parentElement);
    expect(accessory(container, 'hat-back').parentElement.classList.contains('panda-mascot__head-action')).toBe(true);
    expect(accessory(container, 'hand').parentElement.classList.contains('panda-mascot__arm-idle--right')).toBe(true);
    const images = [...container.querySelectorAll('image')];
    rerender(<PandaMascot stage={5} wardrobe={outfit} motion="petting" actionId={1} />);
    expect([...container.querySelectorAll('image')]).toEqual(images);
    rerender(<PandaMascot stage={5} />);
    expect(container.querySelector('image')).toBeNull();
    expect(part(container, 'scarf').getAttribute('display')).toBeNull();
  });

  it('움직이는 중 모자나 손 소품을 끼우면 기존 머리·팔의 애니메이션 시각에 맞춘다', () => {
    const saved = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getAnimations');
    const sourceHead = { animationName: 'head', currentTime: 240 };
    const sourceBreath = { animationName: 'breath', currentTime: 1260, startTime: 400, playbackRate: 1.5 };
    const sourceArm = { animationName: 'arm', currentTime: 1260, startTime: 400, playbackRate: 1 };
    const rearHead = { animationName: 'head', currentTime: 0 };
    const rearBreath = { animationName: 'breath', currentTime: 0 };
    const hand = { animationName: 'arm', currentTime: 0 };
    Object.defineProperty(SVGElement.prototype, 'getAnimations', {
      configurable: true,
      value() {
        if (this.getAttribute('data-motion-part') === 'hat-back') return [rearHead];
        if (this.getAttribute('data-motion-part') === 'hand-prop') return [hand];
        if (this.getAttribute('data-motion-part') === 'head') return [sourceHead];
        if (this.classList.contains('panda-mascot__head-breath')) {
          return [this.querySelector('[data-motion-part="hat-back"]') ? rearBreath : sourceBreath];
        }
        if (this.classList.contains('panda-mascot__arm-idle--right')) return [sourceArm];
        return [];
      },
    });
    try {
      const { rerender } = render(<PandaMascot stage={5} />);
      rerender(<PandaMascot stage={5} wardrobe={outfit} />);
      expect(rearHead.currentTime).toBe(sourceHead.currentTime);
      expect(rearBreath.startTime).toBe(sourceBreath.startTime);
      expect(rearBreath.playbackRate).toBe(sourceBreath.playbackRate);
      expect(hand.startTime).toBe(sourceArm.startTime);
      expect(hand.playbackRate).toBe(sourceArm.playbackRate);
      expect(rearBreath.currentTime).toBe(0);
      expect(hand.currentTime).toBe(0);
    } finally {
      if (saved) Object.defineProperty(SVGElement.prototype, 'getAnimations', saved);
      else delete SVGElement.prototype.getAnimations;
    }
  });
});

describe('메인 장면의 간헐적인 인사', () => {
  let hidden;
  let media;
  const advance = ms => act(() => vi.advanceTimersByTime(ms));
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    const listeners = new Set();
    media = { matches: false, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn),
      change(matches) { this.matches = matches; listeners.forEach(fn => fn({ matches })); } };
    vi.stubGlobal('matchMedia', vi.fn(() => media));
  });

  it('기본 썸네일과 알은 인사하지 않고 메인 판다만 12~22초마다 1.8초 인사한다', () => {
    const view = render(<PandaMascot stage={5} />);
    const svg = () => view.container.querySelector('svg');
    advance(60000);
    expect(svg().getAttribute('data-ambient')).toBeNull();
    view.rerender(<PandaMascot stage={0} ambient />);
    advance(60000);
    expect(svg().getAttribute('data-ambient')).toBeNull();
    view.rerender(<PandaMascot stage={5} ambient />);
    advance(11999);
    expect(svg().getAttribute('data-ambient')).toBeNull();
    advance(1);
    expect(svg().getAttribute('data-ambient')).toBe('greeting');
    advance(1800);
    expect(svg().getAttribute('data-ambient')).toBeNull();
    Math.random.mockReturnValueOnce(0).mockReturnValue(.35);
    advance(12000);
    expect(svg().getAttribute('data-ambient')).toBe('greeting');
    advance(1800);
    advance(15499);
    expect(svg().getAttribute('data-ambient')).toBeNull();
    advance(1);
    expect(svg().getAttribute('data-ambient')).toBe('ears');
  });

  it('먹기·쓰다듬기·가림은 인사를 즉시 멈추고 복귀 후 간격을 새로 센다', () => {
    const view = render(<PandaMascot stage={5} ambient />);
    const svg = () => view.container.querySelector('svg');
    for (const interrupted of [{ motion: 'eating', ambient: true }, { motion: 'petting', ambient: true }, { motion: 'idle', ambient: false }]) {
      advance(12000);
      expect(svg().getAttribute('data-ambient')).toBe('greeting');
      view.rerender(<PandaMascot stage={5} {...interrupted} />);
      expect(svg().getAttribute('data-ambient')).toBeNull();
      advance(60000);
      expect(svg().getAttribute('data-ambient')).toBeNull();
      view.rerender(<PandaMascot stage={5} ambient />);
      advance(11999);
      expect(svg().getAttribute('data-ambient')).toBeNull();
      advance(1);
      expect(svg().getAttribute('data-ambient')).toBe('greeting');
      advance(1800);
    }
  });

  it.each([1, 2, 3, 4])('%i 성장 단계는 팔 인사를 렌더하지 않고 귀와 둘러보기를 유지한다', stage => {
    const view = render(<PandaMascot stage={stage} ambient />);
    const svg = () => view.container.querySelector('svg');
    advance(12000);
    expect(svg().getAttribute('data-ambient')).toBe('ears');
    expect(svg().querySelector('[data-morph-progress]')).toBeNull();
    advance(700);
    Math.random.mockReturnValue(.5);
    advance(12000);
    expect(svg().getAttribute('data-ambient')).toBe('look');
    expect(svg().querySelector('[data-morph-progress]')).toBeNull();
  });

  it('성체 인사 중 성장 단계가 바뀌면 인사 속성을 즉시 제거한다', () => {
    const view = render(<PandaMascot stage={5} ambient />);
    advance(12000);
    expect(view.container.querySelector('svg').getAttribute('data-ambient')).toBe('greeting');
    view.rerender(<PandaMascot stage={4} ambient />);
    expect(view.container.querySelector('svg').getAttribute('data-ambient')).toBeNull();
    expect(view.container.querySelector('[data-morph-progress]')).toBeNull();
  });

  it('눈동자 둘러보기는 눈빛 래퍼만 대상으로 하며 먹기·동작 줄이기에서 멈춘다', () => {
    const view = render(<PandaMascot stage={5} ambient />);
    Math.random.mockReturnValue(.9);
    advance(12000);
    const svg = view.container.querySelector('svg');
    expect(svg.getAttribute('data-ambient')).toBe('pupils');
    expect(svg.querySelectorAll('[data-motion-part="pupil"]')).toHaveLength(2);
    for (const pupil of svg.querySelectorAll('[data-motion-part="pupil"]')) {
      expect(pupil.closest('[data-motion-part="eye"]')).not.toBeNull();
      expect(pupil.querySelector('[data-part="head"],[data-part^="eye-patch-"]')).toBeNull();
    }
    const head = part(svg, 'head');
    const patches = [...svg.querySelectorAll('[data-part^="eye-patch-"]')];
    view.rerender(<PandaMascot stage={5} ambient motion="eating" />);
    expect(svg.getAttribute('data-ambient')).toBeNull();
    expect(part(svg, 'head')).toBe(head);
    expect([...svg.querySelectorAll('[data-part^="eye-patch-"]')]).toEqual(patches);
    advance(30000);
    expect(svg.getAttribute('data-ambient')).toBeNull();
    act(() => media.change(true));
    view.rerender(<PandaMascot stage={5} ambient />);
    advance(30000);
    expect(svg.getAttribute('data-ambient')).toBeNull();
  });

  it('탭을 숨기거나 동작 줄이기를 켜면 중단하고 돌아오면 새로 기다린다', () => {
    const view = render(<PandaMascot stage={5} ambient />);
    const svg = () => view.container.querySelector('svg');
    advance(12000);
    hidden = true;
    fireEvent(document, new Event('visibilitychange'));
    expect(svg().getAttribute('data-ambient')).toBeNull();
    advance(60000);
    hidden = false;
    fireEvent(document, new Event('visibilitychange'));
    advance(11999);
    expect(svg().getAttribute('data-ambient')).toBeNull();
    advance(1);
    expect(svg().getAttribute('data-ambient')).toBe('greeting');
    act(() => media.change(true));
    expect(svg().getAttribute('data-ambient')).toBeNull();
    advance(60000);
    expect(svg().getAttribute('data-ambient')).toBeNull();
    act(() => media.change(false));
    advance(12000);
    expect(svg().getAttribute('data-ambient')).toBe('greeting');
  });

  it('소품이 있는 팔은 흔들지 않고 서 있는 단계의 발만 별도 래퍼로 움직인다', () => {
    const view = render(<PandaMascot stage={2} ambient />);
    expect(view.container.querySelector('svg').getAttribute('data-wave-side')).toBe('none');
    expect(view.container.querySelector('[data-motion-part="leg"]')).toBeNull();
    view.rerender(<PandaMascot stage={3} ambient />);
    expect(view.container.querySelector('svg').getAttribute('data-wave-side')).toBe('right');
    for (const stage of [4, 5]) {
      view.rerender(<PandaMascot stage={stage} ambient wardrobe={{ hand: 'gardener' }} />);
      expect(view.container.querySelectorAll('[data-motion-part="leg"]').length).toBe(2);
      for (const side of ['left', 'right']) expect(part(view.container, 'leg-' + side).parentElement.classList.contains('panda-mascot__leg-action--' + side)).toBe(true);
    }
    expect(view.container.querySelector('svg').getAttribute('data-wave-side')).toBe('left');
    expect(part(view.container, 'accessory-hand').closest('.panda-mascot__arm-idle--right')).not.toBeNull();
  });

  it('인사 시작과 종료가 양팔·손 소품의 계속 흐르는 idle 시계를 재시작하지 않는다', () => {
    const view = render(<PandaMascot stage={5} ambient wardrobe={{ hand: 'gardener' }} />);
    const svg = view.container.querySelector('svg');
    const breath = { animationName: 'panda-mascot-breathe', startTime: 250, currentTime: 12000, playbackRate: 1 };
    const arms = [...svg.querySelectorAll('.panda-mascot__arm-idle')];
    const animations = arms.map(arm => ({ animationName: arm.classList.contains('panda-mascot__arm-idle--left') ? 'panda-mascot-idle-left' : 'panda-mascot-idle-right', startTime: 250, currentTime: 12000, playbackRate: 1 }));
    part(svg, 'head').closest('.panda-mascot__head-breath').getAnimations = () => [breath];
    arms.forEach((arm, index) => { arm.getAnimations = vi.fn(() => [animations[index]]); });
    advance(12000);
    expect(svg.getAttribute('data-ambient')).toBe('greeting');
    advance(1800);
    expect(svg.getAttribute('data-ambient')).toBeNull();
    expect(animations.map(animation => animation.startTime)).toEqual(arms.map(() => breath.startTime));
    arms.forEach(arm => expect(arm.getAnimations).not.toHaveBeenCalled());
    expect(arms.length).toBe(3);
  });

  it('팔과 소매를 한 윤곽씩 모핑하고 하강 중 원본 곡선으로 돌아온다', () => {
    const view = render(<PandaMascot stage={5} ambient wardrobe={{ costume: 'gardener' }} />);
    const svg = view.container.querySelector('svg');
    const arm = part(svg, 'arm-right').querySelector('path');
    const original = arm.getAttribute('d');
    const sleeve = part(svg, 'accessory-sleeve-right');
    const images = [...svg.querySelectorAll('image')];
    const wave = arm.closest('.panda-mascot__arm-wave');
    const animation = { animationName: 'panda-mascot-wave', currentTime: 0 };
    wave.getAnimations = () => [animation];
    advance(12000);
    expect(arm.getAttribute('d')).toBe(original);
    expect(sleeve.style.visibility).toBe('hidden');
    const overlay = wave.querySelector('.panda-mascot__sleeve-morph');
    const sleeveCurves = [...overlay.querySelectorAll('path')];
    const originalSleeve = sleeveCurves.map(path => path.getAttribute('d'));
    animation.currentTime = 216;
    advance(16);
    expect(wave.dataset.morphProgress).toBe('0.500');
    expect(arm.getAttribute('d')).not.toBe(original);
    expect(sleeveCurves.map(path => path.getAttribute('d'))).not.toEqual(originalSleeve);
    expect(part(svg, 'arm-right').querySelectorAll('path').length).toBe(1);
    expect([...svg.querySelectorAll('image')]).toEqual(images);
    expect(wave.querySelector('use')).toBeNull();
    animation.currentTime = 1566;
    advance(16);
    expect(wave.dataset.morphProgress).toBe('0.500');
    animation.currentTime = 1666;
    advance(16);
    expect(wave.dataset.morphProgress).toBe('0.000');
    expect(arm.getAttribute('d')).toBe(original);
    advance(1800);
    expect(wave.querySelector('.panda-mascot__sleeve-morph')).toBeNull();
    expect(sleeve.style.visibility).toBe('');
    expect(arm.getAttribute('d')).toBe(original);
    expect([...svg.querySelectorAll('image')]).toEqual(images);
  });

  it('실제 SVG 좌우 기준으로 팔 반대편에 몸과 고개를 기울이고 든 팔 쪽 발을 든다', () => {
    const style = document.createElement('style');
    style.textContent = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'PandaMascot.css'), 'utf8');
    document.head.append(style);
    try {
      const rules = [...style.sheet.cssRules];
      const motionRules = rules.flatMap(rule => rule.cssRules ? [...rule.cssRules] : []);
      const footRules = motionRules.filter(rule => rule.style?.getPropertyValue('animation').startsWith('panda-mascot-greeting-foot'));
      const waveRules = motionRules.filter(rule => rule.style?.getPropertyValue('animation').startsWith('panda-mascot-wave'));
      expect(footRules.length).toBe(1);
      expect(waveRules.length).toBe(1);
      const waveFrames = rules.find(rule => rule.name === 'panda-mascot-wave');
      expect(waveFrames).toBeTruthy();
      for (const frame of waveFrames.cssRules) {
        expect(frame.style.getPropertyValue('transform')).toMatch(/^rotate\(/);
        expect(frame.style.getPropertyValue('transform')).not.toContain('scale');
      }
      // The wave offset returns to identity; idle lives on an uninterrupted parent.
      expect(waveFrames.cssRules[0].style.getPropertyValue('transform')).toBe('rotate(0deg)');
      expect(waveRules[0].style.getPropertyValue('transform-origin')).toBe('var(--panda-wave-shoulder)');
      expect(waveRules[0].selectorText).not.toContain('__arm-idle');
      expect(rules.find(rule => rule.name === 'panda-mascot-wave-flip')).toBeUndefined();
      for (const [side, wardrobe, sign] of [['right', { costume: 'gardener' }, -1], ['left', { costume: 'gardener', hand: 'gardener' }, 1]]) {
        const view = render(<PandaMascot stage={5} ambient wardrobe={wardrobe} />);
        advance(12000);
        const svg = view.container.querySelector('svg');
        expect(svg.getAttribute('data-wave-side')).toBe(side);
        const armX = Number(part(svg, 'arm-' + side).querySelector('path').getAttribute('d').match(/^[Mm]\s*(-?[\d.]+)/)[1]);
        expect(armX > 625).toBe(side === 'right');
        const computed = window.getComputedStyle(svg);
        const lean = parseFloat(computed.getPropertyValue('--panda-greeting-lean'));
        const head = parseFloat(computed.getPropertyValue('--panda-greeting-head'));
        const lift = parseFloat(computed.getPropertyValue('--panda-wave-lift'));
        const tip = parseFloat(computed.getPropertyValue('--panda-wave-tip'));
        const bind = parseFloat(computed.getPropertyValue('--panda-arm-bind'));
        const normalize = parseFloat(computed.getPropertyValue('--panda-arm-normalize'));
        const shoulder = computed.getPropertyValue('--panda-wave-shoulder').trim().split(/\s+/).map(parseFloat);
        // Centers of the actual rounded palm caps, measured from the archived cubic paths.
        const palm = side === 'right' ? [828.3, 955.17981389] : [421.6, 955.11609371];
        const offset = [palm[0] - shoulder[0], palm[1] - shoulder[1]];
        const angle = normalize * Math.PI / 180;
        const verticalX = Math.cos(angle) * offset[0] - Math.sin(angle) * offset[1];
        expect(Math.abs(verticalX)).toBeLessThan(.001);
        // A stepped flip changes the silhouette without jumping the palm center.
        expect(Math.abs(-verticalX - verticalX)).toBeLessThan(.002);
        expect(bind + normalize).toBe(0);
        expect(shoulder).toEqual(side === 'right' ? [730, 760] : [520, 760]);
        expect(Math.sign(lean)).toBe(sign);
        expect(Math.sign(head)).toBe(sign);
        expect(Math.sign(lean + head)).toBe(sign);
        expect(Math.abs(lean + head)).toBeGreaterThan(7);
        expect(Math.sign(lift)).toBe(sign);
        expect(Math.sign(tip)).toBe(sign);
        expect(Math.abs(lift)).toBeGreaterThan(110);
        expect(Math.abs(tip)).toBeLessThan(145);
        expect(Math.abs(tip - lift)).toBeLessThanOrEqual(20);
        const waved = [...svg.querySelectorAll('.panda-mascot__arm-wave')].filter(node => node.matches(waveRules[0].selectorText));
        expect(waved.length).toBe(1);
        expect(window.getComputedStyle(waved[0].parentElement).transformOrigin).toBe(shoulder.map(value => value + 'px').join(' '));
        expect(waved[0].contains(part(svg, 'arm-' + side))).toBe(true);
        expect(part(svg, 'accessory-sleeve-' + side).parentElement).toBe(waved[0]);
        expect(waved[0].contains(part(svg, 'arm-' + (side === 'left' ? 'right' : 'left')))).toBe(false);
        expect(waved[0].contains(part(svg, 'head'))).toBe(false);
        if (wardrobe.hand) expect(waved[0].contains(part(svg, 'accessory-hand'))).toBe(false);
        const feet = [...svg.querySelectorAll('[data-motion-part="leg"]')].filter(node => node.matches(footRules[0].selectorText));
        expect(feet.length).toBe(1);
        expect(feet[0].contains(part(svg, 'leg-' + side))).toBe(true);
        advance(1800);
        expect(svg.getAttribute('data-ambient')).toBeNull();
        expect(waved[0].matches(waveRules[0].selectorText)).toBe(false);
        view.unmount();
      }
    } finally { style.remove(); }
  });
});
