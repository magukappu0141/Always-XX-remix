/**
 * Shared shape gallery API.
 *
 * Plain Node, no dependencies, no native modules. It is meant to sit beside
 * other services on a small box, so every path is bounded: request bodies are
 * capped, submissions are rate limited per client, and only metadata is held
 * in memory.
 *
 * Serve the static site with nginx and reverse-proxy /api to this process.
 *
 * Environment:
 *   PORT          listen port (default 8787)
 *   HOST          listen address (default 127.0.0.1; keep it local behind nginx)
 *   DATA_DIR      where shapes are stored (default ./data)
 *   ADMIN_TOKEN   bearer token for /api/admin/* (required for admin routes)
 *   CLIENT_SECRET salt for hashing client addresses (required in production)
 *   ALLOW_ORIGIN  CORS origin, e.g. https://example.com (default same-origin only)
 */

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import process from 'node:process';

import { openStore } from './store.js';
import { LIMITS, ValidationError, cleanText, validateSubmission } from './validate.js';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const DATA_DIR = process.env.DATA_DIR ?? new URL('./data/', import.meta.url).pathname;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN ?? '';

const CLIENT_SECRET = process.env.CLIENT_SECRET ?? randomBytes(16).toString('hex');
if (!process.env.CLIENT_SECRET) {
  console.warn('CLIENT_SECRET is unset — using a random salt; report dedupe resets on restart.');
}

const MAX_BODY_BYTES = LIMITS.svgBytes + 4 * 1024;
const PAGE_LIMIT = 48;

const BUCKETS = new Map();
const BUCKET_CAP = 2000;

function rateLimit(key, { capacity, refillPerMs }) {
  const now = Date.now();
  let bucket = BUCKETS.get(key);
  if (!bucket) {
    // Bound the map so a flood of addresses cannot grow it without limit.
    if (BUCKETS.size >= BUCKET_CAP) BUCKETS.clear();
    bucket = { tokens: capacity, at: now };
    BUCKETS.set(key, bucket);
  }
  bucket.tokens = Math.min(capacity, bucket.tokens + (now - bucket.at) * refillPerMs);
  bucket.at = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

const WRITE_LIMIT = { capacity: 5, refillPerMs: 1 / 60000 };   // ~5 burst, 1/min
const READ_LIMIT = { capacity: 120, refillPerMs: 1 / 1000 };   // ~120 burst, 1/s

function clientKey(req) {
  // Trust the proxy's first hop only; nginx is expected to set this.
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function send(res, status, body, extraHeaders = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const headers = {
    'content-type': typeof body === 'string' ? 'image/svg+xml; charset=utf-8' : 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  };
  if (ALLOW_ORIGIN) {
    headers['access-control-allow-origin'] = ALLOW_ORIGIN;
    headers.vary = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(payload);
}

function fail(res, status, code, message) {
  send(res, status, { error: code, message });
}

// Read a JSON body, refusing anything oversized.
function readJson(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_BODY_BYTES) {
      reject(new ValidationError('body_too_large', 'request body is too large'));
      return;
    }

    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ValidationError('body_too_large', 'request body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new ValidationError('body_invalid', 'request body must be JSON'));
      }
    });
    req.on('error', reject);
  });
}

const isAdmin = (req) =>
  ADMIN_TOKEN.length > 0 && req.headers.authorization === `Bearer ${ADMIN_TOKEN}`;

