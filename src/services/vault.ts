import { invoke } from "@tauri-apps/api/core";

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
  if (!pendingKey) throw new Error("Vault is locked");
  try {
    await invoke("secrets_unlock", { encKey: pendingKey });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("wrong key or corrupted file")) {
      // secrets.enc was encrypted with a stale key (e.g. prior account in same XDG dir).
      // In server mode, the authoritative copy lives on the server — wipe the stale
      // local file so unlock succeeds with an empty store, then let syncOnLogin repopulate.
      const mode = await invoke<string | null>("keychain_get", { key: "mode" }).catch(() => null);
      if (mode === "server") {
        await invoke("secrets_wipe");
        await invoke("secrets_unlock", { encKey: pendingKey });
      } else {
        throw e;
      }
    } else {
      throw e;
    }
  }
  unlocked = true;
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
}

export async function getVaultStatus(): Promise<{ exists: boolean; path: string }> {
  const exists = await invoke<boolean>("secrets_exists");
  // path is only used for display — derive a plausible value
  return { exists, path: exists ? "secrets.enc" : "" };
}

/**
 * Wipe only the local config directory (connections, identities, keys, folders).
 * Does NOT touch secrets.enc or keychain.
 * Use before syncing into a different account so local data doesn't contaminate
 * the incoming cloud pull.
 */
export async function wipeLocalConfig(): Promise<void> {
  await invoke("config_wipe");
}

export async function resetVault(): Promise<void> {
  pendingKey = null;
  unlocked = false;
  await invoke("secrets_lock");
  await invoke("vault_reset"); // deletes secrets.enc + connections.json + legacy vault.hold

  // Clear all keychain entries so the app starts fresh
  for (const key of ["master_password", "account_id", "mode", "email", "jwt", "refresh_token", "server_url", "device_id"]) {
    await invoke("keychain_delete", { key }).catch(() => {});
  }
}

export async function storeSecret(key: string, value: string): Promise<void> {
  await ensureUnlocked();
  await invoke("secrets_set", { key, value });
}

export async function getSecret(key: string): Promise<string | null> {
  await ensureUnlocked();
  return invoke<string | null>("secrets_get", { key });
}

export async function deleteSecret(key: string): Promise<void> {
  await ensureUnlocked();
  await invoke("secrets_delete", { key });
}

export function isUnlocked(): boolean {
  return pendingKey !== null;
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
