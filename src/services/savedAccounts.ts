import { invoke } from "@tauri-apps/api/core";
import {
  clearPersistedAccountUiState,
  restorePersistedAccountUiState,
  snapshotPersistedAccountUiState,
  type PersistedAccountUiState,
} from "@/stores/persistedAccountUiState";
import { ACCOUNT_CACHE_KEYS } from "./accountCacheKeys";
import { lockVault, wipeLocalConfig } from "./vault";

/**
 * The keychain entries that make up an account session. A SavedAccount is a
 * snapshot of exactly these, so the reader (saveCurrentAccount) and the writer
 * (switchToAccount) stay in step.
 */
export const SESSION_KEYS = [
  "account_id",
  "mode",
  "master_password",
  "email",
  "server_url",
  "jwt",
  "refresh_token",
] as const;
type SessionKey = (typeof SESSION_KEYS)[number];

export type SavedAccount = Record<SessionKey, string | null> & {
  account_id: string;
  mode: string;
  master_password: string;
  /**
   * The account's persisted UI state, captured when it was last switched away
   * from. The vault list lives only in localStorage, so without this a switch
   * back would leave every host filed under a user-created vault invisible.
   */
  ui_state?: PersistedAccountUiState;
};

async function keychainGet(key: string): Promise<string | null> {
  return invoke<string | null>("keychain_get", { key });
}
async function keychainSet(key: string, value: string): Promise<void> {
  return invoke("keychain_set", { key, value });
}
async function keychainDelete(key: string): Promise<void> {
  return invoke("keychain_delete", { key });
}

const SAVED_ACCOUNTS_KEY = "voltius.saved_accounts";

/**
 * Only cloud accounts are switchable. Switching wipes the config dir and
 * secrets.enc, which for a local account is the only copy of its data — it could
 * never be switched back into, and offering it would destroy the vault instead.
 */
function isSwitchable(account: SavedAccount): boolean {
  return account.mode === "server";
}

export async function getSavedAccounts(): Promise<SavedAccount[]> {
  try {
    const raw = await keychainGet(SAVED_ACCOUNTS_KEY);
    if (!raw) return [];
    // Filter on read too: installs from before the cloud-only rule may hold a
    // local entry, and it must not surface as a switch target.
    return (JSON.parse(raw) as SavedAccount[]).filter(isSwitchable);
  } catch {
    return [];
  }
}

async function setSavedAccounts(accounts: SavedAccount[]): Promise<void> {
  await keychainSet(SAVED_ACCOUNTS_KEY, JSON.stringify(accounts));
}

/** Snapshot current active account and upsert it into the saved list. */
export async function saveCurrentAccount(): Promise<void> {
  const values = await Promise.all(SESSION_KEYS.map((key) => keychainGet(key)));
  const session = Object.fromEntries(
    SESSION_KEYS.map((key, i) => [key, values[i]]),
  ) as Record<SessionKey, string | null>;

  const { account_id, mode, master_password } = session;
  if (!account_id || !mode || !master_password) return;

  const entry: SavedAccount = { ...session, account_id, mode, master_password };
  if (!isSwitchable(entry)) return;

  await upsertSavedAccount(entry);
}

/** Merge an entry into the saved list, keeping fields the caller did not supply. */
async function upsertSavedAccount(entry: SavedAccount): Promise<void> {
  const existing = await getSavedAccounts();
  const idx = existing.findIndex((a) => a.account_id === entry.account_id);
  if (idx >= 0) {
    existing[idx] = { ...existing[idx], ...entry };
  } else {
    existing.push(entry);
  }
  await setSavedAccounts(existing);
}

/**
 * Park the outgoing account's persisted UI state on its saved entry, so that
 * switching back restores the vaults and teams it was last showing.
 */
async function stashUiStateForCurrentAccount(): Promise<void> {
  const account_id = await keychainGet("account_id");
  if (!account_id) return;
  const current = (await getSavedAccounts()).find((a) => a.account_id === account_id);
  if (!current) return;
  await upsertSavedAccount({ ...current, ui_state: snapshotPersistedAccountUiState() });
}

export async function removeSavedAccount(account_id: string): Promise<void> {
  const existing = await getSavedAccounts();
  await setSavedAccounts(existing.filter((a) => a.account_id !== account_id));
}

/**
 * Switch to a saved account: lock vault, overwrite active keychain entries,
 * then reload the window so autoLogin picks up the new account.
 */
export async function switchToAccount(account: SavedAccount): Promise<void> {
  await stashUiStateForCurrentAccount().catch(() => {});
  const { stopRealtimeSync, push } = await import("@/services/sync");
  // Flush any pending local changes before wiping — the debounced sync may not
  // have fired yet, so we push explicitly to ensure the current account's latest
  // state is on the server before we tear down the session.
  await push().catch(() => {});
  stopRealtimeSync();
  await lockVault();
  // Wipe secrets.enc and all entity files. The old secrets.enc is encrypted with the
  // current account's key; the new account's key cannot open it, causing
  // "Decryption failed — wrong key or corrupted file" in secrets_unlock.
  // config_wipe removes both secrets.enc and the config dir; syncOnLogin
  // will repopulate entity files from the cloud pull after reload.
  await wipeLocalConfig().catch(() => {});

  // Clear every account-scoped keychain entry before writing the target's — the
  // same list sign-out clears. A key left behind is served to the incoming
  // account: `handle` did exactly that, showing the previous user's @handle in
  // the account menu, and `wrapped_user_secrets` is wrapped by the old account's
  // kek and must never be unwrapped with the new account's key.
  for (const key of ACCOUNT_CACHE_KEYS) {
    await keychainDelete(key).catch(() => {});
  }
  for (const key of SESSION_KEYS) {
    const value = account[key];
    if (value) await keychainSet(key, value);
  }

  // Tell SplashScreen to use replace-mode sync after reload so the old
  // account's local state is never merged into the new account's cloud data.
  sessionStorage.setItem("voltius.replace-sync-on-login", "1");
  // Swap the persisted UI state (teams, vaults) for the incoming account's, so
  // the new account never sees the old one's — and gets its own back.
  clearPersistedAccountUiState();
  restorePersistedAccountUiState(account.ui_state);
  window.location.reload();
}
