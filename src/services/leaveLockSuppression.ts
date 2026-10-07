let leaveLockSuppressions = 0;
const MAX_SUPPRESSION_MS = 10 * 60_000;

export function isLeaveLockSuppressed(): boolean {
  return leaveLockSuppressions > 0;
}

/** For work that sends the user to a system screen of our own making (auth prompt, file picker). */
export async function withLeaveLockSuppressed<T>(work: () => Promise<T>): Promise<T> {
  leaveLockSuppressions++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    leaveLockSuppressions--;
  };
  // A system screen that never reports back must not switch the leave-lock off for good.
  const timer = setTimeout(release, MAX_SUPPRESSION_MS);
  try {
    return await work();
  } finally {
    clearTimeout(timer);
    release();
  }
}
