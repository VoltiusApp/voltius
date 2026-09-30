import { invoke } from "@tauri-apps/api/core";
import { clearPersistedAccountUiState } from "@/stores/persistedAccountUiState";
import { ACCOUNT_CACHE_KEYS } from "./accountCacheKeys";
import { VaultLockedError, VaultUnreadableError } from "./vaultErrors";

/**
 * Rust's own failure strings, matched to tell a wrong key from a busy file.
 * Source of truth: src-tauri/src/storage/secrets.rs (LOCKED_ERR and decrypt) — a
 * rename there must be mirrored here, which the canary test on each side catches.
 */
export const SECRETS_LOCKED_MESSAGE = "Secrets store is locked";
const DECRYPT_FAILED_MESSAGE = "wrong key or corrupted file";

// Pending key: set at login/setup, used to unlock secrets on first access
let pendingKey: number[] | null = null;
let unlocked = false;

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Run a secrets command, giving a failed decrypt its own type. Every other
 * failure — a read error, a busy file — stays itself so callers can tell a key
 * that does not fit from a vault that could not be opened at all.
 */
async function invokeDecrypting<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    // Possibly readable with a key we lack. Deleting it here once cost a vault (#134).
    if (errorMessage(e).includes(DECRYPT_FAILED_MESSAGE)) throw new VaultUnreadableError(e);
    throw e;
  }
}

/**
 * Store the vault key for lazy unlocking.
 * Does NOT hit the secrets store yet — happens on first secret access.
 */
export function setVaultKey(encKey: number[]): void {
  pendingKey = encKey;
  unlocked = false;
}

/** Ensure secrets store is unlocked before any operation. */
async function ensureUnlocked(): Promise<void> {
  if (unlocked) return;
  if (!pendingKey) throw new VaultLockedError();
  await invokeDecrypting("secrets_unlock", { encKey: pendingKey });
  // Before `unlocked`, so no concurrent caller reads the vault ahead of the restore.
  await restoreCarriedSecrets().catch(() => {});
  unlocked = true;
}

const CARRIED_SECRETS_KEY = "carried_device_secrets";

async function restoreCarriedSecrets(): Promise<void> {
  const raw = await invoke<string | null>("keychain_get", { key: CARRIED_SECRETS_KEY });
  if (!raw) return;
  for (const [key, value] of Object.entries(JSON.parse(raw) as Record<string, string>)) {
    await invoke("secrets_set", { key, value });
  }
  await invoke("keychain_delete", { key: CARRIED_SECRETS_KEY });
}

/**
 * Run a secrets command on an unlocked store, giving Rust's bare "locked" string a
 * code so the overlay can offer to unlock. Reaching it means `unlocked` disagreed
 * with the store, so the flag is dropped and the next call unlocks again.
 */
async function withUnlocked<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  await ensureUnlocked();
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    if (errorMessage(e).includes(SECRETS_LOCKED_MESSAGE)) {
      unlocked = false;
      throw new VaultLockedError();
    }
    throw e;
  }
}

/**
 * Set an unreadable secrets.enc aside as a timestamped .bak, keeping the newest few.
 * User-initiated recovery only. Returns the backup's file name.
 */
export async function quarantineVault(): Promise<string> {
  unlocked = false;
  return invoke<string>("secrets_quarantine");
}

/** A set-aside vault file, offered back to the user for restoring. */
export interface VaultBackup {
  file: string;
  stamp_millis: number;
  size: number;
}

/** Set-aside vault files still on disk, newest first. */
export async function listVaultBackups(): Promise<VaultBackup[]> {
  return invoke<VaultBackup[]>("secrets_backups");
}

/**
 * Put a backup back in place, keeping the current vault as a new backup. The
 * restored file opens with whichever key encrypted it, which is not necessarily
 * this session's, so the key is dropped and the caller reloads to the unlock
 * screen. Returns the name the displaced vault was kept under, if there was one.
 */
export async function restoreVaultBackup(file: string): Promise<string | null> {
  const setAside = await invoke<string | null>("secrets_restore", { file });
  pendingKey = null;
  unlocked = false;
  return setAside;
}

