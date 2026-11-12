export interface TerminalMinimapSample {
  density: number;
  text: string;
  cells?: TerminalMinimapCell[];
}

export interface TerminalMinimapCell {
  x: number;
  width: number;
  fg: string;
  bg?: string;
}

export interface TerminalMinimapThumb {
  top: number;
  height: number;
}

export interface KateMinimapLayoutInput {
  bufferLength: number;
  rows: number;
  viewportY: number;
  canvasHeight: number;
  rowHeight: number;
}

export interface KateMinimapLayout {
  contentHeight: number;
  scaleY: number;
  viewportTop: number;
  viewportHeight: number;
}

export interface SamplePlacementInput {
  sampleIndex: number;
  sampleCount: number;
  layout: KateMinimapLayout;
  rowHeight: number;
}

export interface SamplePlacement {
  top: number;
  height: number;
}

export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.max(0, Math.min(1, ratio));
}

export function pointerRatio(clientY: number, top: number, height: number): number {
  return clampRatio((clientY - top) / Math.max(1, height));
}

export function pointerRatioForLayout(clientY: number, top: number, layout: Pick<KateMinimapLayout, "contentHeight">): number {
  return pointerRatio(clientY, top, Math.max(1, layout.contentHeight));
}

export function sampleLineDensities(lines: string[], sampleCount: number, cols: number): TerminalMinimapSample[] {
  const rows = Math.max(1, Math.floor(sampleCount));
  const length = lines.length;
  const columnCount = Math.max(1, cols);
  const samples: TerminalMinimapSample[] = [];

  if (length === 0) return [{ density: 0, text: "" }];

  if (length <= rows) {
    return lines.map((line) => ({
      density: Math.min(1, line.length / columnCount),
      text: line,
    }));
  }

  for (let y = 0; y < rows; y += 1) {
    const start = Math.floor((y / rows) * length);
    const end = Math.max(start + 1, Math.floor(((y + 1) / rows) * length));
    let total = 0;
    let count = 0;
    let preview = "";

    for (let lineIndex = start; lineIndex < end; lineIndex += 1) {
      const line = lines[lineIndex];
      if (line === undefined) continue;
      if (!preview && line.length > 0) preview = line;
      total += Math.min(1, line.length / columnCount);
      count += 1;
    }

    samples.push({ density: count === 0 ? 0 : total / count, text: preview });
  }

  return samples;
}

export function scrollDeltaForRatio(ratio: number, bufferLength: number, rows: number, viewportY: number): number {
  const maxViewportY = Math.max(0, bufferLength - rows);
  const targetViewportY = Math.round(clampRatio(ratio) * maxViewportY);
  return targetViewportY - viewportY;
}

export function viewportThumb(bufferLength: number, rows: number, viewportY: number, height: number): TerminalMinimapThumb {
  const viewportHeight = Math.max(1, height);
  if (bufferLength <= rows) return { top: 0, height: viewportHeight };

  const maxViewportY = Math.max(1, bufferLength - rows);
  const thumbHeight = Math.max(18, (rows / Math.max(bufferLength, rows)) * viewportHeight);
  const top = (viewportY / maxViewportY) * Math.max(0, viewportHeight - thumbHeight);
  return { top, height: thumbHeight };
}

export function computeKateMinimapLayout(input: KateMinimapLayoutInput): KateMinimapLayout {
  const canvasHeight = Math.max(1, Math.floor(input.canvasHeight));
  const rowHeight = Math.max(1, input.rowHeight);
  const bufferLength = Math.max(1, input.bufferLength);
  const rows = Math.max(1, input.rows);
  const unscaledHeight = bufferLength * rowHeight;
  const scaleY = Math.min(1, canvasHeight / unscaledHeight);
  const contentHeight = Math.min(canvasHeight, Math.round(unscaledHeight * scaleY));
  const viewportTop = Math.round(input.viewportY * rowHeight * scaleY);
  const viewportHeight = Math.min(contentHeight, Math.max(2, Math.round(rows * rowHeight * scaleY)));

  return { contentHeight, scaleY, viewportTop, viewportHeight };
}

export function samplePlacement(input: SamplePlacementInput): SamplePlacement {
  const rowHeight = Math.max(1, input.rowHeight);
  const sampleCount = Math.max(1, input.sampleCount);

  if (input.layout.scaleY >= 1) {
    return { top: input.sampleIndex * rowHeight, height: rowHeight };
  }

  const top = Math.floor((input.sampleIndex / sampleCount) * input.layout.contentHeight);
  const nextTop = Math.floor(((input.sampleIndex + 1) / sampleCount) * input.layout.contentHeight);
  return { top, height: Math.max(1, nextTop - top) };
}

export interface MinimapRefreshInput {
  /** Content key of the cached samples; null when nothing has been sampled yet. */
  cachedKey: string | null;
  /** Content key of the buffer now (changes on output, buffer switch or resize, not on scroll). */
  key: string;
  sinceSampleMs: number;
  /** The view changed (scroll position, canvas size), so the canvas needs a redraw even without new samples. */
  viewChanged: boolean;
  throttleMs: number;
}

export interface MinimapRefresh {
  draw: boolean;
  /** Re-read the buffer; otherwise draw from the cached samples. */
  resample: boolean;
  /** Come back after this delay for a trailing resample the throttle held back. */
  retryInMs: number | null;
}

/**
 * Sampling walks every sampled buffer line and cell, so a terminal that streams output
 * (a spinner, logs) would resample on every frame. Resample at most once per throttle
 * window with a trailing pass, and reuse samples for scroll/resize.
 */
export function planMinimapRefresh(input: MinimapRefreshInput): MinimapRefresh {
  if (input.cachedKey === null || (input.key !== input.cachedKey && input.sinceSampleMs >= input.throttleMs)) {
    return { draw: true, resample: true, retryInMs: null };
  }
  const stale = input.key !== input.cachedKey;
  return { draw: input.viewChanged, resample: false, retryInMs: stale ? input.throttleMs - input.sinceSampleMs : null };
}
