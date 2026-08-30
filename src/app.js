// Screen flow, toolbar, settings, and the custom shape creator.

import { createDrawingCanvas } from './canvas.js';
import {
  LOCALES,
  getLocale,
  localizedName,
  onLocaleChange,
  setLocale,
  t,
} from './i18n.js';
import {
  buildMorph,
  denormalize,
  expandBox,
  getBounds,
  morphAt,
  normalize,
  splitStroke,
} from './morph.js';
import {
  createCustomShape,
  loadBuiltinShapes,
  loadCustomShapes,
  prepareShapeSource,
  saveCustomShapes,
} from './shapes.js';
import {
  DEFAULT_TRACE_OPTIONS,
  findBestThreshold,
  loadImage,
  pathsToSvg,
  traceImage,
} from './trace.js';
import { GALLERY_ENABLED } from './config.js';
import {
  hydrate,
  listShapes,
  publishShape,
  recordUse,
  reportShape,
  toggleLike,
} from './gallery.js';

const SETTINGS_KEY = 'always-xx:settings';
const AUTHOR_KEY = 'always-xx:author';
const SVG_NS = 'http://www.w3.org/2000/svg';
const SHAPES_PER_PAGE = 2;
const GALLERY_PAGE = 24;
const FEATURED_POPULAR_LIMIT = 24;

const DEFAULT_SETTINGS = {
  mode: 'manual',
  palette: ['#000000', '#1e88e5', '#e53935'],
  strokeColor: '#000000',
  strokeWidth: 3,
  smoothEnabled: true,
  smoothStrength: 0.5,
  minAspect: 0.1,
  heightScale: 1,
};

const $ = (id) => document.getElementById(id);

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let settings = loadSettings();

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Preferences just won't persist.
  }
}

let builtinShapes = [];
let customShapes = [];
// Popular community submissions, shown in place of the built-in defaults.
// builtinShapes is kept only as a fallback for when the gallery has nothing
// yet (or is unreachable), so the picker is never empty.
let popularShapes = [];
let activeShape = null;
let drawing = null;
let shapePage = 0;

const allShapes = () => {
  const featured = popularShapes.length > 0 ? popularShapes : builtinShapes;
  return [...customShapes, ...featured];
};

async function loadPopularShapes() {
  if (!GALLERY_ENABLED) return [];
  try {
    const page = await listShapes({ sort: 'popular', limit: FEATURED_POPULAR_LIMIT });
    const settled = await Promise.allSettled(page.shapes.map(hydrate));
    return settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  } catch {
    return [];
  }
}

function applyTranslations(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  }
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  }
}

// One-time build of the corner language buttons; call syncLangSwitch after.
function buildLangSwitch() {
  const wrap = $('lang-switch');
  wrap.textContent = '';
  for (const { code, label } of LOCALES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lang-switch__btn';
    btn.textContent = label;
    btn.addEventListener('click', () => setLocale(code));
    wrap.appendChild(btn);
  }
}

function syncLangSwitch() {
  const current = getLocale();
  const buttons = $('lang-switch').querySelectorAll('.lang-switch__btn');
  LOCALES.forEach(({ code }, i) => buttons[i].classList.toggle('is-active', code === current));
}

/**
 * Build an SVG from a shape's parsed points rather than injecting the source
 * markup; imported files are untrusted input.
 *
 * Points are stored normalized independently on x and y (see morph.js
 * normalize), which squashes a non-square shape into a 0..1 unit box. A
 * plain square viewBox would render that squash as-is. Instead we keep the
 * square viewBox (it matches the stored point space) but size the <svg>
 * element itself to the shape's true aspect ratio and turn off
 * preserveAspectRatio, so the browser's non-uniform scale undoes the squash.
 */
function buildPreview(paths, aspectRatio = 1, strokeWidth = 0.02) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const pad = 0.05;
  svg.setAttribute('viewBox', `${-pad} ${-pad} ${1 + pad * 2} ${1 + pad * 2}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.aspectRatio = String(aspectRatio > 0 ? aspectRatio : 1);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(strokeWidth));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  for (const line of paths) {
    if (line.length < 2) continue;
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute(
      'd',
      line.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(4)} ${p.y.toFixed(4)}`).join(' '),
    );
    svg.appendChild(path);
  }
  return svg;
}