/**
 * Verify an enc_key can open the secrets store (used to validate passwords).
 * Does not unlock the store — caller must call setVaultKey after success.
 * Rejects with VaultUnreadableError when the key does not fit; any other
 * rejection means the file could not be read, not that the key is wrong.
 */
export async function verifyVaultKey(encKey: number[]): Promise<void> {
  await invokeDecrypting("secrets_verify", { encKey });
}

export async function lockVault(): Promise<void> {
  pendingKey = null;
  unlocked = false;
  await invoke("secrets_lock");
  const { onSessionEnd } = await import("@/services/teamDataManager");
  onSessionEnd();
}

export async function getVaultStatus(): Promise<{ exists: boolean; path: string }> {
  const exists = await invoke<boolean>("secrets_exists");
  // path is only used for display — derive a plausible value
  return { exists, path: exists ? "secrets.enc" : "" };
}

/**
 * Wipe secrets.enc and the local config directory (connections, identities, keys,
 * folders). Does NOT touch the keychain.
 * Use before syncing into a different account so local data doesn't contaminate
 * the incoming cloud pull — and so the previous account's secrets.enc, which the
 * incoming key cannot open, is gone before that key is installed.
 */
export async function wipeLocalConfig(carry: Record<string, string> = {}): Promise<void> {
  // Carried through the keychain and written back into the next vault on its first unlock.
  if (Object.keys(carry).length > 0) {
    await invoke("keychain_set", { key: CARRIED_SECRETS_KEY, value: JSON.stringify(carry) }).catch(() => {});
  }
  await invoke("config_wipe");
}

/** The present values of `keys`; empty when the vault can't be read. */
export async function readLocalSecrets(keys: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = await getLocalSecret(key).catch(() => null);
    if (value != null) out[key] = value;
  }
  return out;
}

export async function resetVault(): Promise<void> {
  pendingKey = null;
  unlocked = false;
  clearPersistedAccountUiState();
  await invoke("secrets_lock");
  await invoke("vault_reset"); // deletes secrets.enc + connections.json + legacy vault.hold

  // Clear all keychain entries so the app starts fresh
  for (const key of ACCOUNT_CACHE_KEYS) {
    await invoke("keychain_delete", { key }).catch(() => {});
  }
}

export async function storeLocalSecret(key: string, value: string): Promise<void> {
  await withUnlocked("secrets_set", { key, value });
}

export async function getLocalSecret(key: string): Promise<string | null> {
  return withUnlocked<string | null>("secrets_get", { key });
}

export async function deleteLocalSecret(key: string): Promise<void> {
  await withUnlocked("secrets_delete", { key });
}

export async function purgeLocalSecrets(keys: string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  return withUnlocked<string[]>("secrets_purge", { keys });
}

async function routeOf(key: string) {
  const [{ teamIdOwningSecret }, routing] = await Promise.all([
    import("@/services/teamSecretOwnership"),
    import("@/services/secretRouting"),
  ]);
  return { teamId: teamIdOwningSecret(key), routing };
}

export async function getSecret(key: string): Promise<string | null> {
  const { teamId, routing } = await routeOf(key);
  return routing.readSecretAt(teamId, key);
}

export async function storeSecret(key: string, value: string): Promise<void> {
  const { teamId, routing } = await routeOf(key);
  await routing.writeSecretAt(teamId, key, value);
}

export async function deleteSecret(key: string): Promise<void> {
  const { teamId, routing } = await routeOf(key);
  await routing.removeSecretAt(teamId, key);
}

export function getVaultKey(): number[] | null {
  return pendingKey;
}

export async function unlockVaultIfNeeded(): Promise<void> {
  return ensureUnlocked();
}

// ─── Secrets scopés aux plugins ──────────────────────────────────────────

export async function storePluginSecret(pluginId: string, key: string, value: string): Promise<void> {
  return storeLocalSecret(`plugin:${pluginId}:${key}`, value);
}

export async function getPluginSecret(pluginId: string, key: string): Promise<string | null> {
  return getLocalSecret(`plugin:${pluginId}:${key}`);
}

export async function deletePluginSecret(pluginId: string, key: string): Promise<void> {
  return deleteLocalSecret(`plugin:${pluginId}:${key}`);
}
