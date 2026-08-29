// SVG path data to polylines. Curves get flattened into line segments.

const CUBIC_STEPS = 8;
const QUAD_STEPS = 6;
const ARC_STEPS = 24;

const EPSILON = 1e-9;

function tokenize(d) {
  const tokens = [];
  const re = /([A-Za-z])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let m;
  while ((m = re.exec(d)) !== null) tokens.push(m[0]);
  return tokens;
}

function cubicAt(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

function quadAt(p0, p1, p2, t) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

function angleBetween(ux, uy, vx, vy) {
  return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
}

// Flatten an elliptical arc (SVG `A` command) into `out`.
function flattenArc(from, rx, ry, rotationDeg, largeArc, sweep, to, steps, out) {
  if (Math.hypot(from.x - to.x, from.y - to.y) < EPSILON) return;

  const phi = (rotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (from.x - to.x) / 2;
  const dy2 = (from.y - to.y) / 2;
  const x1 = cosPhi * dx2 + sinPhi * dy2;
  const y1 = -sinPhi * dx2 + cosPhi * dy2;

  let a = Math.abs(rx);
  let b = Math.abs(ry);

  // Scale up the radii if they are too small to span the endpoints.
  const lambda = (x1 * x1) / (a * a) + (y1 * y1) / (b * b);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    a *= s;
    b *= s;
  }

  const num = a * a * b * b - a * a * y1 * y1 - b * b * x1 * x1;
  const den = a * a * y1 * y1 + b * b * x1 * x1;
  let coef = num < 0 || den === 0 ? 0 : Math.sqrt(num / den);
  if (largeArc === sweep) coef = -coef;

  const cx1 = (coef * a * y1) / b;
  const cy1 = (-coef * b * x1) / a;
  const cx = cosPhi * cx1 - sinPhi * cy1 + (from.x + to.x) / 2;
  const cy = sinPhi * cx1 + cosPhi * cy1 + (from.y + to.y) / 2;

  const ux = (x1 - cx1) / a;
  const uy = (y1 - cy1) / b;
  const vx = (-x1 - cx1) / a;
  const vy = (-y1 - cy1) / b;

  const theta0 = angleBetween(1, 0, ux, uy);
  let sweepAngle = angleBetween(ux, uy, vx, vy);
  if (!sweep && sweepAngle > 0) sweepAngle -= Math.PI * 2;
  if (sweep && sweepAngle < 0) sweepAngle += Math.PI * 2;

  const n = Math.max(2, Math.ceil((Math.abs(sweepAngle) / (Math.PI * 2)) * steps));
  for (let i = 1; i <= n; i++) {
    const theta = theta0 + (sweepAngle * i) / n;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    out.push({
      x: cx + a * cos * cosPhi - b * sin * sinPhi,
      y: cy + a * cos * sinPhi + b * sin * cosPhi,
    });
  }
}

/**
 * Parse a single `d` attribute into one or more polylines.
 * A subpath break (`M`) starts a new polyline.
 */
export function samplePathData(d) {
  const tokens = tokenize(d);
  if (tokens.length === 0) throw new Error('samplePathData: empty path data');

  let i = 0;
  let command = '';
  let current = { x: 0, y: 0 };
  let subpathStart = { x: 0, y: 0 };
  let lastCubicControl = null;
  let lastQuadControl = null;

  const polylines = [];
  let points = [];

  const isCommand = (t) => /^[A-Za-z]$/.test(t);

  const num = () => {
    if (i >= tokens.length) return null;
    const t = tokens[i];
    if (isCommand(t)) return null;
    i++;
    return parseFloat(t);
  };

  const point = () => {
    const x = num();
    if (x === null) return null;
    const y = num();
    if (y === null) return null;
    return { x, y };
  };

  const push = (p) => {
    const last = points[points.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < EPSILON) return;
    points.push({ x: p.x, y: p.y });
  };

  const flush = () => {
    if (points.length > 0) {
      polylines.push(points);
      points = [];
    }
  };

  while (i < tokens.length) {
    const token = tokens[i];
    if (isCommand(token)) {
      command = token;
      i++;
    } else if (command === '') {
      command = 'M';
    }

    const absolute = command === command.toUpperCase();
    const op = command.toUpperCase();
    // Relative commands are offsets from the current point.
    const abs = (p) => (absolute ? p : { x: p.x + current.x, y: p.y + current.y });

    switch (op) {
      case 'M': {
        flush();
        const first = point();
        if (!first) break;
        current = abs(first);
        subpathStart = current;
        lastCubicControl = null;
        lastQuadControl = null;
        push(current);
        // Extra coordinate pairs after an M are implicit line-tos.
        for (;;) {
          const p = point();
          if (!p) break;
          current = abs(p);
          push(current);
        }
        break;
      }

      case 'L':
        for (;;) {
          const p = point();
          if (!p) break;
          current = abs(p);
          push(current);
        }
        lastCubicControl = null;
        lastQuadControl = null;
        break;

      case 'H':
        for (;;) {
          const x = num();
          if (x === null) break;
          current = abs({ x, y: absolute ? current.y : 0 });
          push(current);
        }
        lastCubicControl = null;
        lastQuadControl = null;
        break;

      case 'V':
        for (;;) {
          const y = num();
          if (y === null) break;
          current = abs({ x: absolute ? current.x : 0, y });
          push(current);
        }
        lastCubicControl = null;
        lastQuadControl = null;
        break;

      case 'C':
        for (;;) {
          const c1 = point();
          const c2 = point();
          const end = point();
          if (!c1 || !c2 || !end) break;
          const p1 = abs(c1);
          const p2 = abs(c2);
          const p3 = abs(end);
          for (let s = 1; s <= CUBIC_STEPS; s++) {
            push(cubicAt(current, p1, p2, p3, s / CUBIC_STEPS));
          }
          lastCubicControl = p2;
          lastQuadControl = null;
          current = p3;
        }
        break;

      case 'S':
        for (;;) {
          const c2 = point();
          const end = point();
          if (!c2 || !end) break;
          // The first control point mirrors the previous curve's last one.
          const p1 = lastCubicControl
            ? { x: 2 * current.x - lastCubicControl.x, y: 2 * current.y - lastCubicControl.y }
            : { x: current.x, y: current.y };
          const p2 = abs(c2);
          const p3 = abs(end);
          for (let s = 1; s <= CUBIC_STEPS; s++) {
            push(cubicAt(current, p1, p2, p3, s / CUBIC_STEPS));
          }
          lastCubicControl = p2;
          lastQuadControl = null;
          current = p3;
        }
        break;

      case 'Q':
        for (;;) {
          const c = point();
          const end = point();
          if (!c || !end) break;
          const p1 = abs(c);
          const p2 = abs(end);
          for (let s = 1; s <= QUAD_STEPS; s++) {
            push(quadAt(current, p1, p2, s / QUAD_STEPS));
          }
          lastQuadControl = p1;
          lastCubicControl = null;
          current = p2;
        }
        break;

      case 'T':
        for (;;) {
          const end = point();
          if (!end) break;
          const p1 = lastQuadControl
            ? { x: 2 * current.x - lastQuadControl.x, y: 2 * current.y - lastQuadControl.y }
            : { x: current.x, y: current.y };
          const p2 = abs(end);
          for (let s = 1; s <= QUAD_STEPS; s++) {
            push(quadAt(current, p1, p2, s / QUAD_STEPS));
          }
          lastQuadControl = p1;
          lastCubicControl = null;
          current = p2;
        }
        break;

      case 'A':
        for (;;) {
          const rx = num();
          if (rx === null) break;
          const ry = num();
          const rotation = num();
          const largeArc = num();
          const sweep = num();
          const end = point();
          if (ry === null || rotation === null || largeArc === null || sweep === null || !end) break;
          const p = abs(end);
          flattenArc(current, rx, ry, rotation, !!largeArc, !!sweep, p, ARC_STEPS, points);
          lastCubicControl = null;
          lastQuadControl = null;
          current = p;
        }
        break;

      case 'Z':
        push(subpathStart);
        current = subpathStart;
        lastCubicControl = null;
        lastQuadControl = null;
        break;

      default:
        // Unknown command: skip its operands so parsing can continue.
        while (num() !== null);
        break;
    }
  }

  flush();
  return polylines.filter((line) => line.length >= 2);
}

// Pull every `d` attribute out of an SVG source string.
export function extractPathData(svgSource) {
  const out = [];
  const re = /<path[^>]*\sd\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(svgSource)) !== null) out.push(m[2] ?? m[3] ?? '');
  return out;
}

// Sample every `<path>` in an SVG into polylines.
export function sampleSvg(svgSource) {
  const data = extractPathData(svgSource);
  if (data.length === 0) {
    throw new Error('sampleSvg: no <path d="..."> found in SVG source');
  }
  return data.flatMap((d) => samplePathData(d));
}
