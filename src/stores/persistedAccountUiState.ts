interface PersistedAccountStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Zustand stores whose persisted state belongs to one account. Their contents
 * are not, by themselves, restored from the server, so switching accounts has to
 * move them by hand: cleared for the incoming account, and stashed for the
 * outgoing one — dropping them outright would hide every host filed under a
 * user-created vault.
 *
 * A store belongs here when its contents name the account's own things — its
 * vaults, teams, hosts, teammates, sessions. Device preferences (UI scale,
 * theme, poll intervals, which plugins are exposed to MCP) do not: they follow
 * the machine, not the person signed in on it.
 */
export const ACCOUNT_SCOPED_STORAGE_KEYS = [
  // The vault list rides the sync blob now, so parking it only spares the sidebar
  // a pull's worth of emptiness — but `selectedVaultIds` has no other way home.
  "voltius-vaults",
  "voltius-teams",
  // Teammates this account invited, by handle.
  "voltius-recent-people",
  // Commands typed into this account's sessions, and their unsent input buffers.
  "voltius-command-history",
  // Open tabs, which name this account's connections and sessions.
  "voltius-workspace-snapshot",
  // Session manifests published by this account's other devices.
  "voltius-cross-device-sessions",
  // Recent snippet runs, keyed by connection.
  "voltius-snippet-recent",
  // Snippet variable values remembered per connection — often credentials.
  "voltius-host-command-vars",
];

/**
 * The local clock for the app-settings sync payload. Unlike the keys above it is
 * cleared without ever being restored: it exists only to win or lose a
 * last-write-wins merge, and one account's newer stamp would make the incoming
 * account's own settings look stale and never apply.
 */
export const ACCOUNT_SCOPED_RESET_KEYS = ["voltius-app-settings-ts"];

/**
 * Knowingly left out: `voltius-local-audit-logs`. It is account data, but it is
 * read strictly by vault id — ids the next account cannot hold — so it is
 * residue rather than a leak, and it runs to ~1 MB per vault, which is far too
 * much to park inside a keychain entry (the Linux keyring's default per-user
 * quota is 20 KB in total). It wants per-account namespacing instead.
 */

/**
 * Persisted state that deliberately stays put across a sign-out or a switch: it
 * describes the machine and how this person likes it set up, not the account.
 * Listed rather than assumed so the guard test can insist that every persisted
 * store is classified one way or the other.
 */
export const DEVICE_SCOPED_STORAGE_KEYS = [
  "voltius-ui",
  "voltius-theme",
  "voltius-locale",
  "voltius-security",
  "voltius-shortcuts",
  "voltius-sftp-settings",
  "voltius-terminal-settings",
  "voltius-toggle-settings",
  "voltius-connectivity-settings",
  "voltius-mcp-contributions",
  // Persists poll intervals only — the statuses it holds stay in memory.
  "voltius-host-ping",
  // Persists nothing (`partialize: () => ({})`); the key is an empty husk.
  "voltius-connection-presence",
];

export type PersistedAccountUiState = Record<string, string>;

export function clearPersistedAccountUiState(storage: PersistedAccountStorage | undefined = globalThis.localStorage): void {
  if (!storage) return;
  for (const key of [...ACCOUNT_SCOPED_STORAGE_KEYS, ...ACCOUNT_SCOPED_RESET_KEYS]) {
    storage.removeItem(key);
  }
}

export function snapshotPersistedAccountUiState(storage: PersistedAccountStorage | undefined = globalThis.localStorage): PersistedAccountUiState {
  const snapshot: PersistedAccountUiState = {};
  if (!storage) return snapshot;
  for (const key of ACCOUNT_SCOPED_STORAGE_KEYS) {
    const value = storage.getItem(key);
    if (value !== null) snapshot[key] = value;
  }
  return snapshot;
}

export function restorePersistedAccountUiState(
  snapshot: PersistedAccountUiState | undefined,
  storage: PersistedAccountStorage | undefined = globalThis.localStorage,
): void {
  if (!storage || !snapshot) return;
  for (const key of ACCOUNT_SCOPED_STORAGE_KEYS) {
    const value = snapshot[key];
    if (value !== undefined) storage.setItem(key, value);
  }
}
