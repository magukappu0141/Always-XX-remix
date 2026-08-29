// Submitted SVG is never stored as sent. We parse it with the same parser the
// client draws with and re-emit from the geometry, so only path data survives.

import { extractPathData, samplePathData } from '../src/svgpath.js';
import { getBounds } from '../src/morph.js';

/**
 * Deliberately tight. This runs alongside a Minecraft server, so the point is
 * to keep memory and CPU small and predictable rather than to be generous.
 */
export const LIMITS = {
  svgBytes: 64 * 1024,
  nameChars: 40,
  authorChars: 40,
  minPaths: 1,
  maxPaths: 300,
  maxPoints: 20000,
  reportReasonChars: 200,
};

const COLOR_RE = /^#[0-9a-f]{6}$/i;
// Control characters and bidi overrides, which can disguise a display name.
const UNSAFE_TEXT_RE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;

export class ValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function cleanText(value, maxChars, field) {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field}_invalid`, `${field} must be a string`);
  }
  const cleaned = value.replace(UNSAFE_TEXT_RE, '').trim();
  if (cleaned.length === 0) {
    throw new ValidationError(`${field}_empty`, `${field} must not be empty`);
  }
  if (cleaned.length > maxChars) {
    throw new ValidationError(`${field}_too_long`, `${field} must be at most ${maxChars} characters`);
  }
  return cleaned;
}

export function cleanColor(value) {
  if (typeof value !== 'string' || !COLOR_RE.test(value.trim())) {
    throw new ValidationError('color_invalid', 'themeColor must be #rrggbb');
  }
  return value.trim().toLowerCase();
}

/**
 * Parse submitted SVG and rebuild it from the geometry alone.
 * Returns `{ svg, pathCount, pointCount }`.
 */
export function sanitizeSvg(source) {
  if (typeof source !== 'string') {
    throw new ValidationError('svg_invalid', 'svg must be a string');
  }
  if (Buffer.byteLength(source, 'utf8') > LIMITS.svgBytes) {
    throw new ValidationError('svg_too_large', `svg must be at most ${LIMITS.svgBytes} bytes`);
  }

  const data = extractPathData(source);
  if (data.length === 0) {
    throw new ValidationError('svg_no_paths', 'svg must contain <path d="..."> elements');
  }

  let polylines;
  try {
    polylines = data.flatMap((d) => samplePathData(d));
  } catch {
    throw new ValidationError('svg_unparsable', 'svg path data could not be parsed');
  }

  polylines = polylines.filter((line) => line.length >= 2);
  if (polylines.length < LIMITS.minPaths) {
    throw new ValidationError('svg_no_paths', 'svg produced no drawable paths');
  }
  if (polylines.length > LIMITS.maxPaths) {
    throw new ValidationError('svg_too_complex', `svg must have at most ${LIMITS.maxPaths} paths`);
  }

  const pointCount = polylines.reduce((total, line) => total + line.length, 0);
  if (pointCount > LIMITS.maxPoints) {
    throw new ValidationError('svg_too_complex', `svg must have at most ${LIMITS.maxPoints} points`);
  }

  const bounds = getBounds(polylines.flat());
  const body = polylines
    .map((line) => {
      const d = line
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
        .join(' ');
      return `  <path d="${d}"/>`;
    })
    .join('\n');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.minX.toFixed(2)} ${bounds.minY.toFixed(2)} ${bounds.width.toFixed(2)} ${bounds.height.toFixed(2)}" fill="none" stroke="#000000" stroke-width="${(Math.max(bounds.width, bounds.height) / 160).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">
${body}
</svg>`;

  return { svg, pathCount: polylines.length, pointCount };
}

// Validate a publish request body. Throws ValidationError on bad input.
export function validateSubmission(body) {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('body_invalid', 'request body must be an object');
  }
  const name = cleanText(body.name, LIMITS.nameChars, 'name');
  const author = cleanText(body.author ?? 'anonymous', LIMITS.authorChars, 'author');
  const themeColor = cleanColor(body.themeColor ?? '#64b5f6');
  const { svg, pathCount, pointCount } = sanitizeSvg(body.svg);
  return { name, author, themeColor, svg, pathCount, pointCount };
}
