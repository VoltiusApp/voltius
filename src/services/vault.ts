import { invoke } from "@tauri-apps/api/core";
import { clearPersistedAccountUiState } from "@/stores/persistedAccountUiState";
import { ACCOUNT_CACHE_KEYS } from "./accountCacheKeys";
import { VaultLockedError, VaultUnreadableError } from "./vaultErrors";

// Pending key: set at login/setup, used to unlock secrets on first access
let pendingKey: number[] | null = null;
let unlocked = false;

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
  try {
    await invoke("secrets_unlock", { encKey: pendingKey });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Possibly readable with a key we lack. Deleting it here once cost a vault (#134).
    if (msg.includes("wrong key or corrupted file")) throw new VaultUnreadableError(e);
    throw e;
  }
  unlocked = true;
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
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Secrets store is locked")) {
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
 */
export async function verifyVaultKey(encKey: number[]): Promise<void> {
  await invoke("secrets_verify", { encKey });
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
export async function wipeLocalConfig(): Promise<void> {
  await invoke("config_wipe");
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

export async function storeSecret(key: string, value: string): Promise<void> {
  await withUnlocked("secrets_set", { key, value });
}

export async function getSecret(key: string): Promise<string | null> {
  return withUnlocked<string | null>("secrets_get", { key });
}

export async function deleteSecret(key: string): Promise<void> {
  await withUnlocked("secrets_delete", { key });
}

export function getVaultKey(): number[] | null {
  return pendingKey;
}

export async function unlockVaultIfNeeded(): Promise<void> {
  return ensureUnlocked();
}

// ─── Secrets scopés aux plugins ──────────────────────────────────────────

export async function storePluginSecret(pluginId: string, key: string, value: string): Promise<void> {
  return storeSecret(`plugin:${pluginId}:${key}`, value);
}

export async function getPluginSecret(pluginId: string, key: string): Promise<string | null> {
  return getSecret(`plugin:${pluginId}:${key}`);
}

export async function deletePluginSecret(pluginId: string, key: string): Promise<void> {
  return deleteSecret(`plugin:${pluginId}:${key}`);
}
