// Raster line art to SVG centrelines.
// threshold -> thin to 1px -> walk the skeleton -> simplify.

const MAX_DIMENSION = 1000;
const MIN_PATH_POINTS = 4;
const MIN_PATH_LENGTH = 10;
// Window radius for adaptive thresholding, as a fraction of the long edge.
const ADAPTIVE_RADIUS_RATIO = 0.06;

export const DEFAULT_TRACE_OPTIONS = {
  // 0..1 bias applied to the chosen threshold, or null to leave it alone.
  // Positive picks up fainter lines, negative rejects more background.
  threshold: null,
  // RDP tolerance in pixels; higher means fewer, straighter points.
  simplify: 1.4,
  // Drop skeleton branches shorter than this many pixels.
  minBranch: 8,
  // Set when the art is light strokes on a dark ground.
  invert: false,
  // Local thresholding instead of one global cutoff. Handles photos of paper
  // where one corner is shadowed and another is blown out.
  adaptive: true,
  // Remove connected blobs smaller than this many pixels before thinning,
  // so paper grain and JPEG noise never become strokes.
  despeckle: 12,
  // Close gaps up to this many pixels across, for lines broken by a light
  // pencil or by threshold noise.
  closeGaps: 1,
};

export async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Could not decode image'));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Draw the image at a bounded size and return its grayscale samples.
function toGrayscale(image) {
  const scale = Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // Flatten transparency onto white so PNG line art keeps its contrast.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

  const { data } = ctx.getImageData(0, 0, width, height);
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const alpha = data[i + 3] / 255;
    const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    // Unpainted pixels read as white rather than black.
    gray[p] = lum * alpha + (1 - alpha);
  }
  return { gray, width, height };
}

// Otsu's method: pick the threshold that best separates ink from paper.
function otsuThreshold(gray) {
  const bins = 256;
  const hist = new Int32Array(bins);
  for (let i = 0; i < gray.length; i++) {
    hist[Math.min(bins - 1, Math.max(0, Math.round(gray[i] * (bins - 1))))]++;
  }

  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < bins; i++) sum += i * hist[i];

  let sumBack = 0;
  let weightBack = 0;
  let best = 0;
  let bestVariance = -1;

  for (let i = 0; i < bins; i++) {
    weightBack += hist[i];
    if (weightBack === 0) continue;
    const weightFore = total - weightBack;
    if (weightFore === 0) break;

    sumBack += i * hist[i];
    const meanBack = sumBack / weightBack;
    const meanFore = (sum - sumBack) / weightFore;
    const variance = weightBack * weightFore * (meanBack - meanFore) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = i;
    }
  }
  return best / (bins - 1);
}

// 1 where there is ink.
function binarize(gray, width, height, threshold, invert) {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const dark = gray[i] <= threshold;
    mask[i] = (invert ? !dark : dark) ? 1 : 0;
  }
  return mask;
}

// Box blur via a summed-area table: O(pixels) regardless of window size.
function localMean(gray, width, height, radius) {
  const sums = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += gray[y * width + x];
      sums[(y + 1) * (width + 1) + (x + 1)] = sums[y * (width + 1) + (x + 1)] + rowSum;
    }
  }

  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const total =
        sums[(y1 + 1) * (width + 1) + (x1 + 1)] -
        sums[y0 * (width + 1) + (x1 + 1)] -
        sums[(y1 + 1) * (width + 1) + x0] +
        sums[y0 * (width + 1) + x0];
      out[y * width + x] = total / ((x1 - x0 + 1) * (y1 - y0 + 1));
    }
  }
  return out;
}

// Ink is whatever sits meaningfully darker than its own neighbourhood, so
// uneven lighting across a photo stops mattering. `bias` shifts how much
// darker a pixel must be; `floor` keeps flat bright areas from turning to
// noise, since with no ink nearby the local mean sits right at the paper.
function binarizeAdaptive(gray, width, height, bias, invert, globalThreshold) {
  const radius = Math.max(4, Math.round(Math.max(width, height) * ADAPTIVE_RADIUS_RATIO));
  const mean = localMean(gray, width, height, radius);
  const mask = new Uint8Array(width * height);
  const margin = 0.04 - bias;

  for (let i = 0; i < gray.length; i++) {
    const value = invert ? 1 - gray[i] : gray[i];
    const reference = invert ? 1 - mean[i] : mean[i];
    // Two votes: locally darker than surroundings, and not obviously paper.
    const local = value < reference - margin;
    const global = value <= globalThreshold;
    mask[i] = local && global ? 1 : 0;
  }
  return mask;
}

