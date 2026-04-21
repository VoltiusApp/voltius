import { invoke } from "@tauri-apps/api/core";
import { lockVault, wipeLocalConfig } from "./vault";

export interface SavedAccount {
  account_id: string;
  display: string; // email or "Local Account"
  email: string | null;
  server_url: string | null;
  mode: string;
  master_password: string;
  jwt: string | null;
  refresh_token: string | null;
}

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

export async function getSavedAccounts(): Promise<SavedAccount[]> {
  try {
    const raw = await keychainGet(SAVED_ACCOUNTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedAccount[];
  } catch {
    return [];
  }
}

async function setSavedAccounts(accounts: SavedAccount[]): Promise<void> {
  await keychainSet(SAVED_ACCOUNTS_KEY, JSON.stringify(accounts));
}

/** Snapshot current active account and upsert it into the saved list. */
export async function saveCurrentAccount(): Promise<void> {
  const [account_id, mode, email, server_url, master_password, jwt, refresh_token] =
    await Promise.all([
      keychainGet("account_id"),
      keychainGet("mode"),
      keychainGet("email"),
      keychainGet("server_url"),
      keychainGet("master_password"),
      keychainGet("jwt"),
      keychainGet("refresh_token"),
    ]);

  if (!account_id || !mode || !master_password) return;

  const display = email ?? "Local Account";
  const entry: SavedAccount = {
    account_id,
    display,
    email: email ?? null,
    server_url: server_url ?? null,
    mode,
    master_password,
    jwt: jwt ?? null,
    refresh_token: refresh_token ?? null,
  };

  const existing = await getSavedAccounts();
  const idx = existing.findIndex((a) => a.account_id === account_id);
  if (idx >= 0) {
    existing[idx] = entry;
  } else {
    existing.push(entry);
  }
  await setSavedAccounts(existing);
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

  await keychainSet("account_id", account.account_id);
  await keychainSet("mode", account.mode);
  await keychainSet("master_password", account.master_password);

  if (account.email) {
    await keychainSet("email", account.email);
  } else {
    await keychainDelete("email");
  }
  if (account.server_url) {
    await keychainSet("server_url", account.server_url);
  } else {
    await keychainDelete("server_url");
  }
  if (account.jwt) {
    await keychainSet("jwt", account.jwt);
  } else {
    await keychainDelete("jwt");
  }
  if (account.refresh_token) {
    await keychainSet("refresh_token", account.refresh_token);
  } else {
    await keychainDelete("refresh_token");
  }

  // Tell SplashScreen to use replace-mode sync after reload so the old
  // account's local state is never merged into the new account's cloud data.
  sessionStorage.setItem("voltius.replace-sync-on-login", "1");
  // Clear persisted team roles so the new account doesn't briefly see the old account's teams.
  localStorage.removeItem("voltius-teams");
  window.location.reload();
}
