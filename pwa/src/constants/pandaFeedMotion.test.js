import { describe, expect, it } from 'vitest';
import { createPandaFeedFlight } from './pandaFeedMotion.js';

const scene = { from: { x: 110, y: 720 }, to: { x: 195, y: 300 }, viewportWidth: 390 };
describe('먹이 비행', () => {
  it('랜덤 경로가 달라도 동일한 입 위치에 도착한다', () => {
    const left = createPandaFeedFlight(scene, () => .1);
    const right = createPandaFeedFlight(scene, () => .9);
    expect(left[15].x).not.toBeCloseTo(right[15].x);
    for (const path of [left, right]) {
      expect(path[0]).toMatchObject({ x: 0, y: 0, opacity: 1 });
      expect(path.at(-1)).toMatchObject({ x: 85, y: -420, opacity: 0 });
    }
  });
  it('양쪽 버튼과 좁은 화면에서도 입까지 화면 안으로 이동한다', () => {
    for (const viewportWidth of [320, 390]) {
      for (const x of [68, viewportWidth - 68]) {
        for (const randomness of [0, .25, .5, .75, .999]) {
          const path = createPandaFeedFlight({ ...scene, viewportWidth,
            from: { x, y: 720 }, to: { x: viewportWidth / 2, y: 300 } }, () => randomness);
          for (const frame of path) {
            expect(x + frame.x).toBeGreaterThanOrEqual(24);
            expect(x + frame.x).toBeLessThanOrEqual(viewportWidth - 24);
          }
        }
      }
    }
  });
  it('시간의 후반부에 더 빠르게 입으로 다가가며 위치가 역행하지 않는다', () => {
    const path = createPandaFeedFlight(scene, () => .5);
    const travel = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
    expect(travel(path[20], path[25])).toBeGreaterThan(travel(path[0], path[5]) * 2);
    for (let i = 1; i < path.length; i += 1) expect(path[i].y).toBeLessThan(path[i - 1].y);
  });
});
