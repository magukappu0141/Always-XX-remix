// Fit cubic Beziers through traced points (Schneider's algorithm).
// Polylines from the tracer follow every pixel step; curves ride through them
// instead, so a traced stroke reads as a drawn line rather than a staircase.

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (v, s) => ({ x: v.x * s, y: v.y * s });
const dot = (a, b) => a.x * b.x + a.y * b.y;

function normalize(v) {
  const len = Math.hypot(v.x, v.y);
  return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

function bezierAt(curve, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * curve[0].x + b * curve[1].x + c * curve[2].x + d * curve[3].x,
    y: a * curve[0].y + b * curve[1].y + c * curve[2].y + d * curve[3].y,
  };
}

// Position along the curve, plus its first and second derivatives, for the
// Newton-Raphson step below.
function bezierDerivatives(curve, t) {
  const d1 = [0, 1, 2].map((i) => mul(sub(curve[i + 1], curve[i]), 3));
  const d2 = [0, 1].map((i) => mul(sub(d1[i + 1], d1[i]), 2));
  const u = 1 - t;
  return {
    point: bezierAt(curve, t),
    first: add(add(mul(d1[0], u * u), mul(d1[1], 2 * u * t)), mul(d1[2], t * t)),
    second: add(mul(d2[0], u), mul(d2[1], t)),
  };
}

