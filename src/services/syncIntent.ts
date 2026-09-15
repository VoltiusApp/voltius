let running = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function isManualSyncRunning(): boolean {
  return running > 0;
}

export function onManualSyncChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Marks a sync the user asked for, so indicators can answer it at once instead of after a delay. */
export async function runManualSync(run: () => Promise<void>): Promise<void> {
  running++;
  emit();
  try {
    await run();
  } finally {
    running--;
    emit();
  }
}
