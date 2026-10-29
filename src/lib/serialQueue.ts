export type SerialQueue = <T>(step: () => Promise<T>) => Promise<T>;

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return (step) => {
    const run = tail.then(step);
    tail = run.catch(() => {});
    return run;
  };
}
