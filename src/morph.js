// Geometry for fitting a hand-drawn stroke onto a target shape.

const EPSILON = 1e-9;
const SMOOTH_MAX_PASSES = 10;

export const DEFAULT_SAMPLE_COUNT = 256;
export const DEFAULT_DURATION_MS = 1000;

export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Drop consecutive duplicate points.
export function dedupe(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out;
}

export function getBounds(points) {
  if (points.length === 0) throw new Error('getBounds: points must not be empty');
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  // A perfectly straight stroke has zero extent on one axis; keep it non-zero
  // so normalising never divides by zero.
  return { minX, minY, width: maxX - minX || 1, height: maxY - minY || 1 };
}

/**
 * Widen a box so it is not degenerately thin.
 *
 * `minAspect` is the smallest ratio allowed between the short and long side.
 * It is scaled by the shape's own aspect so that a tall shape is allowed to
 * stay tall; without this a horizontal stroke would blow up into a square.
 */
export function expandBox(box, minAspect, shapeAspect) {
  if (minAspect <= 0) return box;
  const { minX, minY, width, height } = box;
  let w = width;
  let h = height;
  const limit = shapeAspect && shapeAspect > 0
    ? minAspect * Math.min(shapeAspect, 1 / shapeAspect)
    : minAspect;

  if (height / width < limit) h = width * limit;
  else if (width / height < limit) w = height * limit;

  if (w === width && h === height) return box;

  const cx = minX + width / 2;
  const cy = minY + height / 2;
  return { minX: cx - w / 2, minY: cy - h / 2, width: w, height: h };
}

// Scale a box vertically about its own centre, so the shape grows or shrinks
// in height without drifting away from where the stroke was drawn.
export function scaleBoxHeight(box, factor) {
  if (!(factor > 0) || factor === 1) return box;
  const height = box.height * factor;
  const cy = box.minY + box.height / 2;
  return { ...box, minY: cy - height / 2, height };
}

// Map points into 0..1 relative to `box`.
export function normalize(points, box) {
  const b = box ?? getBounds(points);
  return points.map((p) => ({ x: (p.x - b.minX) / b.width, y: (p.y - b.minY) / b.height }));
}

// Map 0..1 points back into `box`.
export function denormalize(points, box) {
  return points.map((p) => ({ x: box.minX + p.x * box.width, y: box.minY + p.y * box.height }));
}

export function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