function showScreen(which) {
  for (const el of document.querySelectorAll('[data-screen]')) {
    el.hidden = el.dataset.screen !== which;
  }
  $('steps').hidden = which === 'draw';
  for (const el of document.querySelectorAll('.steps__item')) {
    el.classList.toggle('is-active', el.dataset.step === which);
  }
  if (which === 'draw') drawing.resize();
  if (which === 'mode') startModeDemos();
  else stopModeDemos();
}

function renderShapeGrid() {
  const grid = $('shape-grid');
  grid.textContent = '';

  const pool = allShapes();
  const perPage = Math.max(1, SHAPES_PER_PAGE);
  const pages = Math.max(1, Math.ceil(pool.length / perPage));
  shapePage %= pages;
  const visible = pool.slice(shapePage * perPage, shapePage * perPage + perPage);

  for (const shape of visible) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'shape-card';

    const art = document.createElement('div');
    art.className = 'shape-card__art';
    art.style.color = shape.themeColor;
    art.appendChild(buildPreview(shape.paths, shape.aspectRatio));

    const name = document.createElement('span');
    name.className = 'shape-card__name';
    name.textContent = localizedName(shape.name);

    card.append(art, name);
    card.addEventListener('click', () => {
      activeShape = shape;
      if (shape.shared) recordUse(shape.remoteId);
      showScreen('mode');
    });

    if (!shape.builtin && !shape.shared) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'shape-card__delete';
      del.textContent = '×';
      del.title = t('shape.delete');
      del.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!confirm(t('shape.deleteConfirm', { name: localizedName(shape.name) }))) return;
        customShapes = customShapes.filter((s) => s.id !== shape.id);
        saveCustomShapes(customShapes);
        renderShapeGrid();
      });
      card.appendChild(del);
    }

    grid.appendChild(card);
  }

  grid.appendChild(actionCard('shape.custom', CUSTOM_ICON, openMyShapes));
  if (GALLERY_ENABLED) {
    grid.appendChild(actionCard('gallery.open', GALLERY_ICON, openGallery));
  }
}

const CUSTOM_ICON = 'M9 9a3 3 0 1 1 4.5 2.6c-1 .6-1.5 1.2-1.5 2.4M12 18h.01';
const GALLERY_ICON =
  'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M17 9.5a2.5 2.5 0 1 0 0-5'
  + 'M16 13.5a5 5 0 0 1 5 4.5';

// A tile that opens a sheet rather than picking a shape.
function actionCard(labelKey, iconPath, onClick) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'shape-card';

  const art = document.createElement('div');
  art.className = 'shape-card__art';
  art.style.color = 'var(--color-primary)';

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', iconPath);
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  art.appendChild(svg);

  const name = document.createElement('span');
  name.className = 'shape-card__name';
  name.textContent = t(labelKey);

  card.append(art, name);
  card.addEventListener('click', onClick);
  return card;
}

let gallerySort = 'new';
let galleryOffset = 0;
let galleryLoading = false;
// Running max `uses` across loaded pages, so the usage bars stay comparable
// as more shapes are appended via "load more".
let galleryMaxUses = 0;

function setGalleryStatus(key) {
  const el = $('gallery-status');
  if (!key) {
    el.hidden = true;
    return;
  }
  el.textContent = t(key);
  el.hidden = false;
}

