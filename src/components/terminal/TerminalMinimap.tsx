import { useEffect, useRef, useState } from "react";
import { getTerminalMinimapController, type TerminalMinimapController, type TerminalMinimapSnapshot } from "@/hooks/useTerminal";
import {
  computeKateMinimapLayout,
  planMinimapRefresh,
  pointerRatioForLayout,
  samplePlacement,
  type KateMinimapLayout,
  type TerminalMinimapSample,
} from "@/components/terminal/minimapMath";

const EMPTY: TerminalMinimapSnapshot = {
  bufferLength: 0,
  viewportY: 0,
  baseY: 0,
  rows: 0,
  cols: 0,
  version: 0,
  contentVersion: 0,
};

const ROW_HEIGHT = 2;
/** A 2px-per-row overview gains nothing from resampling a streaming terminal faster than this. */
const RESAMPLE_THROTTLE_MS = 200;

interface CanvasSize {
  width: number;
  height: number;
  dpr: number;
}

interface Props {
  sessionId: string;
  /** False while the terminal sits in a background tab: the minimap stops drawing until shown. */
  visible?: boolean;
}

function drawMinimap(
  canvas: HTMLCanvasElement,
  { width, height, dpr }: CanvasSize,
  layout: KateMinimapLayout,
  samples: TerminalMinimapSample[],
  cols: number,
) {
  // Assigning canvas.width reallocates and clears the backing store; only do it on a real size change.
  const pixelWidth = Math.floor(width * dpr);
  const pixelHeight = Math.floor(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const css = getComputedStyle(document.documentElement);
  const background = css.getPropertyValue("--t-bg-terminal").trim() || "#0b1220";
  const accent = css.getPropertyValue("--t-accent").trim() || "#7c3aed";
  ctx.fillStyle = background;
  ctx.globalAlpha = 0.28;
  ctx.fillRect(0, 0, width, height);

  const cellWidth = width / Math.max(1, cols);

  for (let y = 0; y < samples.length; y += 1) {
    const { density, cells } = samples[y];
    if (density <= 0.02) continue;
    const placement = samplePlacement({ sampleIndex: y, sampleCount: samples.length, layout, rowHeight: ROW_HEIGHT });
    const top = placement.top;
    if (top >= layout.contentHeight) break;
    for (const cell of cells ?? []) {
      const left = cell.x * cellWidth;
      const charWidth = Math.max(0.8, cell.width * cellWidth * 0.72);
      if (cell.bg) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = cell.bg;
        ctx.fillRect(left, top, Math.max(1, cell.width * cellWidth), placement.height);
      }
      ctx.globalAlpha = Math.min(0.95, 0.38 + density * 0.5);
      ctx.fillStyle = cell.fg;
      ctx.fillRect(left, top, charWidth, 1);
    }
  }

  if (layout.contentHeight + 2 < height) {
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = accent;
    ctx.fillRect(1, layout.contentHeight + 2, width - 2, 1);
  }

  ctx.globalAlpha = 0.22;
  ctx.fillStyle = accent;
  ctx.fillRect(0, layout.viewportTop, width, layout.viewportHeight);
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = accent;
  ctx.fillRect(0, layout.viewportTop, width, 1);
  ctx.fillRect(0, Math.min(height - 1, layout.viewportTop + layout.viewportHeight), width, 1);
  ctx.globalAlpha = 1;
}

