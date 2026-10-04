// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPandaArmMorph, transformPandaArmPath } from './pandaArmMorph.js';
import { PANDA_SLEEVE_GEOMETRY } from './pandaSleeveGeometry.js';
import { extractPandaSleeveGeometry } from '../../../02_devtools/panda-sleeve-geometry.mjs';

const IDENTITY = [1, 0, 0, 1, 0, 0];
const artwork = readFileSync(new URL('../components/ui/PandaGrowthArtwork.jsx', import.meta.url), 'utf8');
const adult = artwork.slice(artwork.indexOf('function Stage5('));
const arm = side => adult.match(new RegExp(`data-part=\\{["']arm-${side}["']\\}>\\s*<path[^>]*d=\\{["']([^"']+)`))[1];
const joints = {
  right: { shoulder: { x: 730, y: 760 }, normalizeAngle: 26.7316 },
  left: { shoulder: { x: 520, y: 760 }, normalizeAngle: -26.7625 },
};
const fixtures = [
  ...Object.keys(joints).map(side => ({ name: `adult ${side}`, d: arm(side), ...joints[side] })),
  ...Object.entries(PANDA_SLEEVE_GEOMETRY).flatMap(([set, sides]) => Object.entries(sides)
    .flatMap(([side, paths]) => paths.map(({ d }, index) => ({ name: `${set} ${side} ${index}`, d, ...joints[side] })))),
];
for (const [stage, x, y, normalizeAngle] of [[1, 715, 868, 32.1099], [3, 735, 891, 28.0255], [4, 752, 854, 26.8892]]) {
  const section = artwork.slice(artwork.indexOf(`function Stage${stage}(`), artwork.indexOf(`function Stage${stage + 1}(`));
  const d = section.match(/data-part=\{["']arm-right["']\}>\s*<path[^>]*d=\{["']([^"']+)/)[1];
  fixtures.push({ name: `stage ${stage} right`, d, shoulder: { x, y }, normalizeAngle });
}

// Sample only the helper's absolute M/C/Z output, independently of its matching.
function contour(d, samples = 16) {
  const values = d.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi).map(Number);
  const points = [{ x: values[0], y: values[1] }];
  for (let offset = 2; offset < values.length; offset += 6) {
    const p = points.at(-1), [a, b, c, e, x, y] = values.slice(offset, offset + 6);
    for (let step = 1; step <= samples; step++) {
      const t = step / samples, n = 1 - t;
      points.push({ x: n ** 3 * p.x + 3 * n * n * t * a + 3 * n * t * t * c + t ** 3 * x,
        y: n ** 3 * p.y + 3 * n * n * t * b + 3 * n * t * t * e + t ** 3 * y });
    }
  }
  points.pop();
  return points.filter((point, index) => !index || Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) > 1e-7);
}
const area = points => points.reduce((sum, p, i) => {
  const q = points[(i + 1) % points.length];
  return sum + p.x * q.y - p.y * q.x;
}, 0) / 2;
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function intersectionArea(points) {
  let largestLoop = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const c = points[j], d = points[(j + 1) % points.length];
      if (cross(a, b, c) * cross(a, b, d) < -1e-7 && cross(c, d, a) * cross(c, d, b) < -1e-7) {
        const denominator = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
        const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / denominator;
        const intersection = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
        largestLoop = Math.max(largestLoop, Math.min(Math.abs(area([intersection, ...points.slice(i + 1, j + 1)])),
          Math.abs(area([intersection, ...points.slice(j + 1), ...points.slice(0, i + 1)]))));
      }
    }
  }
  return largestLoop;
}
function outlineDistance(source, target) {
  return Math.max(...source.map(point => Math.min(...target.map((a, index) => {
    const b = target[(index + 1) % target.length], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
  }))));
}
const normalized = (points, { shoulder, normalizeAngle }) => {
  const angle = normalizeAngle * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  return points.map(point => ({ x: c * (point.x - shoulder.x) - s * (point.y - shoulder.y),
    y: s * (point.x - shoulder.x) + c * (point.y - shoulder.y) }));
};

