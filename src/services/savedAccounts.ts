import { invoke } from "@/lib/invoke";
import {
  dropAccountUiState,
  parkAccountUiState,
  restoreAccountUiState,
  writeParkedUiState,
  type PersistedAccountUiState,
} from "@/stores/persistedAccountUiState";
import { instanceLabel } from "@/utils/serverInstance";
import { ACCOUNT_CACHE_KEYS } from "./accountCacheKeys";
import { clearAccountUiState, dropAccountProfile, lockVault, readLocalSecrets, swapAccountProfile } from "./vault";
import { deviceScopedSecretKeys } from "./deviceScopedSecrets";
import { clearSecret, exportSecret, importSecret } from "./vaultSecret";

/**
 * The keychain entries that make up an account session. A SavedAccount is a
 * snapshot of exactly these plus the master password in its stored form, so the
 * reader (saveCurrentAccount) and the writer (switchToAccount) stay in step.
 */
export const SESSION_KEYS = [
  "account_id",
  "mode",
  "email",
  "server_url",
  "jwt",
  "refresh_token",
  // Per-account like the rest: without it a switch restored everything except
  // the value that recovers the dek, and team vault keys stopped unwrapping (#228).
  "wrapped_user_secrets",
] as const;
type SessionKey = (typeof SESSION_KEYS)[number];

export type SavedAccount = Record<SessionKey, string | null> & {
  account_id: string;
  mode: string;
  master_password?: string | null;
  master_password_sealed?: string | null;
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

// Only cloud accounts are switchable: an account outside the switcher is
// discarded on the way out, not parked, so it could never be switched back into.
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

// For callers that act on the answer: an unreadable list must not pass for an empty one.
async function requireSavedAccounts(): Promise<SavedAccount[]> {
  const { ok, accounts } = await loadSavedAccounts();
  if (!ok) throw new Error("Saved accounts could not be read");
  return accounts;
}

/** The session the switcher must not offer to switch into: the current one. */
export type ActiveAccount = {
  account_id: string | null;
  email: string | null;
  server_url: string | null;
};

// An email is unique per instance, so it identifies the account when the id
// cannot: a failed keychain read arrives here as a null account_id.
function isActiveAccount(account: SavedAccount, active: ActiveAccount): boolean {
  if (active.account_id && account.account_id === active.account_id) return true;
  return (
    !!active.email &&
    account.email === active.email &&
    instanceLabel(account.server_url) === instanceLabel(active.server_url)
  );
}

// An entry that is this account under an id the session no longer uses is deleted,
// not hidden: switching into it lands on stale credentials.
export async function getSwitchTargets(active: ActiveAccount): Promise<SavedAccount[]> {
  const accounts = await getSavedAccounts();
  const targets: SavedAccount[] = [];
  for (const account of accounts) {
    if (!isActiveAccount(account, active)) {
      targets.push(account);
    } else if (active.account_id && account.account_id !== active.account_id) {
      await removeSavedAccount(account.account_id).catch(() => {});
    }
  }
  return targets;
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

  const secret = await exportSecret();
  const { account_id, mode } = session;
  if (!account_id || !mode || !secret) return;

  const entry: SavedAccount = {
    ...session,
    account_id,
    mode,
    ...(secret.kind === "plain" ? { master_password: secret.value } : { master_password_sealed: secret.value }),
  };
  if (!isSwitchable(entry)) return;

  await upsertSavedAccount(entry);
}

/**
 * Merge an entry into the switcher, keeping fields the caller did not supply.
 * Null counts as not supplied: blanking `wrapped_user_secrets` from a snapshot
 * of a half-torn-down session costs the account its dek on the next switch.
 */
async function upsertSavedAccount(entry: SavedAccount): Promise<void> {
  const accounts = await requireSavedAccounts();

  const supplied = Object.fromEntries(
    Object.entries(entry).filter(([, value]) => value !== null && value !== undefined),
  );
  const existing = accounts.find((a) => a.account_id === entry.account_id);
  const merged: SavedAccount = { ...existing, ...supplied } as SavedAccount;
  // The secret is held in one form at a time; the other form from an older snapshot must not outlive it.
  if (entry.master_password) delete merged.master_password_sealed;
  if (entry.master_password_sealed) delete merged.master_password;
  await keychainSet(entryKey(entry.account_id), JSON.stringify(merged));
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
 * Resolves to the id it parked under, or null for an account the switcher does not hold.
 */
async function stashUiStateForCurrentAccount(): Promise<string | null> {
  const account_id = await keychainGet("account_id");
  if (!account_id) return null;
  // "Not saved" means the outgoing data is discarded, so this has to know.
  const accounts = await requireSavedAccounts();
  if (!accounts.some((a) => a.account_id === account_id)) return null;
  parkAccountUiState(account_id);
  return account_id;
}

/** Other accounts' passwords stay readable in plain form unless dropped; switching to one then asks for it. */
export async function forgetOtherPlainPasswords(): Promise<void> {
  const [{ ok, accounts }, current] = await Promise.all([loadSavedAccounts(), keychainGet("account_id")]);
  if (!ok) return;
  for (const { master_password, ...rest } of accounts) {
    if (rest.account_id === current || !master_password) continue;
    await keychainSet(entryKey(rest.account_id), JSON.stringify(rest));
  }
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
  await dropAccountProfile(account_id).catch(() => {});
}

const FINAL_PUSH_TIMEOUT_MS = 5000;

/**
 * Give the outgoing account one chance to upload unsynced changes. Never an
 * error: its data is parked with those changes and they go up when it is next active.
 */
async function flushPendingChanges(): Promise<void> {
  const { push, isSyncPaused } = await import("@/services/sync");
  if (isSyncPaused()) return;
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, FINAL_PUSH_TIMEOUT_MS);
  });
  await Promise.race([push({ signal: abort.signal }).catch(() => {}), timeout]);
  clearTimeout(timer);
  abort.abort();
}

