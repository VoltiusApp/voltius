import { useEffect, useRef, useState } from "react";
import { getTerminalMinimapController, type TerminalMinimapController, type TerminalMinimapSnapshot } from "@/hooks/useTerminal";
import { computeKateMinimapLayout, pointerRatioForLayout, samplePlacement } from "@/components/terminal/minimapMath";

const EMPTY: TerminalMinimapSnapshot = {
  bufferLength: 0,
  viewportY: 0,
  baseY: 0,
  rows: 0,
  cols: 0,
  version: 0,
};

interface Props {
  sessionId: string;
}

export function TerminalMinimap({ sessionId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef(false);
  const [canvasVersion, setCanvasVersion] = useState(0);
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
    const observer = new ResizeObserver(() => setCanvasVersion((v) => v + 1));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!controller) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

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

    const rowHeight = 2;
    const layout = computeKateMinimapLayout({
      bufferLength: snapshot.bufferLength,
      rows: snapshot.rows,
      viewportY: snapshot.viewportY,
      canvasHeight: height,
      rowHeight,
    });
    const sourceRows = layout.scaleY < 1 ? Math.ceil(height / rowHeight) : snapshot.bufferLength;
    const samples = controller.sample(sourceRows);
    const cellWidth = width / Math.max(1, snapshot.cols);

    for (let y = 0; y < samples.length; y += 1) {
      const { density, cells } = samples[y];
      if (density <= 0.02) continue;
      const placement = samplePlacement({ sampleIndex: y, sampleCount: samples.length, layout, rowHeight });
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
  }, [controller, snapshot, canvasVersion]);

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