describe('원본 팔과 소매의 축 반사 곡선 모핑', () => {
  it.each(fixtures)('$name: 중간 모양이 납작해지거나 자기 교차하지 않고 축 길이를 보존한다', fixture => {
    const morph = createPandaArmMorph(fixture.d, fixture);
    const source = contour(morph.from), initialArea = area(source);
    const sourceAxis = normalized(source, fixture), minY = Math.min(...sourceAxis.map(p => p.y)), maxY = Math.max(...sourceAxis.map(p => p.y));
    expect(Math.abs(initialArea)).toBeGreaterThan(1);
    for (const progress of [0, .125, .25, .375, .5, .625, .75, .875, 1]) {
      const points = contour(morph.interpolate(progress), 8), currentArea = area(points);
      expect(Math.sign(currentArea), `winding at ${progress}`).toBe(Math.sign(initialArea));
      expect(Math.abs(currentArea), `nonzero area at ${progress}`).toBeGreaterThan(1);
      // The authored hatching arm has a 0.1-unit closing seam. Preserve it, but
      // reject new crossing loops larger than 0.05 square SVG units (<0.001 px²).
      expect(intersectionArea(points), `crossing loop area at ${progress}`).toBeLessThanOrEqual(
        Math.max(.05, intersectionArea(source) + .01));
      const axis = normalized(points, fixture);
      expect(Math.min(...axis.map(p => p.y))).toBeCloseTo(minY, 2);
      expect(Math.max(...axis.map(p => p.y))).toBeCloseTo(maxY, 2);
    }
    expect(morph.interpolate(0)).toBe(morph.from);
    expect(morph.interpolate(1)).toBe(morph.target);
    expect(morph.interpolate(-1)).toBe(morph.from);
  });

  it.each(fixtures)('$name: 원본 곡선과 정규화 축의 정확한 반사 윤곽을 유지한다', fixture => {
    const morph = createPandaArmMorph(fixture.d, fixture);
    const original = contour(transformPandaArmPath(fixture.d, IDENTITY), 96), source = contour(morph.from, 8);
    expect(outlineDistance(original, source)).toBeLessThan(.06);
    expect(outlineDistance(source, original)).toBeLessThan(.06);
    const reflected = normalized(contour(morph.target, 8), fixture);
    const expected = normalized(original, fixture).map(({ x, y }) => ({ x: -x, y }));
    expect(outlineDistance(expected, reflected)).toBeLessThan(.06);
    expect(outlineDistance(reflected, expected)).toBeLessThan(.06);
    // Returning after a completed gesture is the same contour, not an accumulated transform.
    morph.interpolate(.5); morph.interpolate(1);
    expect(morph.interpolate(0)).toBe(morph.from);
  });

  it('어깨를 옮기면 모든 중간 곡선도 같은 양만큼 이동하고 독립적인 drift가 생기지 않는다', () => {
    const fixture = fixtures[0], dx = 31, dy = -17;
    const original = createPandaArmMorph(fixture.d, fixture);
    const translated = createPandaArmMorph(transformPandaArmPath(fixture.d, [1, 0, 0, 1, dx, dy]), {
      ...fixture, shoulder: { x: fixture.shoulder.x + dx, y: fixture.shoulder.y + dy },
    });
    for (const progress of [0, .25, .5, .75, 1]) {
      const a = contour(original.interpolate(progress), 4), b = contour(translated.interpolate(progress), 4);
      expect(b).toHaveLength(a.length);
      a.forEach((point, index) => {
        expect(b[index].x - point.x).toBeCloseTo(dx, 3);
        expect(b[index].y - point.y).toBeCloseTo(dy, 3);
      });
    }
  });

  it('소매 geometry는 승인된 SVG의 경로·색을 그대로 추출한 데이터다', () => {
    for (const [set, sides] of Object.entries(PANDA_SLEEVE_GEOMETRY)) {
      for (const [side, paths] of Object.entries(sides)) {
        const source = readFileSync(new URL(`../../public/panda/wardrobe/${set}-sleeve-${side}.svg`, import.meta.url), 'utf8');
        expect(extractPandaSleeveGeometry(source)).toEqual(paths);
      }
    }
  });

  it('import 시 소매의 중첩 group 변환을 경로에 반영하고 임의의 clip을 누락하지 않는다', () => {
    const source = '<svg><g transform="translate(10 20)"><g transform="scale(2)"><path fill="#fff" d="M0 0L10 0L10 10L0 10Z"/></g></g></svg>';
    const [part] = extractPandaSleeveGeometry(source), points = contour(part.d);
    expect(part.fill).toBe('#fff');
    expect(Math.min(...points.map(p => p.x))).toBe(10);
    expect(Math.max(...points.map(p => p.x))).toBe(30);
    expect(Math.min(...points.map(p => p.y))).toBe(20);
    expect(Math.max(...points.map(p => p.y))).toBe(40);
    expect(() => extractPandaSleeveGeometry(source.replace('fill="#fff"', 'fill="#fff" clip-path="url(#mask)"'))).toThrow(/paint or clipping/);
  });

  it('지원하지 않는 복합·열린 윤곽은 조용히 변형하지 않는다', () => {
    expect(() => createPandaArmMorph('M0 0L10 10', joints.right)).toThrow(/closed contour/);
    expect(() => createPandaArmMorph('M0 0L10 10ZM20 20L30 30Z', joints.right)).toThrow(/closed contour/);
    expect(() => createPandaArmMorph('M0 0A10 10 0 0 1 20 20Z', joints.right)).toThrow(/Unsupported/);
  });
});