export function TerminalMinimap({ sessionId, visible = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef(false);
  const [canvasVersion, setCanvasVersion] = useState(0);
  const [retryTick, setRetryTick] = useState(0);
  const sizeRef = useRef<(CanvasSize & { canvasVersion: number }) | null>(null);
  const samplesRef = useRef<{ key: string; samples: TerminalMinimapSample[]; at: number } | null>(null);
  const drawnViewRef = useRef<string | null>(null);
  const [controller, setController] = useState<TerminalMinimapController | null>(
    () => getTerminalMinimapController(sessionId),
  );
  const [snapshot, setSnapshot] = useState<TerminalMinimapSnapshot>(
    () => controller?.getSnapshot() ?? EMPTY,
  );

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let frame = 0;
    let cancelled = false;

    const tryAttach = () => {
      if (cancelled) return;
      const c = getTerminalMinimapController(sessionId);
      if (c) {
        setController(c);
        setSnapshot(c.getSnapshot());
        unsubscribe = c.subscribe(() => setSnapshot(c.getSnapshot()));
        return;
      }
      frame = requestAnimationFrame(tryAttach);
    };

    tryAttach();

    return () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
      unsubscribe?.();
    };
  }, [sessionId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bump = () => setCanvasVersion((v) => v + 1);
    const resizeObserver = new ResizeObserver(bump);
    // Observe the wrapper: the canvas carries a fixed px size from the last draw, so it
    // doesn't resize with the pane, and the draw only re-measures after a bump.
    resizeObserver.observe(canvas.parentElement ?? canvas);
    // Maximize/minimize toggles ancestor panes' display via a `hidden` class.
    // ResizeObserver isn't reliable across that display:none <-> visible
    // transition (WebKitGTK in particular can skip the notification), leaving
    // the canvas stuck at its last-measured size. IntersectionObserver does
    // report the re-appearance, so use it to force a re-measure.
    const intersectionObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) bump();
    });
    intersectionObserver.observe(canvas);
    return () => {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!controller || !visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Measure only after a resize or re-appearance: reading layout on every output frame forces a reflow.
    // Measure the wrapper, not the canvas: the draw writes canvas.style.width/height itself,
    // so measuring the canvas can read back and lock in a bad prior size.
    let size = sizeRef.current;
    if (!size || size.canvasVersion !== canvasVersion) {
      const rect = (canvas.parentElement ?? canvas).getBoundingClientRect();
      size = {
        canvasVersion,
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height)),
        dpr: window.devicePixelRatio || 1,
      };
      sizeRef.current = size;
    }
    const { width, height } = size;

    const layout = computeKateMinimapLayout({
      bufferLength: snapshot.bufferLength,
      rows: snapshot.rows,
      viewportY: snapshot.viewportY,
      canvasHeight: height,
      rowHeight: ROW_HEIGHT,
    });
    const sourceRows = layout.scaleY < 1 ? Math.ceil(height / ROW_HEIGHT) : snapshot.bufferLength;
    const key = `${snapshot.contentVersion}:${sourceRows}:${snapshot.cols}`;
    const viewKey = `${snapshot.viewportY}:${snapshot.bufferLength}:${snapshot.rows}:${width}x${height}`;
    const cached = samplesRef.current;
    const now = performance.now();
    const plan = planMinimapRefresh({
      cachedKey: cached?.key ?? null,
      key,
      sinceSampleMs: cached ? now - cached.at : 0,
      viewChanged: drawnViewRef.current !== viewKey,
      throttleMs: RESAMPLE_THROTTLE_MS,
    });

    const retry = plan.retryInMs === null ? null : setTimeout(() => setRetryTick((v) => v + 1), plan.retryInMs + 1);
    if (plan.draw) {
      let samples = cached?.samples ?? [];
      if (plan.resample) {
        samples = controller.sample(sourceRows);
        samplesRef.current = { key, samples, at: now };
      }
      drawMinimap(canvas, size, layout, samples, snapshot.cols);
      drawnViewRef.current = viewKey;
    }
    return () => {
      if (retry) clearTimeout(retry);
    };
  }, [controller, snapshot, canvasVersion, visible, retryTick]);

  if (!controller || snapshot.bufferLength <= 0) return null;

  function scrollFromPointer(clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas || !controller) return;
    const rect = canvas.getBoundingClientRect();
    const layout = computeKateMinimapLayout({
      bufferLength: snapshot.bufferLength,
      rows: snapshot.rows,
      viewportY: snapshot.viewportY,
      canvasHeight: rect.height,
      rowHeight: 2,
    });
    controller.scrollToRatio(pointerRatioForLayout(clientY, rect.top, layout));
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    scrollFromPointer(e.clientY);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!draggingRef.current) return;
    e.preventDefault();
    scrollFromPointer(e.clientY);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    draggingRef.current = false;
    controller?.focus();
  }

  function handleWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    if (!controller) return;
    e.preventDefault();
    const maxViewportY = Math.max(1, snapshot.bufferLength - snapshot.rows);
    const delta = Math.sign(e.deltaY) * Math.max(1, Math.round(snapshot.rows / 2));
    controller.scrollToRatio((snapshot.viewportY + delta) / maxViewportY);
  }

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full cursor-pointer select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
    />
  );
}