async function handle(req, res, store) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const key = clientKey(req);

  if (req.method === 'OPTIONS') {
    send(res, 204, '', {
      'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization',
      'access-control-max-age': '86400',
    });
    return;
  }

  // GET /api/shapes; metadata page, no artwork
  if (req.method === 'GET' && path === '/api/shapes') {
    if (!rateLimit(key, READ_LIMIT)) return fail(res, 429, 'rate_limited', 'too many requests');
    const sort = url.searchParams.get('sort') === 'popular' ? 'popular' : 'new';
    const limit = Math.min(PAGE_LIMIT, Math.max(1, Number(url.searchParams.get('limit') ?? 24) || 24));
    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0);
    return send(res, 200, store.list({ sort, limit, offset }), {
      'cache-control': 'public, max-age=30',
    });
  }

  const svgMatch = path.match(/^\/api\/shapes\/([\w-]+)\/svg$/);
  if (req.method === 'GET' && svgMatch) {
    if (!rateLimit(key, READ_LIMIT)) return fail(res, 429, 'rate_limited', 'too many requests');
    const svg = await store.readSvg(svgMatch[1]);
    if (svg === null) return fail(res, 404, 'not_found', 'shape not found');
    // Content never changes for an id, so let caches keep it.
    return send(res, 200, svg, {
      'cache-control': 'public, max-age=31536000, immutable',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
  }

  // POST /api/shapes; publish
  if (req.method === 'POST' && path === '/api/shapes') {
    if (!rateLimit(key, WRITE_LIMIT)) {
      return fail(res, 429, 'rate_limited', 'you are publishing too quickly');
    }
    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      return fail(res, 413, error.code ?? 'body_invalid', error.message);
    }
    try {
      const submission = validateSubmission(body);
      const shape = await store.add(submission, key);
      return send(res, 201, { shape });
    } catch (error) {
      if (error instanceof ValidationError) return fail(res, 400, error.code, error.message);
      if (error.code === 'gallery_full') return fail(res, 507, 'gallery_full', error.message);
      throw error;
    }
  }

  const useMatch = path.match(/^\/api\/shapes\/([\w-]+)\/use$/);
  if (req.method === 'POST' && useMatch) {
    if (!rateLimit(key, READ_LIMIT)) return fail(res, 429, 'rate_limited', 'too many requests');
    const ok = await store.recordUse(useMatch[1]);
    return ok ? send(res, 200, { ok: true }) : fail(res, 404, 'not_found', 'shape not found');
  }

  const reportMatch = path.match(/^\/api\/shapes\/([\w-]+)\/report$/);
  if (req.method === 'POST' && reportMatch) {
    if (!rateLimit(key, WRITE_LIMIT)) return fail(res, 429, 'rate_limited', 'too many reports');
    let body = {};
    try {
      body = await readJson(req);
    } catch {
      body = {};
    }
    let reason = '';
    try {
      reason = body.reason ? cleanText(body.reason, LIMITS.reportReasonChars, 'reason') : '';
    } catch {
      reason = '';
    }
    const result = await store.report(reportMatch[1], reason, key);
    return result.ok
      ? send(res, 200, { ok: true, hidden: result.hidden })
      : fail(res, 404, 'not_found', 'shape not found');
  }

  if (path.startsWith('/api/admin/')) {
    if (!isAdmin(req)) return fail(res, 401, 'unauthorized', 'admin token required');

    if (req.method === 'GET' && path === '/api/admin/reports') {
      return send(res, 200, { shapes: store.listReported() });
    }
    const adminMatch = path.match(/^\/api\/admin\/shapes\/([\w-]+)$/);
    if (adminMatch) {
      if (req.method === 'DELETE') {
        const ok = await store.remove(adminMatch[1]);
        return ok ? send(res, 200, { ok: true }) : fail(res, 404, 'not_found', 'shape not found');
      }
      if (req.method === 'POST') {
        const body = await readJson(req).catch(() => ({}));
        const ok = await store.setHidden(adminMatch[1], Boolean(body.hidden));
        return ok ? send(res, 200, { ok: true }) : fail(res, 404, 'not_found', 'shape not found');
      }
    }
  }

  if (req.method === 'GET' && path === '/api/health') {
    const used = process.memoryUsage();
    return send(res, 200, {
      ok: true,
      shapes: store.shapes.length,
      rssMb: Math.round(used.rss / 1048576),
    });
  }

  return fail(res, 404, 'not_found', 'unknown endpoint');
}

const store = await openStore(DATA_DIR, CLIENT_SECRET);

const server = createServer((req, res) => {
  handle(req, res, store).catch((error) => {
    console.error('request failed:', error);
    if (!res.headersSent) fail(res, 500, 'server_error', 'something went wrong');
  });
});

// Keep sockets from piling up if a client stalls.
server.headersTimeout = 10000;
server.requestTimeout = 20000;
server.keepAliveTimeout = 5000;
server.maxConnections = 200;

server.listen(PORT, HOST, () => {
  console.log(`shape gallery api on http://${HOST}:${PORT} (${store.shapes.length} shapes)`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
