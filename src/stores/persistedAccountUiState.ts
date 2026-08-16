interface PersistedAccountStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Zustand stores whose persisted state belongs to one account. They are never
 * synced to the server, so switching accounts has to move them by hand: cleared
 * for the incoming account, and stashed for the outgoing one — dropping them
 * outright would hide every host filed under a user-created vault.
 */
const ACCOUNT_SCOPED_STORAGE_KEYS = ["voltius-vaults", "voltius-teams"];

export type PersistedAccountUiState = Record<string, string>;

export function clearPersistedAccountUiState(storage: PersistedAccountStorage | undefined = globalThis.localStorage): void {
  if (!storage) return;
  for (const key of ACCOUNT_SCOPED_STORAGE_KEYS) {
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
