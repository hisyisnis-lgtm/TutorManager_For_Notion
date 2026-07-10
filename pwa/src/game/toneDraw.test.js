import { describe, it, expect } from 'vitest';
import { classifyStroke } from './toneDraw.js';

// 두 점 사이를 n등분한 획 생성(그린 순서 = 배열 순서). segs=[[x,y],...] 를 이어 붙임.
function stroke(segs, perSeg = 10) {
  const pts = [];
  for (let s = 0; s < segs.length - 1; s++) {
    const [x0, y0] = segs[s], [x1, y1] = segs[s + 1];
    const last = s === segs.length - 2;
    for (let i = 0; i <= (last ? perSeg : perSeg - 1); i++) {
      const t = i / perSeg;
      pts.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t });
    }
  }
  return pts;
}

describe('classifyStroke — 기본 4성조', () => {
  it('수평선 → 1성', () => {
    expect(classifyStroke(stroke([[20, 100], [280, 100]]))).toBe(1);
  });
  it('상승선(╱, y 감소=음높이 상승) → 2성', () => {
    expect(classifyStroke(stroke([[20, 150], [280, 50]]))).toBe(2);
  });
  it('골짜기(V, 내렸다 오름) → 3성', () => {
    expect(classifyStroke(stroke([[20, 90], [150, 150], [280, 70]]))).toBe(3);
  });
  it('하강선(╲, y 증가=음높이 하강) → 4성', () => {
    expect(classifyStroke(stroke([[20, 50], [280, 150]]))).toBe(4);
  });
});

describe('classifyStroke — 견고성', () => {
  it('약간 기운 거의 수평선은 관용적으로 1성', () => {
    expect(classifyStroke(stroke([[20, 100], [280, 82]]))).toBe(1);
  });
  it('노이즈 있는 수평선도 1성', () => {
    const p = stroke([[20, 100], [280, 100]]);
    p.forEach((pt, i) => { pt.y += (i % 2 ? 4 : -4); });
    expect(classifyStroke(p)).toBe(1);
  });
  it('가파른(거의 수직) 상승도 2성', () => {
    expect(classifyStroke(stroke([[100, 200], [110, 60]]))).toBe(2);
  });
  it('가파른 하강도 4성', () => {
    expect(classifyStroke(stroke([[100, 60], [110, 200]]))).toBe(4);
  });
  it('완만한 V도 3성(양 끝이 최저점보다 위)', () => {
    expect(classifyStroke(stroke([[30, 80], [150, 130], [270, 75]]))).toBe(3);
  });
});

describe('classifyStroke — 미판정(null)', () => {
  it('점(탭)처럼 너무 작으면 null', () => {
    expect(classifyStroke(stroke([[100, 100], [104, 102]]))).toBeNull();
  });
  it('점 개수 부족이면 null', () => {
    expect(classifyStroke([{ x: 10, y: 10 }, { x: 12, y: 12 }])).toBeNull();
  });
  it('배열이 아니면 null', () => {
    expect(classifyStroke(null)).toBeNull();
    expect(classifyStroke(undefined)).toBeNull();
  });
});
