// Drawing surface: strokes, pinch/wheel zoom, and the morph animation.
// auto mode morphs each stroke on pen up, manual waits for the toolbar button.

import {
  buildMorph,
  denormalize,
  expandBox,
  getBounds,
  morphAt,
  normalize,
  smooth,
  splitStroke,
} from './morph.js';

const MAX_UNDO = 50;
const MIN_SCALE = 0.1;
const MAX_SCALE = 10;

const clampScale = (s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export function createDrawingCanvas(canvas, options = {}) {
  const {
    getStrokeColor = () => '#000000',
    getStrokeWidth = () => 3,
    getSmoothEnabled = () => true,
    getSmoothStrength = () => 0.5,
    getMinAspect = () => 0.1,
    getMode = () => 'manual',
    getShape = () => null,
    getBackground = () => '#ffffff',
    onChange = () => {},
    onViewChange = () => {},
  } = options;

  const ctx = canvas.getContext('2d');

  let strokes = [];
  let history = [];
  let animations = [];

  let activePointerId = null;
  let activePoints = [];
  let activeWidth = 3;
  let rafId = 0;

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

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    render();
  }

  function drawPolyline(points, color, lineWidth) {
    if (points.length === 1) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (points.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
  }

  function render() {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.setTransform(
      dpr * view.scale, 0, 0, dpr * view.scale,
      dpr * view.panX, dpr * view.panY,
    );
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const stroke of strokes) drawPolyline(stroke.points, stroke.color, stroke.width);
    for (const anim of animations) drawPolyline(anim.interp, anim.color, anim.width);
    if (activePoints.length > 0) {
      drawPolyline(applySmoothing(activePoints), getStrokeColor(), activeWidth);
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
        strokes.push({
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

  // Queue the animations that turn one stroke into `shape`.
  function morphStroke(stroke, shape) {
    const box = expandBox(getBounds(stroke.points), getMinAspect(), shape.aspectRatio);
    const pieces = splitStroke(normalize(stroke.points, box), shape.paths.length);

    pieces.forEach((piece, i) => {
      animations.push({
        morph: buildMorph({
          sourcePoints: denormalize(piece, box),
          targetPoints: denormalize(shape.paths[i], box),
        }),
        interp: [],
        start: performance.now(),
        color: stroke.color,
        width: stroke.width,
        done: false,
      });
    });
  }

  function morphAll(shape) {
    if (!shape || shape.paths.length === 0) return;
    const pending = strokes
      .map((stroke, index) => ({ stroke, index }))
      .filter(({ stroke }) => !stroke.morphed);
    if (pending.length === 0) return;

    pushHistory();
    // Backwards so splicing does not shift indices still to come.
    for (const { stroke, index } of pending.reverse()) {
      strokes.splice(index, 1);
      morphStroke(stroke, shape);
    }
    emitChange();
    schedule();
  }

  function cancelStroke() {
    if (activePointerId === null) return;
    activePointerId = null;
    activePoints = [];
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
    activePoints = [toWorld(toLocal(event))];
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
    activePoints.push(toWorld(toLocal(event)));
    schedule();
  }

  function finishStroke() {
    const points = applySmoothing(activePoints);
    activePoints = [];
    if (points.length === 0) return;

    pushHistory();
    const stroke = { points, color: getStrokeColor(), width: activeWidth, morphed: false };

    const shape = getShape();
    if (getMode() === 'auto' && shape && shape.paths.length > 0) {
      morphStroke(stroke, shape);
      schedule();
    } else {
      strokes.push(stroke);
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

  return {
    resize,
    morphAll,

    getView: () => ({ ...view }),
    resetView: () => setView({ scale: 1, panX: 0, panY: 0 }),

    undo() {
      if (history.length === 0) return;
      strokes = history.pop();
      animations = [];
      render();
      emitChange();
    },

    clear() {
      if (strokes.length === 0 && animations.length === 0) return;
      pushHistory();
      strokes = [];
      animations = [];
      render();
      emitChange();
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
