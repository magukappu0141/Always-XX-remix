// Client for the shared shape gallery.
// Listings carry metadata only; each shape's SVG is fetched separately and
// cached here, since those URLs never change.

import { API_BASE } from './config.js';
import { prepareShapeSource } from './shapes.js';

const svgCache = new Map();

export class GalleryError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { 'content-type': 'application/json' },
      ...options,
    });
  } catch {
    throw new GalleryError('offline', 'could not reach the gallery');
  }

  if (res.status === 429) throw new GalleryError('rate_limited', 'too many requests');

  let body = null;
  if (res.headers.get('content-type')?.includes('application/json')) {
    body = await res.json().catch(() => null);
  }
  if (!res.ok) {
    throw new GalleryError(body?.error ?? 'request_failed', body?.message ?? res.statusText);
  }
  return body;
}

export function listShapes({ sort = 'new', limit = 24, offset = 0 } = {}) {
  const query = new URLSearchParams({ sort, limit: String(limit), offset: String(offset) });
  return request(`/shapes?${query}`);
}

export async function fetchSvg(id) {
  if (svgCache.has(id)) return svgCache.get(id);

  const res = await fetch(`${API_BASE}/shapes/${id}/svg`);
  if (!res.ok) throw new GalleryError('not_found', 'shape not found');
  const svg = await res.text();
  svgCache.set(id, svg);
  return svg;
}

// Fetch a listing entry's artwork and turn it into a usable shape.
export async function hydrate(entry) {
  const svg = await fetchSvg(entry.id);
  return {
    id: `shared-${entry.id}`,
    remoteId: entry.id,
    name: entry.name,
    author: entry.author,
    themeColor: entry.themeColor,
    svg,
    shared: true,
    builtin: false,
    ...prepareShapeSource(svg),
  };
}

export function publishShape({ name, author, themeColor, svg }) {
  return request('/shapes', {
    method: 'POST',
    body: JSON.stringify({ name, author, themeColor, svg }),
  });
}

// Best-effort popularity counter; a failure here should never block drawing.
export function recordUse(id) {
  return request(`/shapes/${id}/use`, { method: 'POST' }).catch(() => null);
}

export function reportShape(id, reason) {
  return request(`/shapes/${id}/report`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}
