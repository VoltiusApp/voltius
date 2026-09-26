// Settings pulled from another device's blob are applied through the same store
// setters a user edit uses. Left unguarded, that apply looks like a local edit:
// the store stamps `now` and schedules a push, the other device pulls the newer
// timestamp, applies it, stamps `now`… — two online devices then push a blob
// every debounce interval forever. While a remote bundle is being applied,
// stores stamp the REMOTE section's timestamp and skip the push, so both sides
// converge on one value.

let depth = 0;
let timestamp: string | null = null;

/** The remote section's timestamp while a remote apply is in flight, else null. */
export function remoteApplyTimestamp(): string | null {
  return depth > 0 ? timestamp : null;
}

/** Timestamp for a settings write: the remote one during a remote apply, else now. */
export function settingsStamp(): string {
  return remoteApplyTimestamp() ?? new Date().toISOString();
}

/** Debounced cloud push for a local settings edit. No-op during a remote apply. */
export function pushSettingsChange(): void {
  if (depth > 0) return;
  import("@/services/sync").then((m) => m.scheduleSync()).catch(() => {});
}

/**
 * Run `fn` as a remote apply. The guard covers only its synchronous part and
 * is released before any promise `fn` returns settles: the flag is module
 * global, so holding it across an await would stamp a user edit made in that
 * window with the remote timestamp and swallow its push. An async `fn` must
 * therefore make every store write before its first await.
 */
export function withRemoteApply<T>(at: string, fn: () => T): T {
  depth++;
  timestamp = at;
  try {
    return fn();
  } finally {
    depth--;
    if (depth === 0) timestamp = null;
  }
}
