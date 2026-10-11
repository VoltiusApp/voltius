export interface WakeableSleeps {
  /** Resolves true when woken early, false when the delay elapsed. */
  sleep(key: string, ms: number): Promise<boolean>;
  wake(key: string): boolean;
  sleeping(): string[];
}

export function createWakeableSleeps(): WakeableSleeps {
  const wakers = new Map<string, () => void>();
  return {
    sleep: (key, ms) =>
      new Promise((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const wake = () => {
          clearTimeout(timer);
          if (wakers.get(key) === wake) wakers.delete(key);
          resolve(true);
        };
        wakers.set(key, wake);
        timer = setTimeout(() => {
          if (wakers.get(key) === wake) wakers.delete(key);
          resolve(false);
        }, ms);
      }),
    wake: (key) => {
      const wake = wakers.get(key);
      wake?.();
      return !!wake;
    },
    sleeping: () => [...wakers.keys()],
  };
}