// Morphological closing: grow the ink, then shrink it back. Bridges hairline
// breaks in a pencil line without fattening the overall shape.
function closeGaps(mask, width, height, radius) {
  if (radius <= 0) return mask;
  const at = (m, x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : m[y * width + x]);

  const pass = (src, want) => {
    const dst = new Uint8Array(src.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let hit = 0;
        for (let dy = -radius; dy <= radius && !hit; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (at(src, x + dx, y + dy) === want) {
              hit = 1;
              break;
            }
          }
        }
        dst[y * width + x] = want === 1 ? hit : (hit ? 0 : 1);
      }
    }
    return dst;
  };

  return pass(pass(mask, 1), 0);
}

// Drop connected components below `minPixels`, so grain and dust never reach
// the skeletoniser. Iterative flood fill; recursion would blow the stack on
// a large blob.
function despeckle(mask, width, height, minPixels) {
  if (minPixels <= 0) return mask;
  const seen = new Uint8Array(mask.length);
  const stack = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;

    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    const blob = [];

    while (stack.length > 0) {
      const index = stack.pop();
      blob.push(index);
      const x = index % width;
      const y = (index / width) | 0;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (mask[ni] && !seen[ni]) {
          seen[ni] = 1;
          stack.push(ni);
        }
      }
    }

    if (blob.length < minPixels) {
      for (const index of blob) mask[index] = 0;
    }
  }
  return mask;
}

// Neighbours p2..p9, clockwise from north.
const NEIGHBOURS = [
  [0, -1], [1, -1], [1, 0], [1, 1],
  [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

// Reduce ink regions to a 1px-wide skeleton, in place.
function thin(mask, width, height) {
  const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : mask[y * width + x]);
  const doomed = [];

  for (;;) {
    let changed = false;

    for (let step = 0; step < 2; step++) {
      doomed.length = 0;

      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          if (mask[y * width + x] === 0) continue;

          const n = NEIGHBOURS.map(([dx, dy]) => at(x + dx, y + dy));
          const filled = n.reduce((a, b) => a + b, 0);
          if (filled < 2 || filled > 6) continue;

          // Number of 0->1 transitions walking the ring once.
          let transitions = 0;
          for (let i = 0; i < 8; i++) {
            if (n[i] === 0 && n[(i + 1) % 8] === 1) transitions++;
          }
          if (transitions !== 1) continue;

          const [p2, , p4, , p6, , p8] = n;
          if (step === 0) {
            if (p2 * p4 * p6 !== 0) continue;
            if (p4 * p6 * p8 !== 0) continue;
          } else {
            if (p2 * p4 * p8 !== 0) continue;
            if (p2 * p6 * p8 !== 0) continue;
          }
          doomed.push(y * width + x);
        }
      }

      for (const index of doomed) mask[index] = 0;
      if (doomed.length > 0) changed = true;
    }

    if (!changed) break;
  }
  return mask;
}

function neighbourIndices(mask, width, height, index) {
  const x = index % width;
  const y = (index / width) | 0;
  const out = [];
  for (const [dx, dy] of NEIGHBOURS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const ni = ny * width + nx;
    if (mask[ni]) out.push(ni);
  }
  return out;
}

// The 8-ring as a 0/1 array, clockwise from north.
function neighbourRing(mask, width, height, index) {
  const x = index % width;
  const y = (index / width) | 0;
  return NEIGHBOURS.map(([dx, dy]) => {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) return 0;
    return mask[ny * width + nx];
  });
}

/**
 * Number of separate neighbour groups around a pixel: 1 at a line end, 2 along
 * a line, 3+ at a real junction.
 *
 * Counting raw neighbours instead would misread the corner of a staircased
 * diagonal as a junction, chopping every slanted line into fragments.
 */
function crossingNumber(mask, width, height, index) {
  const ring = neighbourRing(mask, width, height, index);
  let count = 0;
  for (let i = 0; i < 8; i++) {
    if (ring[i] === 0 && ring[(i + 1) % 8] === 1) count++;
  }
  return count;
}

/**
 * Drop pixels that only pad out a staircase: those whose neighbours already
 * touch each other, so removing the pixel cannot break the line.
 */
function pruneRedundant(mask, width, height) {
  const adjacent = (a, b) => {
    const ax = a % width;
    const ay = (a / width) | 0;
    const bx = b % width;
    const by = (b / width) | 0;
    return Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1;
  };

  for (;;) {
    let removed = false;

    for (let index = 0; index < mask.length; index++) {
      if (!mask[index]) continue;
      const neighbours = neighbourIndices(mask, width, height, index);
      if (neighbours.length < 2) continue;

      // Do the neighbours form a single group among themselves?
      const seen = new Set([neighbours[0]]);
      const queue = [neighbours[0]];
      while (queue.length > 0) {
        const current = queue.pop();
        for (const other of neighbours) {
          if (seen.has(other) || !adjacent(current, other)) continue;
          seen.add(other);
          queue.push(other);
        }
      }
      if (seen.size !== neighbours.length) continue;

      mask[index] = 0;
      removed = true;
    }

    if (!removed) break;
  }
  return mask;
}

