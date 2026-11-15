type Listener = (revoked: ReadonlySet<string>) => void;

const listeners = new Set<Listener>();

/** Holders of live SSH/SFTP handles close the ones on hosts the user can no longer connect to. */
export function onConnectionsRevoked(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function emitConnectionsRevoked(revoked: ReadonlySet<string>): void {
  for (const listener of listeners) listener(revoked);
}
