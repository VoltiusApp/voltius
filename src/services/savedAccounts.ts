import { invoke } from "@tauri-apps/api/core";
import {
  clearPersistedAccountUiState,
  dropAccountUiState,
  parkAccountUiState,
  restoreAccountUiState,
  writeParkedUiState,
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
};

/** Pre-0.29 shape: every account, and its UI state, inside one keychain value. */
type LegacySavedAccount = SavedAccount & { ui_state?: PersistedAccountUiState };

async function keychainGet(key: string): Promise<string | null> {
  return invoke<string | null>("keychain_get", { key });
}
async function keychainSet(key: string, value: string): Promise<void> {
  return invoke("keychain_set", { key, value });
}
async function keychainDelete(key: string): Promise<void> {
  return invoke("keychain_delete", { key });
}

/**
 * The switcher is one keychain entry per account plus an index of their ids,
 * because keychains cap the size of a single value and the app has no way to
 * see that coming: Windows Credential Manager refuses a blob over 2560 bytes
 * once UTF-16 encoded, which two accounts' tokens exceed on their own. Held in
 * one value, saving the second account failed, the failure was swallowed, and
 * the account silently never joined the switcher.
 */
const INDEX_KEY = "voltius.saved_accounts";
const ENTRY_PREFIX = "voltius.saved_account.";

const entryKey = (account_id: string) => `${ENTRY_PREFIX}${account_id}`;

/**
 * Only cloud accounts are switchable. Switching wipes the config dir and
 * secrets.enc, which for a local account is the only copy of its data — it could
 * never be switched back into, and offering it would destroy the vault instead.
 */
function isSwitchable(account: SavedAccount): boolean {
  return account.mode === "server";
}

function parseEntry(raw: string | null): SavedAccount | null {
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw) as SavedAccount;
    return entry?.account_id && isSwitchable(entry) ? entry : null;
  } catch {
    return null;
  }
}

/**
 * Read the switcher.
 *
 * `ok` is false only when the keychain itself failed, and it is what keeps a
 * bad read from becoming a bad write: an unreadable list must never be treated
 * as an empty one, or the next save persists that emptiness over real accounts.
 */
async function loadSavedAccounts(): Promise<{ ok: boolean; accounts: SavedAccount[] }> {
  let raw: string | null;
  try {
    raw = await keychainGet(INDEX_KEY);
  } catch {
    return { ok: false, accounts: [] };
  }
  if (!raw) return { ok: true, accounts: [] };

  let index: unknown;
  try {
    index = JSON.parse(raw);
  } catch {
    return { ok: true, accounts: [] }; // corrupt beyond repair — safe to replace
  }
  if (!Array.isArray(index)) return { ok: true, accounts: [] };

  if (index.some((entry) => entry !== null && typeof entry === "object")) {
    return migrateLegacyList(index as LegacySavedAccount[]);
  }

  const accounts: SavedAccount[] = [];
  for (const id of index) {
    if (typeof id !== "string") continue;
    let entry: string | null;
    try {
      entry = await keychainGet(entryKey(id));
    } catch {
      return { ok: false, accounts: [] };
    }
    const parsed = parseEntry(entry);
    if (parsed) accounts.push(parsed);
  }
  return { ok: true, accounts };
}

/**
 * Split a pre-0.29 single-value list into one entry per account, moving any
 * parked UI state out of the keychain. Leaves the old value untouched if a
 * write fails, so a keychain that refuses the migration today can still serve
 * the accounts it already holds and retry on the next read.
 */
async function migrateLegacyList(
  legacy: LegacySavedAccount[],
): Promise<{ ok: boolean; accounts: SavedAccount[] }> {
  const accounts: SavedAccount[] = [];
  for (const { ui_state, ...entry } of legacy) {
    if (!entry?.account_id || !isSwitchable(entry)) continue;
    if (ui_state) writeParkedUiState(entry.account_id, ui_state);
    accounts.push(entry);
  }
  try {
    for (const entry of accounts) {
      await keychainSet(entryKey(entry.account_id), JSON.stringify(entry));
    }
    await keychainSet(INDEX_KEY, JSON.stringify(accounts.map((a) => a.account_id)));
  } catch {
    return { ok: false, accounts };
  }
  return { ok: true, accounts };
}

export async function getSavedAccounts(): Promise<SavedAccount[]> {
  return (await loadSavedAccounts()).accounts;
}

/**
 * Snapshot the active account and upsert it into the switcher.
 *
 * Rejects when the keychain does — the caller decides whether that is worth
 * telling the user about. Swallowing it here is what hid the size cap.
 */
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

/** Merge an entry into the switcher, keeping fields the caller did not supply. */
async function upsertSavedAccount(entry: SavedAccount): Promise<void> {
  const { ok, accounts } = await loadSavedAccounts();
  if (!ok) throw new Error("Saved accounts could not be read");

  const existing = accounts.find((a) => a.account_id === entry.account_id);
  await keychainSet(entryKey(entry.account_id), JSON.stringify({ ...existing, ...entry }));
  if (existing) return;
  await keychainSet(
    INDEX_KEY,
    JSON.stringify([...accounts.map((a) => a.account_id), entry.account_id]),
  );
}

/**
 * Park the outgoing account's persisted UI state, so that switching back
 * restores the vaults and teams it was last showing.
 *
 * It stays in localStorage, where it already lives while the account is signed
 * in: it runs to kilobytes — workspace snapshot, command history, snippet
 * variables — which is far past what a keychain value holds.
 */
async function stashUiStateForCurrentAccount(): Promise<void> {
  const account_id = await keychainGet("account_id");
  if (!account_id) return;
  const { accounts } = await loadSavedAccounts();
  if (!accounts.some((a) => a.account_id === account_id)) return;
  parkAccountUiState(account_id);
}

export async function removeSavedAccount(account_id: string): Promise<void> {
  const { ok, accounts } = await loadSavedAccounts();
  // Index first: a failed entry delete then leaves a dangling id, which reads
  // skip, rather than an account the switcher still offers.
  if (ok) {
    await keychainSet(
      INDEX_KEY,
      JSON.stringify(accounts.map((a) => a.account_id).filter((id) => id !== account_id)),
    );
  }
  await keychainDelete(entryKey(account_id)).catch(() => {});
  dropAccountUiState(account_id);
}

/**
 * End the current account's session without touching the saved list: flush its
 * work to the server, park its UI state, and leave the machine with no active
 * account. Shared by the switch and by "add another account", which differ only
 * in what they put back afterwards.
 */
async function tearDownSession(): Promise<void> {
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

  // Tell SplashScreen to use replace-mode sync after reload so the old
  // account's local state is never merged into the next account's cloud data.
  sessionStorage.setItem("voltius.replace-sync-on-login", "1");
  clearPersistedAccountUiState();
}

/**
 * Switch to a saved account: end the current session, write the target's
 * keychain entries and UI state, then reload so autoLogin picks it up.
 */
export async function switchToAccount(account: SavedAccount): Promise<void> {
  await tearDownSession();
  for (const key of SESSION_KEYS) {
    const value = account[key];
    if (value) await keychainSet(key, value);
  }
  restoreAccountUiState(account.account_id);
  window.location.reload();
}

/**
 * Leave the current account signed in to the switcher and land on the auth
 * screen, so a second account can be added.
 *
 * Sign-out cannot do this job: it forgets the account on the way out, by
 * design. Without this the switcher could never hold more than one account,
 * because signing out is otherwise the only way to reach the auth screen.
 */
export async function signOutToAddAccount(): Promise<void> {
  await saveCurrentAccount();
  await tearDownSession();
  window.location.reload();
}
