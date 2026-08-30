// Animated GIF encoder (GIF89a). No dependency pulled in for this — the
// format is old and simple enough to write directly: median-cut colour
// quantization down to one shared palette, then LZW-compress each frame
// against it.

const MAX_COLORS = 256;
const MIN_CODE_SIZE = 2; // GIF requires at least a 4-colour code space.

// --- colour quantization -------------------------------------------------

// Split a set of pixels into `count` boxes by recursively cutting the box
// with the largest colour range down its longest axis, then average each
// leaf box into one palette entry. Standard median-cut.
function medianCut(pixels, count) {
  if (pixels.length === 0) return [[255, 255, 255]];

  const boxes = [pixels];
  while (boxes.length < count) {
    let widest = -1;
    let widestRange = -1;
    let widestChannel = 0;

    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let min = 255;
        let max = 0;
        for (const p of box) {
          const v = p[c];
          if (v < min) min = v;
          if (v > max) max = v;
        }
        const range = max - min;
        if (range > widestRange) {
          widestRange = range;
          widest = i;
          widestChannel = c;
        }
      }
    });

    if (widest === -1 || widestRange === 0) break; // nothing left worth splitting

    const box = boxes[widest];
    box.sort((a, b) => a[widestChannel] - b[widestChannel]);
    const mid = box.length >> 1;
    boxes.splice(widest, 1, box.slice(0, mid), box.slice(mid));
  }

  return boxes.map((box) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const p of box) {
      r += p[0];
      g += p[1];
      b += p[2];
    }
    const n = box.length || 1;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
}

/**
 * Build one palette shared by every frame, from a sample of their pixels.
 * A shared palette (rather than one per frame) keeps flat areas like the
 * background a stable colour across the animation and keeps encoding simple.
 */
function buildPalette(frames, maxColors) {
  // Distinct colours are what the cut needs, not every pixel — for this
  // app's output (flat fills, a handful of stroke colours, antialiased
  // edges) that's a small fraction of total pixels and much faster to sort.
  const seen = new Map();
  for (const frame of frames) {
    for (let i = 0; i < frame.length; i += 4) {
      const key = (frame[i] << 16) | (frame[i + 1] << 8) | frame[i + 2];
      if (!seen.has(key)) seen.set(key, [frame[i], frame[i + 1], frame[i + 2]]);
    }
  }

  const distinct = [...seen.values()];
  if (distinct.length <= maxColors) {
    while (distinct.length < 2) distinct.push([255, 255, 255]);
    return distinct;
  }
  return medianCut(distinct, maxColors);
}

// Map a frame's RGBA pixels to palette indices, caching by exact colour
// since flat regions repeat the same value constantly.
function quantizeFrame(frame, palette) {
  const indices = new Uint8Array(frame.length / 4);
  const cache = new Map();

  for (let i = 0, p = 0; i < frame.length; i += 4, p++) {
    const key = (frame[i] << 16) | (frame[i + 1] << 8) | frame[i + 2];
    let index = cache.get(key);
    if (index === undefined) {
      index = nearestColorIndex(frame[i], frame[i + 1], frame[i + 2], palette);
      cache.set(key, index);
    }
    indices[p] = index;
  }
  return indices;
}

function nearestColorIndex(r, g, b, palette) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const [pr, pg, pb] = palette[i];
    const dr = r - pr;
    const dg = g - pg;
    const db = b - pb;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

// --- LZW (GIF variant) ----------------------------------------------------

/**
 * GIF's variable-width LZW: codes start at `minCodeSize + 1` bits, grow by
 * one bit whenever the dictionary outgrows the current width, and reset via
 * an explicit Clear code rather than ever shrinking. Output is packed into
 * GIF's little-endian bit order.
 */