// Rough parameter values from cumulative distance along the polyline.
function chordLengthParameterize(points) {
  const u = [0];
  for (let i = 1; i < points.length; i++) {
    u.push(u[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const total = u[u.length - 1];
  if (total === 0) return points.map((_, i) => i / (points.length - 1 || 1));
  return u.map((v) => v / total);
}

// Least-squares fit of one cubic with fixed endpoints and tangent directions.
function generateBezier(points, params, leftTangent, rightTangent) {
  const first = points[0];
  const last = points[points.length - 1];
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;

  for (let i = 0; i < points.length; i++) {
    const t = params[i];
    const u = 1 - t;
    const b0 = u * u * u;
    const b1 = 3 * u * u * t;
    const b2 = 3 * u * t * t;
    const b3 = t * t * t;
    const a0 = mul(leftTangent, b1);
    const a1 = mul(rightTangent, b2);

    c00 += dot(a0, a0);
    c01 += dot(a0, a1);
    c11 += dot(a1, a1);

    const tmp = sub(points[i], add(mul(first, b0 + b1), mul(last, b2 + b3)));
    x0 += dot(a0, tmp);
    x1 += dot(a1, tmp);
  }

  const det = c00 * c11 - c01 * c01;
  let alphaL = det === 0 ? 0 : (x0 * c11 - x1 * c01) / det;
  let alphaR = det === 0 ? 0 : (c00 * x1 - c01 * x0) / det;

  // A degenerate solve means the handles want to be absurd; fall back to the
  // classic heuristic of a third of the chord length. The upper clamp matters
  // just as much: an unbounded handle sends the curve far outside the points.
  const segLength = Math.hypot(last.x - first.x, last.y - first.y);
  if (alphaL < 1e-6 || alphaR < 1e-6) {
    alphaL = segLength / 3;
    alphaR = segLength / 3;
  }
  const maxAlpha = segLength * 0.55;
  alphaL = Math.min(alphaL, maxAlpha);
  alphaR = Math.min(alphaR, maxAlpha);

  return [first, add(first, mul(leftTangent, alphaL)), add(last, mul(rightTangent, alphaR)), last];
}

// Largest squared distance from the points to the curve, and where it happens.
function computeMaxError(points, curve, params) {
  let maxDist = 0;
  let index = Math.floor(points.length / 2);
  for (let i = 0; i < points.length; i++) {
    const d = sub(bezierAt(curve, params[i]), points[i]);
    const dist = d.x * d.x + d.y * d.y;
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }
  return { maxDist, index };
}

// Pull each parameter towards the closest point on the curve.
function reparameterize(points, params, curve) {
  return params.map((t, i) => {
    const { point, first, second } = bezierDerivatives(curve, t);
    const diff = sub(point, points[i]);
    const numerator = dot(diff, first);
    const denominator = dot(first, first) + dot(diff, second);
    return denominator === 0 ? t : t - numerator / denominator;
  });
}

function fitCubic(points, leftTangent, rightTangent, error, out) {
  // Two points have nothing to fit; use the chord-length heuristic directly.
  if (points.length === 2) {
    const dist = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) / 3;
    out.push([
      points[0],
      add(points[0], mul(leftTangent, dist)),
      add(points[1], mul(rightTangent, dist)),
      points[1],
    ]);
    return;
  }

  let params = chordLengthParameterize(points);
  let curve = generateBezier(points, params, leftTangent, rightTangent);
  let { maxDist, index } = computeMaxError(points, curve, params);

  if (maxDist < error * error) {
    out.push(curve);
    return;
  }

  // Close enough to refine rather than split.
  if (maxDist < error * error * 4) {
    for (let i = 0; i < 12; i++) {
      params = reparameterize(points, params, curve);
      curve = generateBezier(points, params, leftTangent, rightTangent);
      ({ maxDist, index } = computeMaxError(points, curve, params));
      if (maxDist < error * error) {
        out.push(curve);
        return;
      }
    }
  }

  // Still off: split at the worst point and fit each half.
  const centreTangent = normalize(sub(points[index - 1], points[index + 1]));
  fitCubic(points.slice(0, index + 1), leftTangent, centreTangent, error, out);
  fitCubic(points.slice(index), mul(centreTangent, -1), rightTangent, error, out);
}

// Perpendicular distance from `p` to the segment `a`-`b`.
function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function dropCollinear(points, tolerance) {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    if (distanceToSegment(points[i], out[out.length - 1], points[i + 1]) > tolerance) {
      out.push(points[i]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

// Indices where the path turns sharply. Fitting straight through a corner
// rounds it off and makes the curve bulge past the original points, so each
// corner becomes a segment boundary instead.
function findCorners(points, maxAngle) {
  const corners = [];
  for (let i = 1; i < points.length - 1; i++) {
    const before = normalize(sub(points[i], points[i - 1]));
    const after = normalize(sub(points[i + 1], points[i]));
    const cos = Math.max(-1, Math.min(1, dot(before, after)));
    if (Math.acos(cos) > maxAngle) corners.push(i);
  }
  return corners;
}

/**
 * Fit a polyline with cubic Beziers. Returns an array of [p0, c1, c2, p3].
 * `cornerAngle` (radians) is how sharp a turn must be to be kept as a corner.
 */
export function fitCurves(points, error = 2, cornerAngle = Math.PI / 3) {
  let pts = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) pts.push(p);
  }
  if (pts.length < 2) return [];

  // On a closed path the start point falls wherever the skeleton walk began,
  // often mid-edge or part-way round a corner. Rotate so the seam sits on the
  // sharpest vertex, otherwise that corner gets fitted as a smooth curve and
  // bulges outward.
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (pts.length > 3 && Math.hypot(last.x - first.x, last.y - first.y) < 1e-6) {
    const ring = pts.slice(0, -1);
    let sharpest = 0;
    let sharpestAngle = -1;
    for (let i = 0; i < ring.length; i++) {
      const prev = ring[(i - 1 + ring.length) % ring.length];
      const next = ring[(i + 1) % ring.length];
      const before = normalize(sub(ring[i], prev));
      const after = normalize(sub(next, ring[i]));
      const angle = Math.acos(Math.max(-1, Math.min(1, dot(before, after))));
      if (angle > sharpestAngle) {
        sharpestAngle = angle;
        sharpest = i;
      }
    }
    if (sharpestAngle > cornerAngle) {
      pts = [...ring.slice(sharpest), ...ring.slice(0, sharpest), ring[sharpest]];
    }
  }

  // Drop vertices that sit on the line between their neighbours. The skeleton
  // walk leaves one of these at the seam of a closed path, and the stub of a
  // segment it creates throws the tangent solve off badly.
  pts = dropCollinear(pts, error);

  const out = [];
  const breaks = [0, ...findCorners(pts, cornerAngle), pts.length - 1];
  for (let i = 1; i < breaks.length; i++) {
    const segment = pts.slice(breaks[i - 1], breaks[i] + 1);
    if (segment.length < 2) continue;
    fitCubic(
      segment,
      normalize(sub(segment[1], segment[0])),
      normalize(sub(segment.at(-2), segment.at(-1))),
      error,
      out,
    );
  }
  return out;
}

// Serialise fitted curves as SVG path data.
export function curvesToPathData(curves, precision = 2) {
  if (curves.length === 0) return '';
  const n = (v) => Number(v.toFixed(precision));
  let d = `M${n(curves[0][0].x)} ${n(curves[0][0].y)}`;
  for (const [, c1, c2, end] of curves) {
    d += ` C${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(end.x)} ${n(end.y)}`;
  }
  return d;
}
