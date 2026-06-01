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
