interface PersistedAccountStorage {
  removeItem(key: string): void;
}

const ACCOUNT_SCOPED_STORAGE_KEYS = ["voltius-vaults", "voltius-teams"];

export function clearPersistedAccountUiState(storage: PersistedAccountStorage | undefined = globalThis.localStorage): void {
  if (!storage) return;
  for (const key of ACCOUNT_SCOPED_STORAGE_KEYS) {
    storage.removeItem(key);
  }
}