function galleryCard(entry, shape) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'gallery-card';

  const art = document.createElement('div');
  art.className = 'gallery-card__art';
  art.style.color = entry.themeColor;
  art.appendChild(buildPreview(shape.paths, shape.aspectRatio, 0.025));

  const name = document.createElement('span');
  name.className = 'gallery-card__name';
  name.textContent = entry.name;

  const meta = document.createElement('span');
  meta.className = 'gallery-card__meta';
  meta.textContent = t('gallery.by', { author: entry.author });

  // How often this shape has been drawn with, shown as a small bar relative
  // to the most-used shape on the current page — a glance at the row tells
  // you which ones are actually getting picked, not just which has a bigger
  // number.
  const usesRow = document.createElement('span');
  usesRow.className = 'gallery-card__uses';
  usesRow.title = t('gallery.uses', { count: entry.uses ?? 0 });

  const usesBar = document.createElement('span');
  usesBar.className = 'gallery-card__uses-bar';
  const usesBarFill = document.createElement('span');
  usesBarFill.className = 'gallery-card__uses-fill';
  const fraction = galleryMaxUses > 0 ? (entry.uses ?? 0) / galleryMaxUses : 0;
  usesBarFill.style.width = `${Math.round(Math.max(fraction > 0 ? 0.06 : 0, fraction) * 100)}%`;
  usesBar.appendChild(usesBarFill);

  const usesCount = document.createElement('span');
  usesCount.className = 'gallery-card__uses-count';
  usesCount.textContent = String(entry.uses ?? 0);

  usesRow.append(usesBar, usesCount);

  // Likes live in their own control so tapping one doesn't pick the shape.
  let liked = Boolean(entry.liked);
  let likes = entry.likes ?? 0;
  const like = document.createElement('button');
  like.type = 'button';
  like.className = 'gallery-card__like';

  const syncLike = () => {
    like.classList.toggle('is-liked', liked);
    like.title = t(liked ? 'gallery.unlike' : 'gallery.like');
    like.setAttribute('aria-pressed', String(liked));
    like.textContent = `${liked ? '♥' : '♡'} ${likes}`;
  };
  syncLike();

  like.addEventListener('click', async (event) => {
    event.stopPropagation();
    // Flip immediately, then reconcile with whatever the server reports.
    liked = !liked;
    likes += liked ? 1 : -1;
    syncLike();
    like.disabled = true;
    try {
      const result = await toggleLike(entry.id);
      liked = result.liked;
      likes = result.likes;
    } catch {
      liked = !liked;
      likes += liked ? 1 : -1;
    } finally {
      like.disabled = false;
      syncLike();
    }
  });

  const report = document.createElement('button');
  report.type = 'button';
  report.className = 'gallery-card__report';
  report.textContent = t('gallery.report');
  report.addEventListener('click', async (event) => {
    event.stopPropagation();
    const reason = prompt(t('gallery.reportPrompt')) ?? '';
    report.disabled = true;
    try {
      const result = await reportShape(entry.id, reason);
      if (result.alreadyReported) {
        alert(t('gallery.reportDup'));
        return;
      }
      // Only drop the card once the shape is actually hidden. Removing it on
      // every report made a single report look like an instant deletion.
      if (result.hidden) {
        alert(t('gallery.reportHidden'));
        card.remove();
      } else {
        report.textContent = t('gallery.reported');
        alert(t('gallery.reportDone'));
      }
    } catch {
      alert(t('gallery.reportFailed'));
      report.disabled = false;
    }
  });

  card.append(report, art, name, meta, usesRow, like);
  card.addEventListener('click', () => {
    activeShape = shape;
    recordUse(entry.id);
    $('gallery-sheet').hidden = true;
    showScreen('mode');
  });
  return card;
}

async function loadGalleryPage(append = false) {
  if (galleryLoading) return;
  galleryLoading = true;
  const list = $('gallery-list');
  const more = $('gallery-more');
  more.hidden = true;
  if (!append) {
    list.textContent = '';
    galleryOffset = 0;
    galleryMaxUses = 0;
  }
  setGalleryStatus('gallery.loading');

  try {
    const page = await listShapes({ sort: gallerySort, limit: GALLERY_PAGE, offset: galleryOffset });
    galleryOffset += page.shapes.length;
    for (const entry of page.shapes) galleryMaxUses = Math.max(galleryMaxUses, entry.uses ?? 0);

    // Artwork is fetched per shape; skip any that fail rather than losing the page.
    const settled = await Promise.allSettled(page.shapes.map(hydrate));
    settled.forEach((result, i) => {
      if (result.status !== 'fulfilled') return;
      list.appendChild(galleryCard(page.shapes[i], result.value));
    });

    setGalleryStatus(list.childElementCount === 0 ? 'gallery.empty' : null);
    more.hidden = !page.hasMore;
  } catch {
    setGalleryStatus('gallery.offline');
  } finally {
    galleryLoading = false;
  }
}

function openGallery() {
  $('gallery-sheet').hidden = false;
  loadGalleryPage(false);
}

