export const DEFAULT_SNAPSHOT_TIMEOUT_MS = 8000;

export interface StreamOneShotPorts {
  start(sessionId: string, isRemote: boolean): Promise<string>;
  stop(streamId: string): Promise<void>;
  onSnapshot<T>(streamId: string, cb: (snapshot: T) => void): Promise<() => void>;
}

/**
 * Start → first snapshot → stop. The stream APIs have no request/response form,
 * and MCP needs one answer. `stop` runs in the outer `finally`: a timed-out call
 * that left the stream running would keep polling the host with nobody listening.
 * `onSnapshot` also registers a frontend event listener that `stop` does not
 * remove, so its unsubscribe is awaited and released in its own `finally`,
 * covering the resolve, timeout and onSnapshot-rejects paths alike.
 */
export async function firstSnapshot<T>(
  ports: StreamOneShotPorts,
  sessionId: string,
  isRemote: boolean,
  timeoutMs: number,
): Promise<T> {
  const streamId = await ports.start(sessionId, isRemote);
  try {
    return await waitForSnapshot<T>(ports, streamId, timeoutMs);
  } finally {
    await ports.stop(streamId);
  }
}

async function waitForSnapshot<T>(
  ports: StreamOneShotPorts,
  streamId: string,
  timeoutMs: number,
): Promise<T> {
  let resolveSnapshot: (snapshot: T) => void;
  const snapshotArrived = new Promise<T>((resolve) => {
    resolveSnapshot = resolve;
  });
  const unsubscribe = await ports.onSnapshot<T>(streamId, (snapshot) => resolveSnapshot(snapshot));
  try {
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no snapshot arrived within ${timeoutMs}ms`)),
        timeoutMs,
      );
      void snapshotArrived.then((snapshot) => {
        clearTimeout(timer);
        resolve(snapshot);
      });
    });
  } finally {
    unsubscribe();
  }
}