/**
 * Move the current account's data out and `restore`'s in. Rejects with the session
 * intact; once it resolves the data on disk is no longer this session's.
 */
async function swapOutSession(restore: string): Promise<boolean> {
  const parkAs = await stashUiStateForCurrentAccount();
  const { stopRealtimeSync, haltSync, resumeSync } = await import("@/services/sync");
  const { stopLanSync, startSessionSync } = await import("@/services/lanSync");
  stopRealtimeSync();
  await stopLanSync();
  await flushPendingChanges();
  haltSync();
  // Read with the outgoing key, before the swap locks the store.
  const carry = await readLocalSecrets(deviceScopedSecretKeys());
  try {
    return await swapAccountProfile({ parkAs, restore, carry });
  } catch (e) {
    resumeSync();
    startSessionSync();
    throw e;
  }
}

async function installSession(account: SavedAccount, restored: boolean): Promise<void> {
  await lockVault();

  // Clear every account-scoped keychain entry before writing the target's — the
  // same list sign-out clears. A key left behind is served to the incoming
  // account: `handle` did exactly that, showing the previous user's @handle in
  // the account menu, and `wrapped_user_secrets` is wrapped by the old account's
  // kek and must never be unwrapped with the new account's key.
  for (const key of ACCOUNT_CACHE_KEYS) {
    await keychainDelete(key).catch(() => {});
  }
  await clearSecret().catch(() => {});

  // An account with nothing parked here starts empty and must be rebuilt from the server alone.
  if (!restored) sessionStorage.setItem("voltius.replace-sync-on-login", "1");
  await clearAccountUiState();

  for (const key of SESSION_KEYS) {
    const value = account[key];
    if (value) await keychainSet(key, value);
  }
  if (account.master_password_sealed) await importSecret({ kind: "sealed", value: account.master_password_sealed });
  else if (account.master_password) await importSecret({ kind: "plain", value: account.master_password });
  restoreAccountUiState(account.account_id);
}

async function runSwitch(account: SavedAccount): Promise<void> {
  const restored = await swapOutSession(account.account_id);
  try {
    await installSession(account, restored);
  } finally {
    // The running window still holds the outgoing account in memory over the incoming one's files.
    window.location.reload();
  }
}

let switchInFlight: Promise<void> | null = null;

/**
 * Switch to a saved account: park the current one's data, restore the target's,
 * write its keychain entries and UI state, then reload so autoLogin picks it up.
 */
export function switchToAccount(account: SavedAccount): Promise<void> {
  // A second run would park the incoming account's data under the outgoing id.
  switchInFlight ??= runSwitch(account).finally(() => {
    switchInFlight = null;
  });
  return switchInFlight;
}

/**
 * Add a cloud account whose credentials were already proven, and switch into it.
 * The current account is saved first, so a keychain that refuses it stops the add
 * before anything is torn down.
 */
export async function addAccount(session: Omit<SavedAccount, "mode">): Promise<void> {
  await saveCurrentAccount();
  if ((await keychainGet("account_id")) === session.account_id) return;
  const entry: SavedAccount = { ...session, mode: "server" };
  await upsertSavedAccount(entry);
  await switchToAccount(entry);
}
