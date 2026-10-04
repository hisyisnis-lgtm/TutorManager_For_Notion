// Preserve the authored curves. A reflected outline reverses its winding, so
// matching its original point order would squash every point onto the axis.
// Match opposite contour sides between four directional landmarks, splitting the
// original Beziers exactly rather than redrawing them as sampled polygons.
const EPSILON = 1e-9;
const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const line = (a, b) => [a, mix(a, b, 1 / 3), mix(a, b, 2 / 3), b];
const pointAt = (curve, t) => {
  const a = mix(curve[0], curve[1], t), b = mix(curve[1], curve[2], t), c = mix(curve[2], curve[3], t);
  return mix(mix(a, b, t), mix(b, c, t), t);
};
const split = (curve, t) => {
  const a = mix(curve[0], curve[1], t), b = mix(curve[1], curve[2], t), c = mix(curve[2], curve[3], t);
  const d = mix(a, b, t), e = mix(b, c, t), middle = mix(d, e, t);
  return [[curve[0], a, d, middle], [middle, e, c, curve[3]]];
};

function parseContour(d) {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi) || [];
  const curves = [];
  let index = 0, command, current = { x: 0, y: 0 }, first, control, previous;
  const number = () => {
    const value = Number(tokens[index++]);
    if (!Number.isFinite(value)) throw new Error('Invalid panda arm path');
    return value;
  };
  while (index < tokens.length) {
    if (/^[a-z]$/i.test(tokens[index])) command = tokens[index++];
    if (!command) throw new Error('Missing panda arm path command');
    const type = command.toUpperCase(), relative = command !== type;
    const point = () => ({ x: number() + (relative ? current.x : 0), y: number() + (relative ? current.y : 0) });
    if (type === 'M') {
      if (first) throw new Error('Panda arm morph needs one closed contour');
      current = point(); first = current; command = relative ? 'l' : 'L';
    } else if (type === 'C' || type === 'S') {
      const one = type === 'C' ? point() : previous === 'C' || previous === 'S'
        ? { x: 2 * current.x - control.x, y: 2 * current.y - control.y } : current;
      const two = point(), end = point();
      curves.push([current, one, two, end]); current = end; control = two;
    } else if (type === 'L' || type === 'H' || type === 'V') {
      const end = type === 'L' ? point() : type === 'H'
        ? { x: number() + (relative ? current.x : 0), y: current.y }
        : { x: current.x, y: number() + (relative ? current.y : 0) };
      curves.push(line(current, end)); current = end;
    } else if (type === 'Z') {
      if (!first || index !== tokens.length) throw new Error('Panda arm morph needs one closed contour');
      if (distance(current, first) > EPSILON) curves.push(line(current, first));
      return curves.filter(curve => curve.some(point => distance(point, curve[0]) > EPSILON));
    } else throw new Error(`Unsupported panda arm path command: ${command}`);
    previous = type;
  }
  throw new Error('Panda arm morph needs a closed contour');
}

function extrema(curves, maximum, axis = 'y') {
  let result;
  curves.forEach((curve, index) => {
    const [p, q, r, s] = curve.map(point => point[axis]);
    const a = -p + 3 * q - 3 * r + s, b = 2 * (p - 2 * q + r), c = q - p;
    const roots = [0, 1];
    if (Math.abs(a) < EPSILON) { if (Math.abs(b) > EPSILON) roots.push(-c / b); }
    else {
      const discriminant = b * b - 4 * a * c;
      if (discriminant >= 0) roots.push((-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a));
    }
    roots.filter(t => t >= 0 && t <= 1).forEach(t => {
      const point = pointAt(curve, t);
      if (!result || (maximum ? point[axis] > result.point[axis] : point[axis] < result.point[axis])) result = { index, t, point };
    });
  });
  return result;
}

function curvePart(curve, start, end) {
  const tail = start > EPSILON ? split(curve, start)[1] : curve;
  return end < 1 - EPSILON ? split(tail, (end - start) / (1 - start))[0] : tail;
}

function landmarkSides(curves) {
  const landmarks = [['top', false, 'y'], ['right', true, 'x'], ['bottom', true, 'y'], ['left', false, 'x']]
    .map(([name, maximum, axis]) => {
      const point = extrema(curves, maximum, axis);
      return { name, position: (point.index + point.t) % curves.length };
    });
  const top = landmarks[0].position;
  landmarks.forEach(mark => { mark.order = (mark.position - top + curves.length) % curves.length; });
  landmarks.sort((a, b) => a.order - b.order);
  return landmarks.map((mark, index) => {
    const next = landmarks[(index + 1) % landmarks.length];
    const start = top + mark.order, end = top + (index === landmarks.length - 1 ? curves.length : next.order);
    const side = [];
    for (let position = start; end - position > EPSILON;) {
      const segment = Math.floor(position + EPSILON), limit = Math.min(end, segment + 1);
      side.push(curvePart(curves[segment % curves.length], Math.max(0, position - segment), limit - segment));
      position = limit;
    }
    return { key: `${mark.name}:${next.name}`, curves: side };
  });
}

