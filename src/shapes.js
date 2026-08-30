// Shape registry. Each shape is an SVG of <path> outlines, sampled into
// points normalised to 0..1 so it can be dropped into any stroke box.
// To add one: drop the SVG in shapes/ and add an entry to BUILTIN_SHAPES.

import { sampleSvg } from './svgpath.js';
import { getBounds, normalize } from './morph.js';

const SHAPES_DIR = new URL('../shapes/', import.meta.url);

/**
 * Built-in shapes. `name` carries one label per locale.
 *
 * These are original artwork for this project. Do not add characters you do
 * not hold the rights to; see NOTICE.md.
 */
export const BUILTIN_SHAPES = [
  {
    id: 'mochi-cat',
    file: 'mochi-cat.svg',
    themeColor: '#f2825b',
    name: { ja: 'もちねこ', en: 'Mochi Cat', zh: '麻糬猫' },
  },
  {
    id: 'ghosty',
    file: 'ghosty.svg',
    themeColor: '#7c6ce0',
    name: { ja: 'おばけくん', en: 'Ghosty', zh: '小幽灵' },
  },
  {
    id: 'sprout',
    file: 'sprout.svg',
    themeColor: '#4caf7d',
    name: { ja: 'ふたば', en: 'Sprout', zh: '小芽' },
  },
  {
    id: 'star-buddy',
    file: 'star-buddy.svg',
    themeColor: '#e5a72c',
    name: { ja: 'ほしのこ', en: 'Star Buddy', zh: '小星星' },
  },
];

/**
 * Turn SVG source into the normalised form the canvas animates towards.
 * Returns `{ paths, aspectRatio }` where every point is in 0..1.
 */
// Read the drawing frame from the SVG's own viewBox, if it has a usable one.
function readViewBox(svgSource) {
  const match = svgSource.match(/viewBox\s*=\s*["']\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)/);
  if (!match) return null;
  const [minX, minY, width, height] = match.slice(1).map(Number);
  if (!(width > 0) || !(height > 0)) return null;
  return { minX, minY, width, height };
}

/**
 * Turn SVG source into the normalised form the canvas animates towards.
 * Returns `{ paths, aspectRatio }` where every point is in 0..1.
 *
 * The viewBox is the frame the artwork was drawn in, so it decides the
 * proportions. Falling back to the ink's own bounding box would reshape an
 * imported drawing to whatever its strokes happen to span; a square doodle
 * centred in a wide photo would come back square.
 */
export function prepareShapeSource(svgSource) {
  const polylines = sampleSvg(svgSource);
  const all = polylines.flat();
  if (all.length === 0) {
    throw new Error('prepareShapeSource: SVG produced no points');
  }

  const ink = getBounds(all);
  const viewBox = readViewBox(svgSource);
  // Ignore a viewBox that does not actually contain the drawing; some files
  // carry a stale or nominal one.
  const framed =
    viewBox &&
    ink.minX >= viewBox.minX - 1 &&
    ink.minY >= viewBox.minY - 1 &&
    ink.minX + ink.width <= viewBox.minX + viewBox.width + 1 &&
    ink.minY + ink.height <= viewBox.minY + viewBox.height + 1;

  const frame = framed ? viewBox : ink;
  return {
    paths: polylines.map((line) => normalize(line, frame)),
    aspectRatio: frame.width / frame.height,
  };
}

async function fetchShapeSvg(file) {
  const res = await fetch(new URL(file, SHAPES_DIR));
  if (!res.ok) throw new Error(`Failed to load shape "${file}": ${res.status}`);
  return res.text();
}

// Load and prepare every built-in shape.
export async function loadBuiltinShapes() {
  return Promise.all(
    BUILTIN_SHAPES.map(async (entry) => {
      const svg = await fetchShapeSvg(entry.file);
      return { ...entry, svg, ...prepareShapeSource(svg), builtin: true };
    }),
  );
}

const CUSTOM_KEY = 'always-xx:custom-shapes';

export function loadCustomShapes() {
  let raw;
  try {
    raw = localStorage.getItem(CUSTOM_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];

  let stored;
  try {
    stored = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(stored)) return [];

  const out = [];
  for (const entry of stored) {
    if (!entry || typeof entry.svg !== 'string') continue;
    try {
      out.push({ ...entry, ...prepareShapeSource(entry.svg), builtin: false });
    } catch {
      // Skip an entry whose SVG no longer parses rather than losing the rest.
    }
  }
  return out;
}

export function saveCustomShapes(shapes) {
  const serialisable = shapes.map(({ id, name, themeColor, svg }) => ({
    id,
    name,
    themeColor,
    svg,
  }));
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(serialisable));
    return true;
  } catch {
    return false;
  }
}

export function createCustomShape({ name, themeColor, svg }) {
  // Validate before storing so a bad import fails loudly at import time.
  const prepared = prepareShapeSource(svg);
  return {
    id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    themeColor,
    svg,
    builtin: false,
    ...prepared,
  };
}
