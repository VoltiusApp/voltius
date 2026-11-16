import { SNACKBAR_MOTION } from "@/lib/motion";

/**
 * Pure pieces of the Android snackbar (MobileSnackbar.tsx): how long it stays, the
 * swipe-away verdict, and where it sits above the docked bottom chrome.
 * Offsets are px, velocities px/ms.
 */

/**
 * On-screen time for a toast that asked for `requested` ms: clamped to the M3 range
 * (4–10 s, at least 6 s with an action so it can be reached). 0 = sticky, stays until
 * swiped away or acted on.
 */
export function snackbarDuration(requested: number, hasAction: boolean): number {
  const { minMs, actionMinMs, maxMs } = SNACKBAR_MOTION;
  if (requested <= 0) return 0;
  return Math.min(maxMs, Math.max(hasAction ? actionMinMs : minMs, requested));
}

/** Release verdict for a horizontal drag of `dx`: dismiss past a fraction of the width or on a fling the same way. */
export function swipeAction(dx: number, velocity: number, width: number): "dismiss" | "settle" {
  const { swipeFraction, flingVelocity } = SNACKBAR_MOTION;
  if (dx !== 0 && Math.abs(velocity) >= flingVelocity && Math.sign(velocity) === Math.sign(dx)) return "dismiss";
  return width > 0 && Math.abs(dx) > width * swipeFraction ? "dismiss" : "settle";
}

/** Opacity while dragged `dx` px across a snackbar `width` px wide. */
export function swipeOpacity(dx: number, width: number): number {
  if (width <= 0) return 1;
  return Math.max(0.2, 1 - Math.abs(dx) / width);
}

/**
 * How far a floating element (the FAB) whose bottom edge rests at `bottom` must rise so
 * it clears a snackbar whose top edge is at `snackbarTop`, keeping `gap` px between them
 * (M3: the FAB moves up while a snackbar shows). 0 when it already clears it.
 */
export function avoidLift(bottom: number, snackbarTop: number, gap: number): number {
  return Math.max(0, Math.round(bottom - (snackbarTop - gap)));
}

type Box = { top: number; bottom: number; height: number };

/**
 * Space taken at the bottom of the viewport by docked chrome (navigation bar, extra-keys
 * row, transfer cards, draft bar…): from the top of the contiguous stack that rests on the
 * bottom edge down to that edge. null when nothing is docked there (then the safe-area inset applies).
 */
export function dockedInset(boxes: readonly Box[], viewportHeight: number): number | null {
  const shown = boxes.filter((b) => b.height > 0 && b.top < viewportHeight);
  const docked = shown.filter((b) => b.bottom >= viewportHeight - 1);
  if (docked.length === 0) return null;
  let top = Math.min(...docked.map((b) => b.top));
  let next: Box | undefined;
  while ((next = shown.find((b) => b.top < top && b.bottom >= top - 1))) top = next.top;
  return Math.max(0, Math.round(viewportHeight - top));
}