function arcTable(curves) {
  let length = 0;
  const segments = curves.map(curve => {
    const start = length, samples = [{ t: 0, length: 0 }];
    let previous = curve[0], local = 0;
    for (let i = 1; i <= 64; i++) {
      const t = i / 64, point = pointAt(curve, t);
      local += distance(previous, point); samples.push({ t, length: local }); previous = point;
    }
    length += local;
    return { curve, start, end: length, samples };
  });
  if (!(length > EPSILON)) throw new Error('Degenerate panda arm contour');
  return { segments, length };
}

function fragment(table, from, to) {
  const middle = (from + to) / 2 * table.length;
  const segment = table.segments.find(item => middle < item.end) || table.segments.at(-1);
  const tAt = fraction => {
    const value = Math.max(0, Math.min(segment.end - segment.start, fraction * table.length - segment.start));
    if (value >= segment.samples.at(-1).length - EPSILON) return 1;
    const upper = segment.samples.findIndex(sample => sample.length >= value);
    if (upper <= 0) return 0;
    const a = segment.samples[upper - 1], b = segment.samples[upper];
    return a.t + (b.t - a.t) * (value - a.length) / (b.length - a.length);
  };
  const start = tAt(from), end = tAt(to);
  return curvePart(segment.curve, start, end);
}

function matchSides(source, target) {
  const a = arcTable(source), b = arcTable(target);
  const knots = [...Array.from({ length: 13 }, (_, i) => i / 12),
    ...a.segments.map(segment => segment.end / a.length), ...b.segments.map(segment => segment.end / b.length)]
    .sort((one, two) => one - two).filter((value, index, values) => !index || value - values[index - 1] > EPSILON);
  return [a, b].map(table => knots.slice(1).map((end, index) => fragment(table, knots[index], end)));
}

const reflectReverse = curves => [...curves].reverse().map(curve => [...curve].reverse().map(point => ({ x: -point.x, y: point.y })));
const serialize = curves => {
  const number = value => String(Math.round(value * 10000) / 10000);
  const point = value => `${number(value.x)} ${number(value.y)}`;
  return `M${point(curves[0][0])}${curves.map(curve => `C${curve.slice(1).map(point).join(' ')}`).join('')}Z`;
};

// Import-time helper: bake a source SVG's group transforms into its cubic data.
export function transformPandaArmPath(d, matrix) {
  if (matrix.length !== 6 || matrix.some(value => !Number.isFinite(value))) throw new Error('Invalid SVG matrix');
  const [a, b, c, e, x, y] = matrix;
  return serialize(parseContour(d).map(curve => curve.map(point => ({
    x: a * point.x + c * point.y + x, y: b * point.x + e * point.y + y,
  }))));
}

/** Mirror an untextured closed outline around its authored shoulder-to-hand axis. */
export function createPandaArmMorph(d, { shoulder, normalizeAngle }) {
  if (!Number.isFinite(shoulder?.x) || !Number.isFinite(shoulder?.y) || !Number.isFinite(normalizeAngle)) {
    throw new Error('Panda arm morph needs a finite shoulder and angle');
  }
  const radians = normalizeAngle * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
  const normalize = point => {
    const x = point.x - shoulder.x, y = point.y - shoulder.y;
    return { x: cosine * x - sine * y, y: sine * x + cosine * y };
  };
  const restore = point => ({ x: cosine * point.x + sine * point.y + shoulder.x,
    y: -sine * point.x + cosine * point.y + shoulder.y });
  const curves = parseContour(d).map(curve => curve.map(normalize));
  const sides = landmarkSides(curves), targets = landmarkSides(reflectReverse(curves));
  const pairs = sides.map(side => {
    const target = targets.find(candidate => candidate.key === side.key);
    if (!target) throw new Error('Panda arm landmarks have incompatible contour order');
    return matchSides(side.curves, target.curves);
  });
  const source = pairs.flatMap(pair => pair[0]).map(curve => curve.map(restore));
  const reflected = pairs.flatMap(pair => pair[1]).map(curve => curve.map(restore));
  const from = serialize(source), target = serialize(reflected);
  return {
    from, target,
    interpolate(progress) {
      if (!Number.isFinite(progress)) throw new Error('Invalid panda arm morph progress');
      if (progress <= 0) return from;
      if (progress >= 1) return target;
      return serialize(source.map((curve, index) => curve.map((point, pointIndex) => mix(point, reflected[index][pointIndex], progress))));
    },
  };
}
