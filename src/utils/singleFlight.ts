export function singleFlight(
  fn: () => Promise<void>,
  opts?: { rerunIfCalledDuring?: boolean },
): { run: () => Promise<void>; idle: () => Promise<void> } {
  let running: Promise<void> | null = null;
  let dirty = false;
  const loop = async () => {
    do {
      dirty = false;
      await fn();
    } while (dirty);
  };
  return {
    run: () => {
      if (running) {
        if (opts?.rerunIfCalledDuring) dirty = true;
        return running;
      }
      return (running = loop().finally(() => {
        running = null;
      }));
    },
    idle: () => running ?? Promise.resolve(),
  };
}
