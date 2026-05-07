type SessionStatus = "connected" | "connecting" | "disconnected" | "error";

type SessionLike = {
  id: string;
  status: SessionStatus;
};

export function getSnippetInjectionTargetIds(existingSessionIds: string[], newSessionIds: string[]) {
  return [...existingSessionIds, ...newSessionIds];
}

export function waitForConnectedSessionIds(
  sessionIds: string[],
  getSessions: () => SessionLike[],
  subscribe: (listener: () => void) => () => void,
) {
  if (sessionIds.length === 0) return Promise.resolve([]);

  return new Promise<string[]>((resolve) => {
    const pending = new Set(sessionIds);
    const connected: string[] = [];
    let unsubscribe: (() => void) | undefined;

    const check = () => {
      for (const session of getSessions()) {
        if (!pending.has(session.id)) continue;
        if (session.status === "connected") {
          pending.delete(session.id);
          connected.push(session.id);
        } else if (session.status === "error" || session.status === "disconnected") {
          pending.delete(session.id);
        }
      }

      if (pending.size === 0) {
        unsubscribe?.();
        resolve(connected);
      }
    };

    unsubscribe = subscribe(check);
    check();
  });
}
