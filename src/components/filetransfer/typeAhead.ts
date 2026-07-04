// Type-ahead ("type to select") navigation for the file list, matching
// Windows Explorer semantics. Kept pure and UI-free so it can be unit-tested;
// the buffer/timeout bookkeeping lives in the FilePane keydown handler.

/** How long the accumulated search buffer survives between keystrokes. */
export const TYPE_AHEAD_RESET_MS = 800;

/**
 * Resolve the entry index a type-ahead keystroke should land on.
 *
 * @param names        entry names in display order (dirs-first, sorted, filtered)
 * @param buffer       accumulated keystrokes within the reset window
 * @param currentIndex currently focused index, or -1 if none
 * @param isRepeat     true when `buffer` is the same character typed repeatedly,
 *                     which switches from prefix-match to cycle-through-matches
 * @returns target index, or -1 when nothing matches
 */
export function resolveTypeAheadIndex(
  names: string[],
  buffer: string,
  currentIndex: number,
  isRepeat: boolean,
): number {
  const n = names.length;
  if (n === 0 || buffer.length === 0) return -1;

  const key = (isRepeat ? buffer[0] : buffer).toLowerCase();
  const matches = (i: number) => names[i].toLowerCase().startsWith(key);

  if (isRepeat) {
    // Cycle to the next matching entry after the current one, wrapping around.
    const start = currentIndex < 0 ? -1 : currentIndex;
    for (let step = 1; step <= n; step++) {
      const idx = ((start + step) % n + n) % n;
      if (matches(idx)) return idx;
    }
    return -1;
  }

  // Prefix mode: first match from the top.
  for (let i = 0; i < n; i++) if (matches(i)) return i;
  return -1;
}
