// Drawing surface: strokes, pinch/wheel zoom, and the morph animation.
// auto mode morphs each stroke on pen up, manual waits for the toolbar button.

import {
  buildMorph,
  denormalize,
  expandBox,
  getBounds,
  matchPiecesToPaths,
  morphAt,
  normalize,
  scaleBoxHeight,
  smooth,
  splitStroke,
} from './morph.js';
import { encodeGif } from './gif.js';

const MAX_UNDO = 50;
const MIN_SCALE = 0.1;
const MAX_SCALE = 10;
// Ignore pointer moves closer than this (in world units). Trackpads and
// high-rate styluses fire far more events than the stroke needs, and every
// extra point costs on smoothing, hit testing and redraw for the rest of
// the session.
const MIN_POINT_DISTANCE = 1.1;

const clampScale = (s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

// Long edge of an exported GIF, in pixels. Downscaled well below the live
// canvas's device-pixel size so encoding stays fast and the file stays
// small enough to actually share.
const GIF_MAX_DIMENSION = 480;
const GIF_FPS = 12;
// How long to hold the first and last frame, on top of one frame's own
// interval, so the still shape reads clearly instead of just flashing by.
const GIF_HOLD_FRAMES = 5;

export function createDrawingCanvas(canvas, options = {}) {
  const {
    getStrokeColor = () => '#000000',
    getStrokeWidth = () => 3,
    getSmoothEnabled = () => true,
    getSmoothStrength = () => 0.5,
    getMinAspect = () => 0.1,
    getHeightScale = () => 1,
    getMode = () => 'manual',
    getShape = () => null,
    getBackground = () => '#ffffff',
    onChange = () => {},
    onViewChange = () => {},
  } = options;

  const ctx = canvas.getContext('2d');

  // Committed strokes are baked into this offscreen canvas once, instead of
  // being redrawn every frame. Without it, render() cost grows with total
  // drawing history rather than with what's currently animating, which is
  // what made the canvas bog down after a lot of strokes piled up.
  const base = document.createElement('canvas');
  const baseCtx = base.getContext('2d');
  let baseDirty = true;
  let baseView = { scale: NaN, panX: NaN, panY: NaN };

  let strokes = [];
  let history = [];
  let animations = [];

  let activePointerId = null;
  let activePoints = [];
  let activeWidth = 3;
  let rafId = 0;
  // Smoothing the in-progress stroke is O(points x passes); cache the result
  // so a frame that renders the same stroke twice doesn't redo it.
  let smoothedCache = null;
  let smoothedForLength = -1;

  let width = 0;
  let height = 0;

  const view = { scale: 1, panX: 0, panY: 0 };
  // Live pointers, for pinch gestures.
  const pointers = new Map();
  let pinch = null;

  const toLocal = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  // Screen point -> drawing coordinates.
  const toWorld = (p) => ({ x: (p.x - view.panX) / view.scale, y: (p.y - view.panY) / view.scale });
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  function setView(next) {
    view.scale = next.scale;
    view.panX = next.panX;
    view.panY = next.panY;
    onViewChange({ ...view });
    render();
  }

  // Zoom about a fixed screen point so it stays put.
  function zoomAt(anchor, factor) {
    const scale = clampScale(view.scale * factor);
    const ratio = scale / view.scale;
    setView({
      scale,
      panX: anchor.x - (anchor.x - view.panX) * ratio,
      panY: anchor.y - (anchor.y - view.panY) * ratio,
    });
  }

  function applySmoothing(points) {
    return getSmoothEnabled() && getSmoothStrength() > 0
      ? smooth(points, getSmoothStrength())
      : points;
  }

  function activeSmoothed() {
    if (smoothedForLength !== activePoints.length) {
      smoothedCache = applySmoothing(activePoints);
      smoothedForLength = activePoints.length;
    }
    return smoothedCache;
  }

  function resetActive() {
    activePoints = [];
    smoothedCache = null;
    smoothedForLength = -1;
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    baseDirty = true;
    render();
  }

  function drawPolylineOn(context, points, color, lineWidth) {
    if (points.length === 1) {
      context.fillStyle = color;
      context.beginPath();
      context.arc(points[0].x, points[0].y, lineWidth / 2, 0, Math.PI * 2);
      context.fill();
      return;
    }
    if (points.length < 2) return;
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) context.lineTo(points[i].x, points[i].y);
    context.stroke();
  }

  const drawPolyline = (points, color, lineWidth) => drawPolylineOn(ctx, points, color, lineWidth);

  function setWorldTransform(context) {
    const dpr = window.devicePixelRatio || 1;
    context.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.panX, dpr * view.panY);
    context.lineCap = 'round';
    context.lineJoin = 'round';
  }

  // Redraw every committed stroke onto the base layer. Only needed when the
  // canvas resizes, the view pans/zooms, or strokes are removed/reordered
  // (undo, clear, a stroke leaving `strokes` to become a morph animation) —
  // none of which happen on every frame.
  function rebuildBase() {
    base.width = canvas.width;
    base.height = canvas.height;
    baseCtx.setTransform(1, 0, 0, 1, 0, 0);
    baseCtx.clearRect(0, 0, base.width, base.height);
    setWorldTransform(baseCtx);
    for (const stroke of strokes) drawPolylineOn(baseCtx, stroke.points, stroke.color, stroke.width);
    baseView = { ...view };
    baseDirty = false;
  }

  // Append one stroke to the base layer without touching the rest of it.
  // Only valid while the base is already up to date with the current view.
  function bakeStroke(stroke) {
    setWorldTransform(baseCtx);
    drawPolylineOn(baseCtx, stroke.points, stroke.color, stroke.width);
  }

  function commitStroke(stroke) {
    strokes.push(stroke);
    const baseCurrent =
      !baseDirty &&
      base.width === canvas.width &&
      base.height === canvas.height &&
      view.scale === baseView.scale &&
      view.panX === baseView.panX &&
      view.panY === baseView.panY;
    if (baseCurrent) bakeStroke(stroke);
    else baseDirty = true;
  }

  function render() {
    const dpr = window.devicePixelRatio || 1;
    const viewChanged =
      view.scale !== baseView.scale || view.panX !== baseView.panX || view.panY !== baseView.panY;
    if (baseDirty || viewChanged || base.width !== canvas.width || base.height !== canvas.height) {
      rebuildBase();
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Paint an opaque background rather than clearing to transparent. The
    // page's own background showed through either way for a normal viewer,
    // but canvas.captureStream() reads this canvas's actual pixels — with a
    // transparent backdrop, the recorder composited it to black, so a
    // "recorded" clip came out solid black with the (also black) ink
    // invisible against it.
    ctx.fillStyle = getBackground();
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);

    setWorldTransform(ctx);
    for (const anim of animations) drawPolyline(anim.interp, anim.color, anim.width);
    if (activePoints.length > 0) {
      drawPolyline(activeSmoothed(), getStrokeColor(), activeWidth);
    }
  }

  function tick() {
    rafId = 0;
    const now = performance.now();
    let running = false;
    let settled = false;

    for (const anim of animations) {
      const raw = Math.min(1, (now - anim.start) / anim.morph.durationMs);
      morphAt(anim.morph, anim.morph.easing(raw), anim.interp);
      if (raw < 1) running = true;
      else if (!anim.done) {
        anim.done = true;
        settled = true;
      }
    }

    if (settled) {
      for (const anim of animations) {
        if (!anim.done) continue;
        commitStroke({
          points: anim.morph.tgt.map((p) => ({ x: p.x, y: p.y })),
          color: anim.color,
          width: anim.width,
          morphed: true,
        });
      }
      animations = animations.filter((a) => !a.done);
      emitChange();
    }

    render();
    if (running || animations.length > 0) schedule();
  }

  function schedule() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  function pushHistory() {
    history.push(strokes.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p })) })));
    if (history.length > MAX_UNDO) history.shift();
  }

  function emitChange() {
    onChange({
      hasContent: strokes.length > 0 || animations.length > 0,
      canUndo: history.length > 0,
      canMorph: strokes.some((s) => !s.morphed),
    });
  }

  // Pure math: the per-piece morphs that turn one (possibly stroke-combined)
  // drawing into `shape`, with no side effects on live drawing state. Shared
  // by the live animation path and the GIF exporter, which needs the same
  // morphs without touching `animations`.
  function buildMorphBatch(stroke, shape) {
    const fitted = expandBox(getBounds(stroke.points), getMinAspect(), shape.aspectRatio);
    const box = scaleBoxHeight(fitted, getHeightScale());
    // Normalise against the fitted box so the stroke still maps end to end;
    // only the target box is stretched.
    const pieces = splitStroke(normalize(stroke.points, fitted), shape.paths.length);
    // Pieces come out in drawing order, which has no reason to match the
    // order the shape's paths happen to be defined in — pair each piece with
    // whichever path is actually nearest it instead.
    const assignment = matchPiecesToPaths(pieces, shape.paths);

    return pieces.map((piece, i) => ({
      morph: buildMorph({
        sourcePoints: denormalize(piece, fitted),
        targetPoints: denormalize(shape.paths[assignment[i]], box),
      }),
      color: stroke.color,
      width: stroke.width,
    }));
  }

  // Queue the animations that turn one stroke into `shape`.
  function morphStroke(stroke, shape) {
    for (const { morph, color, width } of buildMorphBatch(stroke, shape)) {
      animations.push({ morph, interp: [], start: performance.now(), color, width, done: false });
    }
  }

  // Group pending strokes by the shape they were drawn under, combining each
  // group into one virtual stroke. Without this, each stroke morphed alone
  // into every one of the shape's paths — splitting the outline into one
  // piece, an eye into another, and so on — which forced drawing the whole
  // shape as one unbroken line to get a clean result. Combining same-shape
  // strokes first means the outline, an eye and the mouth can each be their
  // own pen stroke and still land on the right parts together.
  //
  // Returns `{ indices, groups }` — `indices` are the pending strokes'
  // positions in `strokes` (for the caller to remove), `groups` are
  // `{ shape, combined }` ready for buildMorphBatch. Returns null if there
  // is nothing pending.
  function groupPendingStrokes(fallbackShape) {
    const pending = strokes
      .map((stroke, index) => ({ stroke, index }))
      .filter(({ stroke }) => !stroke.morphed);
    if (pending.length === 0) return null;

    const byShape = new Map();
    for (const { stroke, index } of pending) {
      const shape = stroke.shape ?? fallbackShape;
      if (!shape || !shape.paths || shape.paths.length === 0) continue;
      const key = shape.id ?? shape;
      if (!byShape.has(key)) byShape.set(key, { shape, items: [] });
      byShape.get(key).items.push({ stroke, index });
    }
    if (byShape.size === 0) return null;

    const indices = [...byShape.values()].flatMap(({ items }) => items.map((i) => i.index));
    const groups = [...byShape.values()].map(({ shape, items }) => {
      items.sort((a, b) => a.index - b.index); // draw order, not insertion order
      return {
        shape,
        combined: {
          points: items.flatMap(({ stroke }) => stroke.points),
          color: items[items.length - 1].stroke.color,
          width: items[items.length - 1].stroke.width,
        },
      };
    });
    return { indices, groups };
  }

  function morphAll(fallbackShape) {
    const grouped = groupPendingStrokes(fallbackShape);
    if (!grouped) return;

    pushHistory();

    // Backwards so splicing doesn't shift indices still to come.
    for (const index of [...grouped.indices].sort((a, b) => b - a)) strokes.splice(index, 1);
    baseDirty = true;

    for (const { shape, combined } of grouped.groups) morphStroke(combined, shape);

    emitChange();
    schedule();
  }

  function cancelStroke() {
    if (activePointerId === null) return;
    activePointerId = null;
    resetActive();
    render();
  }

  function onPointerDown(event) {
    if (pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, toLocal(event));

    if (pointers.size >= 2) {
      // A second finger turns the gesture into pinch-zoom/pan.
      cancelStroke();
      const [a, b] = [...pointers.values()];
      pinch = {
        view: { ...view },
        distance: Math.max(1, distance(a, b)),
        centre: midpoint(a, b),
      };
      return;
    }

    if (activePointerId !== null) return;
    activePointerId = event.pointerId;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Capture is an optimisation; drawing still works without it.
    }
    activeWidth = getStrokeWidth();
    resetActive();
    activePoints.push(toWorld(toLocal(event)));
    render();
  }

  function onPointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, toLocal(event));

    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const scale = clampScale(pinch.view.scale * (distance(a, b) / pinch.distance));
      const anchor = {
        x: (pinch.centre.x - pinch.view.panX) / pinch.view.scale,
        y: (pinch.centre.y - pinch.view.panY) / pinch.view.scale,
      };
      const centre = midpoint(a, b);
      setView({ scale, panX: centre.x - anchor.x * scale, panY: centre.y - anchor.y * scale });
      return;
    }

    if (event.pointerId !== activePointerId) return;
    const next = toWorld(toLocal(event));
    const last = activePoints[activePoints.length - 1];
    if (last && Math.hypot(next.x - last.x, next.y - last.y) * view.scale < MIN_POINT_DISTANCE) {
      return;
    }
    activePoints.push(next);
    schedule();
  }

  function finishStroke() {
    const points = activeSmoothed();
    resetActive();
    if (points.length === 0) return;

    pushHistory();
    const shape = getShape();
    const stroke = { points, color: getStrokeColor(), width: activeWidth, morphed: false, shape };

    if (getMode() === 'auto' && shape && shape.paths.length > 0) {
      morphStroke(stroke, shape);
      schedule();
    } else {
      commitStroke(stroke);
    }
    render();
    emitChange();
  }

  function onPointerUp(event) {
    pointers.delete(event.pointerId);

    if (pinch) {
      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        pinch = { view: { ...view }, distance: Math.max(1, distance(a, b)), centre: midpoint(a, b) };
      } else {
        pinch = null;
        cancelStroke();
      }
      return;
    }

    if (event.pointerId !== activePointerId) return;
    activePointerId = null;
    finishStroke();
  }

  function onPointerCancel(event) {
    pointers.delete(event.pointerId);
    if (event.pointerId === activePointerId) cancelStroke();
  }

  function onWheel(event) {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0012));
    zoomAt(toLocal(event), factor);
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);

  // Render one animated GIF frame at progress `t` (0..1) onto `snapCtx`,
  // sized outW x outH — the settled base layer plus every pending batch's
  // interpolated position at that point in the morph.
  // A static backdrop for the GIF export: background plus every already-
  // settled stroke, scaled to the export size. Deliberately built fresh
  // rather than reused from `base` — `base` bakes a stroke in the moment
  // it's drawn, before anyone has decided whether it's about to be morphed,
  // so it still contains the pending strokes this export is about to
  // animate. Compositing those under their own animation would leave the
  // original doodle showing through for the whole clip, most obviously in
  // the final frame once it no longer resembles the finished shape at all.
  function buildGifBackdrop(outW, outH, outScale) {
    const backdrop = document.createElement('canvas');
    backdrop.width = outW;
    backdrop.height = outH;
    const bctx = backdrop.getContext('2d');
    bctx.fillStyle = getBackground();
    bctx.fillRect(0, 0, outW, outH);

    const dpr = window.devicePixelRatio || 1;
    const s = outScale * dpr * view.scale;
    bctx.setTransform(s, 0, 0, s, outScale * dpr * view.panX, outScale * dpr * view.panY);
    bctx.lineCap = 'round';
    bctx.lineJoin = 'round';
    for (const stroke of strokes) {
      if (stroke.morphed) drawPolylineOn(bctx, stroke.points, stroke.color, stroke.width);
    }
    return backdrop;
  }

  function drawGifFrame(snapCtx, outW, outH, outScale, backdrop, batches, t) {
    snapCtx.setTransform(1, 0, 0, 1, 0, 0);
    snapCtx.drawImage(backdrop, 0, 0);

    const dpr = window.devicePixelRatio || 1;
    const s = outScale * dpr * view.scale;
    snapCtx.setTransform(s, 0, 0, s, outScale * dpr * view.panX, outScale * dpr * view.panY);
    snapCtx.lineCap = 'round';
    snapCtx.lineJoin = 'round';

    for (const { morph, color, width } of batches) {
      const points = morphAt(morph, morph.easing(t), []);
      drawPolylineOn(snapCtx, points, color, width);
    }
  }

  // The true "before" picture: backdrop plus each pending stroke drawn on
  // its own. buildMorphBatch concatenates same-shape strokes into one
  // virtual line for the morph math, which bridges the gap between two
  // separately pen-lifted strokes with a straight connecting segment —
  // harmless once the animation is moving, but wrong to hold on, since it
  // shows a stroke that was never actually drawn. This draws each stroke
  // with its own gap intact instead, matching what the canvas looked like
  // right before the export started.
  function drawOriginalFrame(snapCtx, outW, outH, outScale, backdrop, pendingStrokes) {
    snapCtx.setTransform(1, 0, 0, 1, 0, 0);
    snapCtx.drawImage(backdrop, 0, 0);

    const dpr = window.devicePixelRatio || 1;
    const s = outScale * dpr * view.scale;
    snapCtx.setTransform(s, 0, 0, s, outScale * dpr * view.panX, outScale * dpr * view.panY);
    snapCtx.lineCap = 'round';
    snapCtx.lineJoin = 'round';
    for (const stroke of pendingStrokes) {
      drawPolylineOn(snapCtx, stroke.points, stroke.color, stroke.width);
    }
  }

  /**
   * Export the next morph as an animated GIF, and actually perform that
   * morph on the live canvas too — exporting stands in for pressing the
   * regular morph button, not an extra step alongside it.
   *
   * Frames are sampled at fixed points along the morph's own 0..1 progress
   * rather than captured from real time, so the result doesn't depend on
   * the browser actually delivering rAF/timer callbacks on schedule — a
   * backgrounded tab or a slow device can't produce a choppy or truncated
   * GIF the way it could a live screen recording.
   */
  async function recordMorphGif(fallbackShape) {
    const grouped = groupPendingStrokes(fallbackShape);
    if (!grouped) throw new Error('Nothing to morph');
    // Snapshot before buildMorphBatch's concatenation, for the opening hold.
    const originalPending = strokes.filter((s) => !s.morphed);

    const batches = grouped.groups.flatMap(({ shape, combined }) => buildMorphBatch(combined, shape));
    if (batches.length === 0) throw new Error('Nothing to morph');

    const outScale = Math.min(1, GIF_MAX_DIMENSION / Math.max(canvas.width, canvas.height));
    const outW = Math.max(1, Math.round(canvas.width * outScale));
    const outH = Math.max(1, Math.round(canvas.height * outScale));
    const backdrop = buildGifBackdrop(outW, outH, outScale);
    const snap = document.createElement('canvas');
    snap.width = outW;
    snap.height = outH;
    const snapCtx = snap.getContext('2d', { willReadFrequently: true });

    const durationMs = batches[0].morph.durationMs;
    const stepCount = Math.max(2, Math.round((durationMs / 1000) * GIF_FPS));
    const delayCs = Math.max(2, Math.round(100 / GIF_FPS));

    const frames = [];
    for (let i = 0; i <= stepCount; i++) {
      drawGifFrame(snapCtx, outW, outH, outScale, backdrop, batches, i / stepCount);
      frames.push({ data: snapCtx.getImageData(0, 0, outW, outH).data, delayCs });
    }
    // The opening hold shows the drawing as it actually was, not
    // buildMorphBatch's concatenated stand-in for it (see drawOriginalFrame).
    drawOriginalFrame(snapCtx, outW, outH, outScale, backdrop, originalPending);
    frames[0] = { data: snapCtx.getImageData(0, 0, outW, outH).data, delayCs };
    // Hold the drawing before it starts moving, and the finished shape after,
    // so both ends read clearly instead of flashing by in one frame.
    frames[0].delayCs += delayCs * (GIF_HOLD_FRAMES - 1);
    frames[frames.length - 1].delayCs += delayCs * (GIF_HOLD_FRAMES - 1);

    const gif = encodeGif({ width: outW, height: outH, frames });

    // The GIF is already fully computed from these exact morphs; now play
    // the real thing so the canvas ends up in the same place it always does.
    morphAll(fallbackShape);

    return gif;
  }

  return {
    resize,
    morphAll,
    recordMorphGif,

    getView: () => ({ ...view }),
    resetView: () => setView({ scale: 1, panX: 0, panY: 0 }),

    undo() {
      if (history.length === 0) return;
      strokes = history.pop();
      animations = [];
      baseDirty = true;
      render();
      emitChange();
    },

    clear() {
      if (strokes.length === 0 && animations.length === 0) return;
      pushHistory();
      strokes = [];
      animations = [];
      baseDirty = true;
      render();
      emitChange();
    },

    // Turn what is currently drawn into shape SVG, so a drawing made here can
    // become a shape without a round trip through a raster file. Coordinates
    // are shifted to the drawing's own bounds; scale is irrelevant downstream
    // because shapes are normalised on load.
    toShapeSvg() {
      const usable = strokes.filter((stroke) => stroke.points.length >= 2);
      if (usable.length === 0) return null;

      const bounds = getBounds(usable.flatMap((stroke) => stroke.points));
      const body = usable
        .map((stroke) => {
          const d = stroke.points
            .map((p, i) =>
              `${i === 0 ? 'M' : 'L'}${(p.x - bounds.minX).toFixed(2)} ${(p.y - bounds.minY).toFixed(2)}`)
            .join(' ');
          return `  <path d="${d}"/>`;
        })
        .join('\n');

      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${bounds.width.toFixed(2)} ${bounds.height.toFixed(2)}" fill="none" stroke="#000000" stroke-width="${(Math.max(bounds.width, bounds.height) / 160).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">
${body}
</svg>`;
    },

    // Flatten onto an opaque background for saving.
    toBlob() {
      const out = document.createElement('canvas');
      out.width = canvas.width;
      out.height = canvas.height;
      const octx = out.getContext('2d');
      octx.fillStyle = getBackground();
      octx.fillRect(0, 0, out.width, out.height);
      octx.drawImage(canvas, 0, 0);
      return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
    },

    destroy() {
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('wheel', onWheel);
      if (rafId) cancelAnimationFrame(rafId);
    },
  };
}
