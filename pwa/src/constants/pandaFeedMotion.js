export const PANDA_FEED_FLIGHT_MS = 750;
export const PANDA_FEED_STAGGER_MS = 130;

// Flight and consumption feedback share the live mouth position, including
// the smaller growing forms and the compact layout's figure scale.
export function getPandaFeedingTarget(panda, bounds) {
  const mouth = (panda?.querySelector('[data-part="mouth"]') || panda?.querySelector('[data-part="pacifier"]'))?.getBoundingClientRect();
  return mouth?.width ? { x: mouth.left + mouth.width / 2, y: mouth.top + mouth.height / 2 }
    : { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height * .61 };
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const cubic = (a, b, c, d, t) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b
  + 3 * (1 - t) * t ** 2 * c + t ** 3 * d;

// One route per leaf. Control points stay inside the viewport, so randomness
// adds variety without sending food off screen. Time is eased before sampling
// the curve: easing each CSS segment separately would produce repeated jerks.
export function createPandaFeedFlight({ from, to, viewportWidth }, random = Math.random) {
  const side = random() < .5 ? -1 : 1;
  const reach = 45 + random() * 65;
  const inset = Math.min(24, viewportWidth / 2);
  const limitX = x => clamp(x, inset, Math.max(inset, viewportWidth - inset));
  const dy = to.y - from.y;
  const first = { x: limitX(from.x + side * reach), y: from.y + dy * .18 };
  const second = { x: limitX(to.x + side * (random() * 100 - 40)), y: from.y + dy * .68 };
  const tilt = (random() - .5) * 64;
  return Array.from({ length: 31 }, (_, index) => {
    const time = index / 30;
    const distance = .22 * time + .78 * time * time;
    return {
      offset: time,
      x: cubic(from.x, first.x, second.x, to.x, distance) - from.x,
      y: cubic(from.y, first.y, second.y, to.y, distance) - from.y,
      rotation: tilt * (1 - distance) + Math.sin(distance * Math.PI) * side * 10,
      scale: time < .82 ? 1 : 1 - (time - .82) / .18 * .6,
      opacity: time < .9 ? 1 : (1 - time) / .1,
    };
  });
}