/**
 * Walk the skeleton into polylines: first every branch that starts at an
 * endpoint or junction, then whatever closed loops are left over.
 */
function traceSkeleton(mask, width, height) {
  const degree = new Uint8Array(width * height);
  const pixels = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    degree[i] = crossingNumber(mask, width, height, i);
    pixels.push(i);
  }

  const used = new Set();
  const edgeKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const paths = [];

  const walkFrom = (start) => {
    for (const first of neighbourIndices(mask, width, height, start)) {
      if (used.has(edgeKey(start, first))) continue;

      const path = [start];
      let prev = start;
      let current = first;

      for (;;) {
        used.add(edgeKey(prev, current));
        path.push(current);
        if (degree[current] !== 2) break;

        const next = neighbourIndices(mask, width, height, current)
          .find((n) => !used.has(edgeKey(current, n)));
        if (next === undefined) break;
        prev = current;
        current = next;
      }
      paths.push(path);
    }
  };

  // Endpoints and junctions first so branches come out whole.
  for (const index of pixels) {
    if (degree[index] !== 2) walkFrom(index);
  }
  // Anything still untouched belongs to a closed loop.
  for (const index of pixels) {
    if (neighbourIndices(mask, width, height, index).some((n) => !used.has(edgeKey(index, n)))) {
      walkFrom(index);
    }
  }

  return paths.map((path) =>
    path.map((index) => ({ x: index % width, y: (index / width) | 0 })),
  );
}

function perpendicularDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Ramer-Douglas-Peucker.
export function simplifyPath(points, tolerance) {
  if (points.length <= 2 || tolerance <= 0) return points.slice();

  let maxDistance = 0;
  let index = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistance(points[i], first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }

  if (maxDistance <= tolerance) return [first, last];

  const left = simplifyPath(points.slice(0, index + 1), tolerance);
  const right = simplifyPath(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/**
 * Trace a raster image into polylines plus the size they live in.
 * Returns `{ paths, width, height, threshold }`.
 */
export function traceImage(image, options = {}) {
  const opts = { ...DEFAULT_TRACE_OPTIONS, ...options };
  const { simplify, minBranch, invert, adaptive } = opts;

  const { gray, width, height } = toGrayscale(image);
  const auto = otsuThreshold(gray);
  // `threshold` is a slider position; treat it as an offset from the
  // automatic choice so the control stays useful across very different
  // images instead of meaning something new for each one.
  const bias = opts.threshold === null ? 0 : opts.threshold - auto;
  const level = Math.min(1, Math.max(0, auto + bias));

  let mask = adaptive
    ? binarizeAdaptive(gray, width, height, bias, invert, Math.min(1, level + 0.18))
    : binarize(gray, width, height, level, invert);

  mask = closeGaps(mask, width, height, opts.closeGaps);
  despeckle(mask, width, height, opts.despeckle);
  thin(mask, width, height);
  pruneRedundant(mask, width, height);

  const paths = pruneSpurs(traceSkeleton(mask, width, height), minBranch)
    .filter((line) => line.length >= MIN_PATH_POINTS && polylineLength(line) >= minBranch)
    .map((line) => simplifyPath(line, simplify))
    .filter((line) => line.length >= 2 && polylineLength(line) >= MIN_PATH_LENGTH);

  return { paths, width, height, threshold: level };
}

// Thinning leaves short whiskers where a stroke widens or two lines meet.
// Drop the ones that dead-end, keeping anything that bridges two junctions.
function pruneSpurs(paths, minBranch) {
  const endpointKey = (p) => `${Math.round(p.x)},${Math.round(p.y)}`;
  const degree = new Map();
  for (const line of paths) {
    for (const end of [line[0], line[line.length - 1]]) {
      const key = endpointKey(end);
      degree.set(key, (degree.get(key) ?? 0) + 1);
    }
  }

  return paths.filter((line) => {
    if (polylineLength(line) >= minBranch * 2) return true;
    const startFree = (degree.get(endpointKey(line[0])) ?? 0) <= 1;
    const endFree = (degree.get(endpointKey(line[line.length - 1])) ?? 0) <= 1;
    return !(startFree || endFree);
  });
}

// Serialise traced polylines as an SVG document.
export function pathsToSvg(paths, width, height) {
  const body = paths
    .map((line) => {
      const d = line
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
        .join(' ');
      return `  <path d="${d}"/>`;
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
${body}
</svg>`;
}

// Convenience: file -> SVG string.
export async function traceFileToSvg(file, options) {
  const image = await loadImage(file);
  const { paths, width, height } = traceImage(image, options);
  if (paths.length === 0) throw new Error('No strokes found in image');
  return { svg: pathsToSvg(paths, width, height), paths, width, height };
}