function lzwEncode(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  let dict = new Map();

  const bytes = [];
  let bitBuffer = 0;
  let bitCount = 0;

  const emit = (code) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      bytes.push(bitBuffer & 0xff);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  };

  const resetDict = () => {
    dict = new Map();
    for (let i = 0; i < clearCode; i++) dict.set(String(i), i);
    codeSize = minCodeSize + 1;
    nextCode = endCode + 1;
  };

  resetDict();
  emit(clearCode);

  let current = indices.length > 0 ? String(indices[0]) : '';
  for (let i = 1; i < indices.length; i++) {
    const pixel = indices[i];
    const candidate = `${current},${pixel}`;
    if (dict.has(candidate)) {
      current = candidate;
      continue;
    }

    emit(dict.get(current));

    if (nextCode < 4096) {
      dict.set(candidate, nextCode);
      nextCode++;
      if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
    } else {
      // Dictionary is full: reset so encoding can keep going.
      emit(clearCode);
      resetDict();
    }

    current = String(pixel);
  }
  if (current !== '') emit(dict.get(current));
  emit(endCode);

  if (bitCount > 0) bytes.push(bitBuffer & 0xff);

  return bytes;
}

// Split LZW output into GIF's required ≤255-byte sub-blocks.
function toSubBlocks(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0); // block terminator
  return out;
}

// --- container -------------------------------------------------------------

function writeUint16LE(out, value) {
  out.push(value & 0xff, (value >> 8) & 0xff);
}

/**
 * Encode an animated GIF.
 *
 * `frames`: array of `{ data: Uint8ClampedArray, delayCs }` — RGBA pixels
 * (as from ImageData.data) at the given size, and this frame's hold time in
 * hundredths of a second (GIF's native delay unit).
 */
export function encodeGif({ width, height, frames, loop = 0, maxColors = MAX_COLORS }) {
  if (frames.length === 0) throw new Error('encodeGif: at least one frame is required');

  const palette = buildPalette(
    frames.map((f) => f.data),
    maxColors,
  );
  // The colour table size GIF stores is always a power of two.
  let tableSize = 2;
  while (tableSize < palette.length) tableSize *= 2;
  const codeSize = Math.max(MIN_CODE_SIZE, Math.ceil(Math.log2(tableSize)));
  const paddedTableSize = 1 << codeSize;

  const out = [];

  // Header.
  out.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61); // "GIF89a"

  // Logical Screen Descriptor.
  writeUint16LE(out, width);
  writeUint16LE(out, height);
  // Global colour table present, colour resolution, table size.
  out.push(0x80 | ((codeSize - 1) << 4) | (codeSize - 1));
  out.push(0); // background colour index
  out.push(0); // pixel aspect ratio (unused)

  // Global Colour Table, padded to a power of two with black.
  for (let i = 0; i < paddedTableSize; i++) {
    const [r, g, b] = palette[i] ?? [0, 0, 0];
    out.push(r, g, b);
  }

  // Netscape extension: loop count (0 = forever).
  out.push(0x21, 0xff, 0x0b);
  out.push(0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30); // "NETSCAPE2.0"
  out.push(0x03, 0x01);
  writeUint16LE(out, loop);
  out.push(0x00);

  for (const frame of frames) {
    const indices = quantizeFrame(frame.data, palette);

    // Graphic Control Extension: frame timing.
    out.push(0x21, 0xf9, 0x04);
    out.push(0x00); // no transparency, no disposal preference
    writeUint16LE(out, frame.delayCs);
    out.push(0x00); // transparent colour index (unused)
    out.push(0x00); // block terminator

    // Image Descriptor.
    out.push(0x2c);
    writeUint16LE(out, 0);
    writeUint16LE(out, 0);
    writeUint16LE(out, width);
    writeUint16LE(out, height);
    out.push(0x00); // no local colour table; not interlaced

    // Image Data: LZW minimum code size, then the compressed sub-blocks.
    out.push(codeSize);
    out.push(...toSubBlocks(lzwEncode(indices, codeSize)));
  }

  out.push(0x3b); // trailer

  return new Blob([new Uint8Array(out)], { type: 'image/gif' });
}
