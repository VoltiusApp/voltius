export function singleFlight(
  fn: () => Promise<void>,
  opts?: { rerunIfCalledDuring?: boolean },
): { run: () => Promise<void>; idle: () => Promise<void> } {
  let running: Promise<void> = Promise.resolve();
  let active = false;
  let dirty = false;
  const loop = async () => {
    try {
      do {
        dirty = false;
        await fn();
      } while (dirty);
    } finally {
      active = false;
    }
  };
  return {
    run: () => {
      if (active) {
        if (opts?.rerunIfCalledDuring) dirty = true;
        return running;
      }
      active = true;
      running = loop();
      return running;
    },
    idle: () => (active ? running : Promise.resolve()),
  };
}