function myShapeCard(shape) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'gallery-card';

  const art = document.createElement('div');
  art.className = 'gallery-card__art';
  art.style.color = shape.themeColor;
  art.appendChild(buildPreview(shape.paths, shape.aspectRatio, 0.025));

  const name = document.createElement('span');
  name.className = 'gallery-card__name';
  name.textContent = localizedName(shape.name);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'gallery-card__report';
  del.textContent = t('shape.delete');
  del.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!confirm(t('shape.deleteConfirm', { name: localizedName(shape.name) }))) return;
    customShapes = customShapes.filter((s) => s.id !== shape.id);
    saveCustomShapes(customShapes);
    renderMyShapes();
    renderShapeGrid();
  });

  card.append(del, art, name);
  card.addEventListener('click', () => {
    activeShape = shape;
    $('my-shapes-sheet').hidden = true;
    showScreen('mode');
  });
  return card;
}

function renderMyShapes() {
  const list = $('my-shapes-list');
  list.textContent = '';
  for (const shape of customShapes) list.appendChild(myShapeCard(shape));
  const status = $('my-shapes-status');
  status.hidden = customShapes.length > 0;
  if (!status.hidden) status.textContent = t('myshapes.empty');
}

// If nothing is saved yet, skip straight to the creator instead of showing
// an empty list with nothing to tap but "create".
function openMyShapes() {
  if (customShapes.length === 0) {
    openCustomSheet();
    return;
  }
  renderMyShapes();
  $('my-shapes-sheet').hidden = false;
}

let demoRaf = 0;

// A looping "scribble becomes shape" animation for the mode cards.
function startModeDemos() {
  stopModeDemos();
  if (!activeShape) return;

  const canvases = [...document.querySelectorAll('.mode-card__demo')];
  const setups = canvases.map((canvas) => {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;

    // A fixed squiggle that morphs into the shape without moving, so the
    // before and after read as the same drawing.
    const scribble = [];
    for (let i = 0; i <= 80; i++) {
      const p = i / 80;
      scribble.push({
        x: width * 0.3 + p * width * 0.4,
        y: height * 0.45 + Math.sin(p * Math.PI * 3) * height * 0.25,
      });
    }

    const box = expandBox(getBounds(scribble), settings.minAspect, activeShape.aspectRatio);
    const pieces = splitStroke(normalize(scribble, box), activeShape.paths.length);
    const morphs = pieces.map((piece, i) =>
      buildMorph({
        sourcePoints: denormalize(piece, box),
        targetPoints: denormalize(activeShape.paths[i], box),
      }),
    );
    return { ctx, width, height, morphs, buffers: morphs.map(() => []) };
  });

  const period = 2600;
  const start = performance.now();

  const frame = (now) => {
    const cycle = ((now - start) % period) / period;
    // Hold at each end, morph in between.
    const raw = Math.min(1, Math.max(0, (cycle - 0.15) / 0.5));
    const eased = raw < 0.5 ? 4 * raw ** 3 : 1 - (-2 * raw + 2) ** 3 / 2;

    for (const { ctx, width, height, morphs, buffers } of setups) {
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = '#6b82a3';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      morphs.forEach((morph, i) => {
        const pts = morphAt(morph, eased, buffers[i]);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let j = 1; j < pts.length; j++) ctx.lineTo(pts[j].x, pts[j].y);
        ctx.stroke();
      });
    }
    demoRaf = requestAnimationFrame(frame);
  };
  demoRaf = requestAnimationFrame(frame);
}

function stopModeDemos() {
  if (demoRaf) cancelAnimationFrame(demoRaf);
  demoRaf = 0;
}

function updateStageText(hasContent = false) {
  if (!activeShape) return;
  const shape = localizedName(activeShape.name);
  $('stage-title').textContent = t('draw.title', { shape });
  $('stage-hint').textContent = t(
    settings.mode === 'auto' ? 'draw.hintAuto' : 'draw.hintManual',
    { shape },
  );
  document.querySelector('.stage__bg').classList.toggle('is-hidden', hasContent);
  $('stage-title').style.color = activeShape.themeColor;
}

function renderToolbarPalette() {
  const wrap = $('toolbar-palette');
  wrap.textContent = '';
  for (const color of settings.palette) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'swatch';
    swatch.classList.toggle('is-active', color === settings.strokeColor);
    swatch.style.background = color;
    swatch.setAttribute('aria-label', t('draw.color', { color }));
    swatch.addEventListener('click', () => {
      settings.strokeColor = color;
      saveSettings();
      renderToolbarPalette();
    });
    wrap.appendChild(swatch);
  }
  $('any-color').value = /^#[0-9a-f]{6}$/i.test(settings.strokeColor)
    ? settings.strokeColor
    : '#000000';
}

