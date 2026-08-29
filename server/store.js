// Shape storage. Metadata sits in memory and in data/shapes.json, each SVG
// is its own file under data/svg/ read on demand, so RSS stays flat.
// Backup is cp -r data.

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Hide a shape once this many distinct people report it.
export const REPORTS_TO_HIDE = 3;

// Refuse new submissions past this, so disk use stays bounded.
export const MAX_SHAPES = 5000;

export class Store {
  constructor(dataDir, secret) {
    this.dataDir = dataDir;
    this.indexFile = join(dataDir, 'shapes.json');
    this.svgDir = join(dataDir, 'svg');
    this.secret = secret;
    this.shapes = [];
    this.writing = null;
    this.pending = false;
  }

  // Stable pseudonym for a client, so we can dedupe without keeping IPs.
  hashClient(value) {
    return createHash('sha256').update(`${this.secret}:${value}`).digest('hex').slice(0, 16);
  }

  svgPath(id) {
    return join(this.svgDir, `${id}.svg`);
  }

  async load() {
    await mkdir(this.svgDir, { recursive: true });
    try {
      const raw = await readFile(this.indexFile, 'utf8');
      const parsed = JSON.parse(raw);
      this.shapes = Array.isArray(parsed.shapes) ? parsed.shapes : [];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.shapes = [];
      await mkdir(dirname(this.indexFile), { recursive: true });
    }
    return this;
  }

  /**
   * Persist the index, coalescing bursts into one write. Writes to a temp file
   * and renames, so a crash mid-write cannot truncate the live data.
   */
  async save() {
    if (this.writing) {
      this.pending = true;
      return this.writing;
    }
    this.writing = (async () => {
      do {
        this.pending = false;
        const temp = `${this.indexFile}.${process.pid}.tmp`;
        await writeFile(temp, JSON.stringify({ shapes: this.shapes }), 'utf8');
        await rename(temp, this.indexFile);
      } while (this.pending);
      this.writing = null;
    })();
    return this.writing;
  }

  // Public metadata. Never leaks reporter hashes, and never carries the SVG.
  static publicView(shape) {
    return {
      id: shape.id,
      name: shape.name,
      author: shape.author,
      themeColor: shape.themeColor,
      pathCount: shape.pathCount,
      uses: shape.uses,
      createdAt: shape.createdAt,
    };
  }

  list({ sort = 'new', limit = 24, offset = 0 } = {}) {
    const visible = this.shapes.filter((s) => !s.hidden);
    const sorted = [...visible].sort((a, b) =>
      sort === 'popular' ? b.uses - a.uses || b.createdAt - a.createdAt : b.createdAt - a.createdAt,
    );
    const page = sorted.slice(offset, offset + limit);
    return {
      shapes: page.map(Store.publicView),
      total: visible.length,
      hasMore: offset + page.length < sorted.length,
    };
  }

  get(id) {
    return this.shapes.find((s) => s.id === id) ?? null;
  }

  // Read one shape's SVG from disk. Returns null when missing or hidden.
  async readSvg(id) {
    const shape = this.get(id);
    if (!shape || shape.hidden) return null;
    try {
      return await readFile(this.svgPath(id), 'utf8');
    } catch {
      return null;
    }
  }

  countBy(clientKey) {
    const hash = this.hashClient(clientKey);
    return this.shapes.filter((s) => s.authorHash === hash).length;
  }

  async add({ name, author, themeColor, svg, pathCount, pointCount }, clientKey) {
    if (this.shapes.length >= MAX_SHAPES) {
      const error = new Error('gallery is full');
      error.code = 'gallery_full';
      throw error;
    }

    const shape = {
      id: randomUUID(),
      name,
      author,
      themeColor,
      pathCount,
      pointCount,
      uses: 0,
      createdAt: Date.now(),
      hidden: false,
      authorHash: this.hashClient(clientKey),
      reports: [],
    };

    // Write the artwork first: an orphaned file is harmless, an index entry
    // pointing at a missing file is not.
    await writeFile(this.svgPath(shape.id), svg, 'utf8');
    this.shapes.push(shape);
    await this.save();
    return Store.publicView(shape);
  }

  async recordUse(id) {
    const shape = this.get(id);
    if (!shape || shape.hidden) return false;
    shape.uses += 1;
    await this.save();
    return true;
  }

  // Returns `{ ok, alreadyReported, hidden }`.
  async report(id, reason, clientKey) {
    const shape = this.get(id);
    if (!shape) return { ok: false };

    const reporter = this.hashClient(clientKey);
    if (shape.reports.some((r) => r.reporter === reporter)) {
      return { ok: true, alreadyReported: true, hidden: shape.hidden };
    }

    shape.reports.push({ reporter, reason, at: Date.now() });
    if (shape.reports.length >= REPORTS_TO_HIDE) shape.hidden = true;
    await this.save();
    return { ok: true, alreadyReported: false, hidden: shape.hidden };
  }

  listReported() {
    return this.shapes
      .filter((s) => s.reports.length > 0 || s.hidden)
      .sort((a, b) => b.reports.length - a.reports.length)
      .map((s) => ({
        ...Store.publicView(s),
        hidden: s.hidden,
        reportCount: s.reports.length,
        reasons: s.reports.map((r) => r.reason).filter(Boolean),
      }));
  }

  async setHidden(id, hidden) {
    const shape = this.get(id);
    if (!shape) return false;
    shape.hidden = hidden;
    if (!hidden) shape.reports = [];
    await this.save();
    return true;
  }

  async remove(id) {
    const index = this.shapes.findIndex((s) => s.id === id);
    if (index === -1) return false;
    this.shapes.splice(index, 1);
    await this.save();
    try {
      await unlink(this.svgPath(id));
    } catch {
      // Already gone; the index is what matters.
    }
    return true;
  }
}

export async function openStore(dataDir, secret) {
  return new Store(dataDir, secret).load();
}