// Cumulative arc length at each point.
function cumulativeLengths(points) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    lengths.push(lengths[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return lengths;
}

// Resample a polyline to exactly `n` points, evenly spaced by arc length.
export function resampleTo(points, n) {
  if (points.length === 0) throw new Error('resampleTo: points must not be empty');
  if (n < 1) throw new Error('resampleTo: n must be >= 1');

  const pts = dedupe(points);
  if (pts.length === 1 || n === 1) {
    const p = pts[0];
    return Array.from({ length: n }, () => ({ x: p.x, y: p.y }));
  }

  const lengths = cumulativeLengths(pts);
  const total = lengths[lengths.length - 1];
  if (total === 0) {
    const p = pts[0];
    return Array.from({ length: n }, () => ({ x: p.x, y: p.y }));
  }

  const out = [];
  for (let i = 0; i < n; i++) {
    const target = (i / (n - 1)) * total;
    let seg = 0;
    while (seg < pts.length - 2 && lengths[seg + 1] < target) seg++;
    const span = lengths[seg + 1] - lengths[seg];
    const t = span === 0 ? 0 : (target - lengths[seg]) / span;
    const a = pts[seg];
    const b = pts[seg + 1];
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/**
 * Cut a stroke into `k` consecutive pieces of equal arc length.
 * One piece feeds each path of the target shape.
 */
export function splitStroke(points, k) {
  if (k < 1) throw new Error('splitStroke: k must be >= 1');
  const pts = dedupe(points);
  if (k === 1 || pts.length <= 1) {
    return Array.from({ length: k }, () => pts.map((p) => ({ x: p.x, y: p.y })));
  }

  const lengths = cumulativeLengths(pts);
  const total = lengths[lengths.length - 1];
  if (total === 0) {
    return Array.from({ length: k }, () => pts.map((p) => ({ x: p.x, y: p.y })));
  }

  const at = (dist) => {
    if (dist <= 0) return { x: pts[0].x, y: pts[0].y };
    if (dist >= total) {
      const last = pts[pts.length - 1];
      return { x: last.x, y: last.y };
    }
    let seg = 0;
    while (seg < pts.length - 2 && lengths[seg + 1] < dist) seg++;
    const span = lengths[seg + 1] - lengths[seg];
    const t = span === 0 ? 0 : (dist - lengths[seg]) / span;
    const a = pts[seg];
    const b = pts[seg + 1];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };

  const out = [];
  for (let i = 0; i < k; i++) {
    const from = (total * i) / k;
    const to = (total * (i + 1)) / k;
    const piece = [at(from)];
    // Keep the original vertices that fall inside this slice.
    for (let j = 1; j < pts.length - 1; j++) {
      if (lengths[j] > from && lengths[j] < to) piece.push({ x: pts[j].x, y: pts[j].y });
    }
    piece.push(at(to));
    out.push(piece);
  }
  return out;
}

function centroid(points) {
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

/**
 * Pair each stroke piece with the target path nearest to it, instead of
 * matching them by index (piece 0 -> path 0, piece 1 -> path 1, ...).
 *
 * splitStroke cuts a stroke into equal-length pieces in drawing order, which
 * has no reason to line up with how the target shape's paths happen to be
 * ordered in its source SVG. Index-matching them anyway can send a piece
 * clear across the shape to reach "its" path, which reads as the line
 * tearing apart mid-morph rather than flowing into place. Nearest-centroid
 * matching keeps each piece's motion short, so eyes-shaped ink drawn near
 * the eyes tends to land on the eyes even without deliberate aim.
 *
 * `pieces` and `paths` must be the same length, and in the same coordinate
 * space (both normalised or both denormalised — centroid distance is all
 * that's compared). Returns an array where `assignment[i]` is the path index
 * piece `i` should target.
 */
export function matchPiecesToPaths(pieces, paths) {
  const n = pieces.length;
  const pieceCentroids = pieces.map(centroid);
  const pathCentroids = paths.map(centroid);

  const assignment = new Array(n).fill(-1);
  const usedPieces = new Set();
  const usedPaths = new Set();

  // Greedily take the closest remaining pair, n times. O(n^3), but n is a
  // shape's path count — always small — so this is effectively instant.
  for (let step = 0; step < n; step++) {
    let bestDist = Infinity;
    let bestI = -1;
    let bestJ = -1;
    for (let i = 0; i < n; i++) {
      if (usedPieces.has(i)) continue;
      for (let j = 0; j < n; j++) {
        if (usedPaths.has(j)) continue;
        const dx = pieceCentroids[i].x - pathCentroids[j].x;
        const dy = pieceCentroids[i].y - pathCentroids[j].y;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          bestI = i;
          bestJ = j;
        }
      }
    }
    assignment[bestI] = bestJ;
    usedPieces.add(bestI);
    usedPaths.add(bestJ);
  }
  return assignment;
}

// Laplacian smoothing; `strength` 0..1 maps to 0..10 passes.
export function smooth(points, strength = 0.5) {
  if (points.length <= 2) return points.slice();
  const passes = Math.round(Math.max(0, Math.min(1, strength)) * SMOOTH_MAX_PASSES);
  if (passes === 0) return points.slice();

  const n = points.length;
  let src = points.slice();
  let dst = new Array(n);
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < n; i++) {
      const p = src[i];
      if (i === 0 || i === n - 1) {
        dst[i] = { x: p.x, y: p.y };
      } else {
        const a = src[i - 1];
        const b = src[i + 1];
        dst[i] = { x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 };
      }
    }
    const tmp = src;
    src = dst;
    dst = tmp;
  }
  return src;
}

/**
 * Precompute the endpoints of one morph: both sides resampled to the same
 * point count so a frame is a straight lerp between matching indices.
 */
export function buildMorph({
  sourcePoints,
  targetPoints,
  durationMs = DEFAULT_DURATION_MS,
  sampleCount = DEFAULT_SAMPLE_COUNT,
  easing = easeInOutCubic,
}) {
  if (sourcePoints.length === 0) throw new Error('buildMorph: sourcePoints must not be empty');
  if (targetPoints.length === 0) throw new Error('buildMorph: targetPoints must not be empty');
  return {
    src: resampleTo(dedupe(sourcePoints), sampleCount),
    tgt: resampleTo(dedupe(targetPoints), sampleCount),
    durationMs,
    easing,
  };
}

// Interpolate a morph at progress `t` (0..1), writing into `out` to avoid garbage.
export function morphAt(morph, t, out = []) {
  const { src, tgt } = morph;
  const n = src.length;
  if (out.length !== n) out.length = n;
  for (let i = 0; i < n; i++) {
    const a = src[i];
    const b = tgt[i];
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    if (out[i]) {
      out[i].x = x;
      out[i].y = y;
    } else {
      out[i] = { x, y };
    }
  }
  return out;
}

export { EPSILON };
