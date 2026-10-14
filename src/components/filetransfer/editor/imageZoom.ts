export type Zoom = "fit" | number;

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
const STEP = 1.25;

export interface Size {
  w: number;
  h: number;
}

/** The scale that fits `image` inside `box`, never above 1 so small images stay sharp. */
export function fitScale(image: Size, box: Size): number {
  if (!image.w || !image.h || !box.w || !box.h) return 1;
  return Math.min(1, box.w / image.w, box.h / image.h);
}

export function effectiveScale(zoom: Zoom, image: Size, box: Size): number {
  return zoom === "fit" ? fitScale(image, box) : zoom;
}

export function stepZoom(scale: number, dir: 1 | -1): number {
  const next = dir > 0 ? scale * STEP : scale / STEP;
  return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)) * 100) / 100;
}

/** Where to scroll after a zoom so the point under the cursor stays put. */
export function anchoredScroll(scroll: number, pointer: number, from: number, to: number): number {
  return Math.max(0, ((scroll + pointer) * to) / from - pointer);
}
