export function singleFlight(fn: () => Promise<void>): { run: () => Promise<void>; idle: () => Promise<void> } {
  let running: Promise<void> | null = null;
  return {
    run: () =>
      (running ??= fn().finally(() => {
        running = null;
      })),
    idle: () => running ?? Promise.resolve(),
  };
}
