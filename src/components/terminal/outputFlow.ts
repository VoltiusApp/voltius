export interface OutputFlow {
  written(size: number): void;
  processed(size: number): void;
}

// xterm.js drops writes once 50 MB are pending, so the transport is paused well before that.
export function createOutputFlow(
  setPaused: (paused: boolean) => void,
  high = 2_000_000,
  low = 500_000,
): OutputFlow {
  let pending = 0;
  let paused = false;
  return {
    written(size) {
      pending += size;
      if (!paused && pending > high) {
        paused = true;
        setPaused(true);
      }
    },
    processed(size) {
      pending -= size;
      if (paused && pending < low) {
        paused = false;
        setPaused(false);
      }
    },
  };
}