function renderPaletteEditor() {
  const wrap = $('palette-editor');
  wrap.textContent = '';

  settings.palette.forEach((color, index) => {
    const slot = document.createElement('div');
    slot.className = 'palette-editor__slot';

    const input = document.createElement('input');
    input.type = 'color';
    input.value = color;
    input.setAttribute('aria-label', t('draw.color', { color }));
    input.addEventListener('input', () => {
      const previous = settings.palette[index];
      settings.palette[index] = input.value;
      if (settings.strokeColor === previous) settings.strokeColor = input.value;
      saveSettings();
      renderToolbarPalette();
    });
    slot.appendChild(input);

    if (settings.palette.length > 1) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'palette-editor__remove';
      remove.textContent = '×';
      remove.title = t('settings.paletteRemove');
      remove.addEventListener('click', () => {
        settings.palette.splice(index, 1);
        if (!settings.palette.includes(settings.strokeColor)) {
          settings.strokeColor = settings.palette[0];
        }
        saveSettings();
        renderPaletteEditor();
        renderToolbarPalette();
      });
      slot.appendChild(remove);
    }

    wrap.appendChild(slot);
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'palette-editor__add';
  add.textContent = '+';
  add.title = t('settings.paletteAdd');
  add.addEventListener('click', () => {
    settings.palette.push('#43a047');
    saveSettings();
    renderPaletteEditor();
    renderToolbarPalette();
  });
  wrap.appendChild(add);
}

function drawWidthPreview() {
  const canvas = $('width-preview');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = settings.strokeColor;
  ctx.lineWidth = settings.strokeWidth;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let x = 12; x <= canvas.width - 12; x++) {
    const y = canvas.height / 2 + Math.sin((x / canvas.width) * Math.PI * 2) * 10;
    if (x === 12) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function syncSettings() {
  for (const el of document.querySelectorAll('[data-set-mode]')) {
    el.classList.toggle('is-active', el.dataset.setMode === settings.mode);
  }
  $('min-aspect').value = String(settings.minAspect);
  $('min-aspect-value').textContent = `${Math.round(settings.minAspect * 100)}%`;
  $('height-scale').value = String(settings.heightScale);
  $('height-scale-value').textContent = `${Math.round(settings.heightScale * 100)}%`;
  $('stroke-width').value = String(settings.strokeWidth);
  $('stroke-width-value').textContent = `${settings.strokeWidth.toFixed(1)}px`;
  $('smooth-enabled').checked = settings.smoothEnabled;
  $('smooth-strength').value = String(settings.smoothStrength);
  $('smooth-strength-value').textContent = `${Math.round(settings.smoothStrength * 100)}%`;
  $('locale-select').value = getLocale();
  renderPaletteEditor();
  drawWidthPreview();
}

// Holds the pending import between file pick and save.
let draft = { svg: null, image: null, paths: null, aspectRatio: 1 };
let traceTimer = 0;

function openCustomSheet() {
  draft = { svg: null, image: null, paths: null, aspectRatio: 1 };
  $('custom-name').value = '';
  $('custom-file').value = '';
  $('trace-preview').hidden = true;
  $('trace-options').hidden = true;
  $('trace-threshold').value = '0.5';
  $('trace-detail').value = String(DEFAULT_TRACE_OPTIONS.simplify);
  $('trace-smooth').value = String(DEFAULT_TRACE_OPTIONS.curveError);
  $('trace-invert').checked = false;
  $('publish-group').hidden = !GALLERY_ENABLED;
  $('publish-toggle').checked = false;
  $('publish-author-cell').hidden = true;
  $('publish-author').value = loadAuthorName();
  showCustomError(null);
  syncTraceLabels();
  $('custom-sheet').hidden = false;
}

function loadAuthorName() {
  try {
    return localStorage.getItem(AUTHOR_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveAuthorName(name) {
  try {
    localStorage.setItem(AUTHOR_KEY, name);
  } catch {
    // Not worth failing the publish over.
  }
}

function showCustomError(key) {
  const el = $('custom-error');
  if (!key) {
    el.hidden = true;
    return;
  }
  el.textContent = t(key);
  el.hidden = false;
}

function syncTraceLabels() {
  const threshold = Number($('trace-threshold').value);
  $('trace-threshold-value').textContent = `${Math.round(threshold * 100)}%`;
  $('trace-detail-value').textContent = Number($('trace-detail').value).toFixed(1);
  $('trace-smooth-value').textContent = Number($('trace-smooth').value).toFixed(1);
}

function showTracePreview(paths, aspectRatio) {
  const box = $('trace-preview-box');
  box.textContent = '';
  box.appendChild(buildPreview(paths, aspectRatio, 0.012));
  $('trace-count').textContent = t('custom.pathCount', { count: paths.length });
  $('trace-preview').hidden = false;
}

// Seed the creator with SVG that already exists (a drawing made on the canvas),
// skipping the file picker and tracing controls entirely.
function adoptDrawnShape(svg) {
  try {
    draft.svg = svg;
    draft.image = null;
    ({ paths: draft.paths, aspectRatio: draft.aspectRatio } = prepareShapeSource(svg));
  } catch {
    showCustomError('custom.errorParse');
    return;
  }
  $('trace-options').hidden = true;
  showTracePreview(draft.paths, draft.aspectRatio);
  // Sharing is the point of this entry path, so opt in by default.
  if (GALLERY_ENABLED) {
    $('publish-toggle').checked = true;
    $('publish-author-cell').hidden = false;
  }
}

// Re-run the tracer with the current slider values.
function retrace() {
  if (!draft.image) return;
  const preview = $('trace-preview');
  preview.classList.add('is-busy');

  // Defer so the busy state paints before the synchronous trace blocks.
  // setTimeout rather than rAF: a background tab stops painting frames, and
  // the trace still has to finish there.
  setTimeout(() => {
    try {
      const { paths, width, height } = traceImage(draft.image, {
        threshold: Number($('trace-threshold').value),
        simplify: Number($('trace-detail').value),
        invert: $('trace-invert').checked,
      });
      if (paths.length === 0) {
        showCustomError('custom.errorEmpty');
        draft.svg = null;
        draft.paths = null;
        preview.hidden = true;
        return;
      }
      showCustomError(null);
      draft.svg = pathsToSvg(paths, width, height, Number($('trace-smooth').value));
      ({ paths: draft.paths, aspectRatio: draft.aspectRatio } = prepareShapeSource(draft.svg));
      showTracePreview(draft.paths, draft.aspectRatio);
    } catch {
      showCustomError('custom.errorParse');
    } finally {
      preview.classList.remove('is-busy');
    }
  });
}

function scheduleRetrace() {
  syncTraceLabels();
  clearTimeout(traceTimer);
  traceTimer = setTimeout(retrace, 180);
}

async function handleFilePicked(file) {
  if (!file) return;
  showCustomError(null);

  if (!$('custom-name').value.trim()) {
    $('custom-name').value = file.name.replace(/\.[^.]+$/, '');
  }

  const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);

  if (isSvg) {
    try {
      draft.svg = await file.text();
      draft.image = null;
      ({ paths: draft.paths, aspectRatio: draft.aspectRatio } = prepareShapeSource(draft.svg));
    } catch {
      showCustomError('custom.errorParse');
      return;
    }
    $('trace-options').hidden = true;
    showTracePreview(draft.paths, draft.aspectRatio);
    return;
  }

  try {
    draft.image = await loadImage(file);
  } catch {
    showCustomError('custom.errorParse');
    return;
  }

  // Search for the threshold that traces this image best, rather than just
  // taking Otsu's global guess, then seed the slider with it.
  $('trace-options').hidden = false;
  showCustomError(null);
  $('trace-count').textContent = t('custom.tracing');
  $('trace-preview').hidden = false;
  $('trace-preview').classList.add('is-busy');

  await new Promise((resolve) => setTimeout(resolve, 0));
  let best;
  try {
    best = findBestThreshold(draft.image, { invert: $('trace-invert').checked });
  } catch {
    best = { threshold: 0.5 };
  } finally {
    $('trace-preview').classList.remove('is-busy');
  }

  $('trace-threshold').value = String(best.threshold.toFixed(2));
  syncTraceLabels();
  retrace();
}

const PUBLISH_ERRORS = {
  rate_limited: 'publish.rateLimited',
  svg_too_complex: 'publish.tooComplex',
  svg_too_large: 'publish.tooComplex',
};

async function handleCustomSave() {
  showCustomError(null);

  const name = $('custom-name').value.trim();
  if (!name) {
    showCustomError('custom.errorName');
    return;
  }
  if (!draft.svg) {
    showCustomError('custom.errorFile');
    return;
  }

  const themeColor = $('custom-color').value;
  let shape;
  try {
    shape = createCustomShape({
      name: { ja: name, en: name, zh: name },
      themeColor,
      svg: draft.svg,
    });
  } catch {
    showCustomError('custom.errorParse');
    return;
  }

  // Publish before saving locally, so a rejected upload can still be corrected
  // without leaving a half-finished entry behind.
  if (GALLERY_ENABLED && $('publish-toggle').checked) {
    const author = $('publish-author').value.trim() || 'anonymous';
    const save = $('custom-save');
    save.disabled = true;
    save.textContent = t('publish.working');
    try {
      await publishShape({ name, author, themeColor, svg: draft.svg });
      saveAuthorName(author);
    } catch (error) {
      showCustomError(PUBLISH_ERRORS[error.code] ?? 'publish.failed');
      return;
    } finally {
      save.disabled = false;
      save.textContent = t('custom.save');
    }
  }

  customShapes = [shape, ...customShapes];
  if (!saveCustomShapes(customShapes)) {
    showCustomError('custom.errorStorage');
  }

  shapePage = 0;
  renderShapeGrid();
  $('custom-sheet').hidden = true;
}

async function init() {
  document.documentElement.lang = getLocale() === 'zh' ? 'zh-CN' : getLocale();
  applyTranslations();

  const localeSelect = $('locale-select');
  for (const { code, label } of LOCALES) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = label;
    localeSelect.appendChild(option);
  }
  localeSelect.addEventListener('change', () => setLocale(localeSelect.value));

  buildLangSwitch();
  syncLangSwitch();

  onLocaleChange(() => {
    applyTranslations();
    renderShapeGrid();
    renderToolbarPalette();
    syncSettings();
    syncLangSwitch();
    updateStageText(!$('tool-clear').disabled);
  });

  drawing = createDrawingCanvas($('canvas'), {
    getStrokeColor: () => settings.strokeColor,
    getStrokeWidth: () => settings.strokeWidth,
    getSmoothEnabled: () => settings.smoothEnabled,
    getSmoothStrength: () => settings.smoothStrength,
    getMinAspect: () => settings.minAspect,
    getHeightScale: () => settings.heightScale,
    getMode: () => settings.mode,
    getShape: () => activeShape,
    getBackground: () => '#ffffff',
    onChange: ({ hasContent, canUndo, canMorph }) => {
      $('tool-undo').disabled = !canUndo;
      $('tool-morph').disabled = !canMorph;
      $('tool-save').disabled = !hasContent;
      $('tool-publish').disabled = !hasContent || !GALLERY_ENABLED;
      $('tool-clear').disabled = !hasContent;
      updateStageText(hasContent);
    },
    onViewChange: ({ scale }) => {
      const pct = Math.round(scale * 100);
      $('zoom-pct').textContent = `${pct}%`;
      $('zoom').hidden = pct === 100;
    },
  });

  // Shape picker
  $('shape-shuffle').addEventListener('click', () => {
    shapePage += 1;
    renderShapeGrid();
  });

  // Mode picker
  $('mode-auto').addEventListener('click', () => {
    settings.mode = 'auto';
    saveSettings();
    updateStageText();
    showScreen('draw');
  });
  $('mode-manual').addEventListener('click', () => {
    settings.mode = 'manual';
    saveSettings();
    updateStageText();
    showScreen('draw');
  });

  // Toolbar
  $('any-color').addEventListener('input', (e) => {
    settings.strokeColor = e.target.value;
    saveSettings();
    renderToolbarPalette();
  });
  $('tool-undo').addEventListener('click', () => drawing.undo());
  $('tool-shape').addEventListener('click', () => showScreen('shape'));
  $('tool-settings').addEventListener('click', () => {
    syncSettings();
    $('settings-sheet').hidden = false;
  });
  $('tool-morph').addEventListener('click', () => drawing.morphAll(activeShape));
  $('tool-clear').addEventListener('click', () => {
    if (confirm(t('draw.clearConfirm'))) drawing.clear();
  });
  $('tool-save').addEventListener('click', async () => {
    const blob = await drawing.toBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `always-xx-${Date.now()}.png`;
    link.click();
    URL.revokeObjectURL(url);
  });
  $('zoom-reset').addEventListener('click', () => drawing.resetView());
  $('tool-publish').addEventListener('click', () => {
    const svg = drawing.toShapeSvg();
    if (!svg) {
      alert(t('draw.publishEmpty'));
      return;
    }
    openCustomSheet();
    adoptDrawnShape(svg);
  });

  // Settings
  for (const el of document.querySelectorAll('[data-set-mode]')) {
    el.addEventListener('click', () => {
      settings.mode = el.dataset.setMode;
      saveSettings();
      syncSettings();
      updateStageText(!$('tool-clear').disabled);
    });
  }
  $('min-aspect').addEventListener('input', (e) => {
    settings.minAspect = Number(e.target.value);
    saveSettings();
    syncSettings();
  });
  $('height-scale').addEventListener('input', (e) => {
    settings.heightScale = Number(e.target.value);
    saveSettings();
    syncSettings();
  });
  $('stroke-width').addEventListener('input', (e) => {
    settings.strokeWidth = Number(e.target.value);
    saveSettings();
    syncSettings();
  });
  $('smooth-enabled').addEventListener('change', (e) => {
    settings.smoothEnabled = e.target.checked;
    saveSettings();
  });
  $('smooth-strength').addEventListener('input', (e) => {
    settings.smoothStrength = Number(e.target.value);
    saveSettings();
    syncSettings();
  });
  $('settings-reset').addEventListener('click', () => {
    if (!confirm(t('settings.resetConfirm'))) return;
    settings = { ...DEFAULT_SETTINGS, palette: [...DEFAULT_SETTINGS.palette] };
    saveSettings();
    syncSettings();
    renderToolbarPalette();
  });

  // Custom shape creator
  $('custom-file').addEventListener('change', (e) => handleFilePicked(e.target.files?.[0]));
  $('publish-toggle').addEventListener('change', (e) => {
    $('publish-author-cell').hidden = !e.target.checked;
  });

  for (const el of document.querySelectorAll('[data-sort]')) {
    el.addEventListener('click', () => {
      if (gallerySort === el.dataset.sort) return;
      gallerySort = el.dataset.sort;
      for (const tab of document.querySelectorAll('[data-sort]')) {
        tab.classList.toggle('is-active', tab === el);
      }
      loadGalleryPage(false);
    });
  }
  $('gallery-more').addEventListener('click', () => loadGalleryPage(true));
  $('my-shapes-create').addEventListener('click', () => {
    $('my-shapes-sheet').hidden = true;
    openCustomSheet();
  });
  $('trace-threshold').addEventListener('input', scheduleRetrace);
  $('trace-detail').addEventListener('input', scheduleRetrace);
  $('trace-smooth').addEventListener('input', scheduleRetrace);
  $('trace-invert').addEventListener('change', scheduleRetrace);
  $('trace-auto').addEventListener('click', async () => {
    if (!draft.image) return;
    const preview = $('trace-preview');
    preview.classList.add('is-busy');
    $('trace-count').textContent = t('custom.searching');
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const best = findBestThreshold(draft.image, { invert: $('trace-invert').checked });
      $('trace-threshold').value = String(best.threshold.toFixed(2));
      syncTraceLabels();
    } finally {
      preview.classList.remove('is-busy');
    }
    retrace();
  });
  $('custom-save').addEventListener('click', handleCustomSave);

  // Sheets
  for (const el of document.querySelectorAll('[data-close]')) {
    el.addEventListener('click', () => {
      $(`${el.dataset.close}-sheet`).hidden = true;
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      for (const sheet of document.querySelectorAll('.sheet')) sheet.hidden = true;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      drawing.undo();
    }
  });

  renderToolbarPalette();
  syncSettings();

  customShapes = loadCustomShapes();
  [builtinShapes, popularShapes] = await Promise.all([loadBuiltinShapes(), loadPopularShapes()]);
  renderShapeGrid();
}

init().catch((error) => {
  console.error(error);
  document.body.textContent = `Failed to start: ${error.message}`;
});
