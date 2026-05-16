import { invoke } from "@tauri-apps/api/core";
import { setVaultKey, verifyVaultKey, lockVault, getVaultStatus, unlockVaultIfNeeded, wipeLocalConfig } from "./vault";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { appFetch, isAbortError } from "@/services/http";

function reloadSubscription() {
  useSubscriptionStore.getState().load().catch(() => {});
}

const FORCE_LOCK_FLAG_KEY = "voltius.force-lock-next-auth";

interface DeriveKeysResult {
  auth_key: string;   // base64 — sent to server
  enc_key: number[];  // raw 32 bytes — used to encrypt secrets
}

function hexToBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return bytes;
}

function isHexEncoded32ByteKey(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value);
}

async function deriveKeys(password: string, accountId: string): Promise<DeriveKeysResult> {
  return invoke<DeriveKeysResult>("derive_keys", { password, accountId });
}

function normalizeServerUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

async function fetchWithTimeout(input: string, init?: RequestInit, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await appFetch(input, { ...init, signal: controller.signal, connectTimeout: timeoutMs });
  } catch (e) {
    if (isAbortError(e)) {
      throw new Error("Server unreachable (timeout) — check your internet connection and server URL");
    }

    // WebView2 / network errors are often opaque objects; normalise them.
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Network error — ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Keychain helpers ─────────────────────────────────────────────────────────

async function keychainGet(key: string): Promise<string | null> {
  return invoke<string | null>("keychain_get", { key });
}
async function keychainSet(key: string, value: string): Promise<void> {
  return invoke("keychain_set", { key, value });
}
async function keychainDelete(key: string): Promise<void> {
  return invoke("keychain_delete", { key });
}

function setForceLockFlag(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(FORCE_LOCK_FLAG_KEY, "1");
  } catch {
    // Ignore storage availability errors in hardened runtimes.
  }
}

export function consumeForceLockFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const forced = window.sessionStorage.getItem(FORCE_LOCK_FLAG_KEY) === "1";
    if (forced) window.sessionStorage.removeItem(FORCE_LOCK_FLAG_KEY);
    return forced;
  } catch {
    return false;
  }
}

export async function lockVaultSession(): Promise<void> {
  const mode = await keychainGet("mode");
  await lockVault();
  setForceLockFlag();

  // Lock should require re-entering the master password on local/server accounts.
  if (mode === "local" || mode === "server") {
    await keychainDelete("master_password");
  }
}

// ─── Account operations ───────────────────────────────────────────────────────

/** First launch, no friction — random key protected by OS keychain. */
export async function createLocalAccountNoPassword(): Promise<void> {
  const accountId = crypto.randomUUID();
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const keyBytes = Array.from(rawKey);
  // Store key as hex so we can recover it from keychain on next launch
  const keyHex = keyBytes.map((b) => b.toString(16).padStart(2, "0")).join("");

  setVaultKey(keyBytes);

  await keychainSet("master_password", keyHex); // hex = "password" for this mode
  await keychainSet("account_id", accountId);
  await keychainSet("mode", "local-nopassword");
}

/** Local account protected by a user-chosen password. */
export async function createLocalAccount(password: string): Promise<void> {
  const accountId = crypto.randomUUID();
  const { enc_key } = await deriveKeys(password, accountId);

  setVaultKey(enc_key);

  await keychainSet("master_password", password);
  await keychainSet("account_id", accountId);
  await keychainSet("mode", "local");
}

/** Cloud account — registers on server and stores JWT. */
export async function createServerAccount(
  email: string,
  password: string,
  serverUrl: string,
): Promise<void> {
  serverUrl = normalizeServerUrl(serverUrl);
  const accountId = crypto.randomUUID();
  const { auth_key, enc_key } = await deriveKeys(password, accountId);
  const { public_key } = await invoke<{ public_key: string }>("generate_keypair");
  const machine_fingerprint = await invoke<string | null>("get_machine_fingerprint").catch(() => null);

  const res = await fetchWithTimeout(`${serverUrl}/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, account_id: accountId, auth_key, public_key, machine_fingerprint }),
  });

  if (res.status === 409) throw new Error("Email already registered");
  if (!res.ok) throw new Error(`Registration failed: ${res.status}`);

  const data = await res.json();

  setVaultKey(enc_key);

  await keychainSet("master_password", password);
  await keychainSet("account_id", accountId);
  await keychainSet("mode", "server");
  await keychainSet("email", email);
  await keychainSet("jwt", data.jwt_token);
  await keychainSet("refresh_token", data.refresh_token);
  await keychainSet("server_url", serverUrl);
  reloadSubscription();
}

/** Unlock with password (vault must exist). */
export async function login(password: string, email?: string, serverUrl?: string): Promise<void> {
  if (serverUrl) serverUrl = normalizeServerUrl(serverUrl);
  let accountId = await keychainGet("account_id");

  if (!accountId && email && serverUrl) {
    const res = await fetchWithTimeout(`${serverUrl}/v1/auth/challenge?email=${encodeURIComponent(email)}`);
    if (!res.ok) throw new Error("Account not found");
    accountId = (await res.json()).account_id;
  }
  if (!accountId) throw new Error("No account found. Please create one first.");

  const mode = await keychainGet("mode");

  let encKey: number[];
  if (mode === "local-nopassword") {
    // password IS the stored hex key — convert back to bytes
    encKey = hexToBytes(password);
  } else {
    const { enc_key } = await deriveKeys(password, accountId);
    encKey = enc_key;
  }

  // Verify the key before committing
  const { exists } = await getVaultStatus();
  if (exists) await verifyVaultKey(encKey);
  setVaultKey(encKey);

  await keychainSet("master_password", password);
  await keychainSet("account_id", accountId);
  if (!mode) {
    // Heal missing mode for local accounts (e.g. Windows after mock-keychain loss).
    // Server mode is corrected below if server auth succeeds.
    await keychainSet("mode", isHexEncoded32ByteKey(password) ? "local-nopassword" : "local");
  }

  // Re-authenticate with server if in server mode (e.g. after logout deleted the JWT)
  const resolvedEmail = email ?? await keychainGet("email");
  const rawServerUrl = serverUrl ?? await keychainGet("server_url");
  const resolvedServerUrl = rawServerUrl ? normalizeServerUrl(rawServerUrl) : null;

  if (resolvedEmail && resolvedServerUrl && (mode === "server" || serverUrl)) {
    const { auth_key } = await deriveKeys(password, accountId);
    const res = await fetchWithTimeout(`${resolvedServerUrl}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: accountId, auth_key }),
    });
    if (!res.ok) throw new Error("Server login failed");
    const data = await res.json();
    await keychainSet("jwt", data.jwt_token);
    await keychainSet("refresh_token", data.refresh_token);
    await keychainSet("mode", "server");
    await keychainSet("email", resolvedEmail);
    await keychainSet("server_url", resolvedServerUrl);
    reloadSubscription();
  }
}

/** Auto-login from keychain — instant (no secret access). */
export async function autoLogin(): Promise<boolean> {
  const [password, accountId, mode] = await Promise.all([
    keychainGet("master_password"),
    keychainGet("account_id"),
    keychainGet("mode"),
  ]);
  if (!password) return false;

  try {
    let encKey: number[];

    // In OS-keychain mode, the stored value is already the encryption key.
    // Some older installs may miss mode/account_id metadata; heal it silently.
    if (mode === "local-nopassword" || (!mode && !accountId && isHexEncoded32ByteKey(password))) {
      if (!isHexEncoded32ByteKey(password)) return false;
      encKey = hexToBytes(password); // password = stored hex key

      if (!accountId) {
        await keychainSet("account_id", crypto.randomUUID());
      }
      if (!mode) {
        await keychainSet("mode", "local-nopassword");
      }
    } else {
      if (!accountId) return false;
      const { enc_key } = await deriveKeys(password, accountId);
      encKey = enc_key;
      if (!mode) {
        // Heal missing mode for local accounts (e.g. Windows after mock-keychain loss)
        await keychainSet("mode", "local");
      }
    }
    setVaultKey(encKey); // instant — no secrets_unlock yet
    return true;
  } catch {
    return false;
  }
}

/** Sign out from cloud session — wipes local vault and all keychain entries so the
 *  app starts fresh on next launch (same as first-launch home screen). */
export async function logout(): Promise<void> {
  const { stopRealtimeSync } = await import("@/services/sync");
  stopRealtimeSync();
  const { onSessionEnd } = await import("@/services/teamDataManager");
  onSessionEnd();
  const { resetVault } = await import("@/services/vault");
  await resetVault();
}

export async function getAccountMode(): Promise<string | null> {
  return keychainGet("mode");
}

export async function getCurrentUserEmail(): Promise<string | null> {
  return keychainGet("email");
}

export async function refreshSession(): Promise<void> {
  const [refreshToken, serverUrl] = await Promise.all([
    keychainGet("refresh_token"),
    keychainGet("server_url"),
  ]);
  if (!refreshToken || !serverUrl) throw new Error("Session expired — please log in again");

  const res = await fetchWithTimeout(`${serverUrl}/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error("Session refresh failed");

  const { jwt_token } = await res.json();
  await keychainSet("jwt", jwt_token);
  reloadSubscription();
}

export async function resendVerificationEmail(): Promise<void> {
  const [jwt, serverUrl] = await Promise.all([
    keychainGet("jwt"),
    keychainGet("server_url"),
  ]);
  if (!jwt || !serverUrl) throw new Error("Not connected to server");

  const res = await fetchWithTimeout(`${serverUrl}/v1/auth/resend-verification-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) throw new Error("Could not resend verification email");
}

export async function isServerMode(): Promise<boolean> {
  return (await keychainGet("mode")) === "server";
}

/** Set a master password on a no-password account — re-encrypts secrets.enc. */
export async function setMasterPassword(password: string): Promise<void> {
  const [accountId, priorMode] = await Promise.all([
    keychainGet("account_id"),
    keychainGet("mode"),
  ]);
  if (!accountId) throw new Error("No account found");

  const { enc_key } = await deriveKeys(password, accountId);

  // Re-encrypt secrets store with new key (ensure unlocked first — autoLogin sets the key lazily)
  await unlockVaultIfNeeded();
  await invoke("secrets_reencrypt", { newEncKey: enc_key });

  // Update keychain
  await keychainSet("master_password", password);
  await keychainSet("mode", "local");

  // Update in-memory key
  setVaultKey(enc_key);

  // If connected to cloud, re-push immediately so other devices get a blob
  // encrypted with the new key — without this, pullAndMerge on any other
  // device would fail to decrypt this device's old blob.
  if (priorMode === "server") {
    const { push } = await import("@/services/sync");
    push().catch(() => {});
  }
}

/** Sign in to an existing cloud account (any local mode — replaces local identity). */
export async function signInToCloud(
  email: string,
  password: string,
  serverUrl: string,
): Promise<void> {
  serverUrl = normalizeServerUrl(serverUrl);
  // Fetch accountId from server
  const res = await fetchWithTimeout(`${serverUrl}/v1/auth/challenge?email=${encodeURIComponent(email)}`);
  if (!res.ok) throw new Error("Account not found");
  const { account_id: accountId } = await res.json();

  const { auth_key, enc_key } = await deriveKeys(password, accountId);

  const loginRes = await fetchWithTimeout(`${serverUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account_id: accountId, auth_key }),
  });
  if (!loginRes.ok) throw new Error("Invalid email or password");
  const data = await loginRes.json();

  setVaultKey(enc_key);

  await keychainSet("master_password", password);
  await keychainSet("account_id", accountId);
  await keychainSet("mode", "server");
  await keychainSet("email", email);
  await keychainSet("jwt", data.jwt_token);
  await keychainSet("refresh_token", data.refresh_token);
  await keychainSet("server_url", serverUrl);
  reloadSubscription();

  // Delete the old secrets.enc (encrypted with the previous account's key — the new
  // key cannot open it and secrets_unlock would fail with "wrong key or corrupted file").
  // config_wipe also clears the JSON entity files; clearLocalEntityState will repopulate
  // them with empty arrays so syncOnLogin starts from a clean slate.
  await wipeLocalConfig();
}

/** Link an existing local account to a cloud server — registers and enables sync. */
export async function linkToCloud(
  email: string,
  serverUrl: string,
): Promise<void> {
  serverUrl = normalizeServerUrl(serverUrl);
  const [password, accountId] = await Promise.all([
    keychainGet("master_password"),
    keychainGet("account_id"),
  ]);
  const mode = await keychainGet("mode");

  if (!accountId) throw new Error("No account found");
  if (mode === "local-nopassword") throw new Error("Set a master password before linking to cloud");
  if (!password) throw new Error("Master password required");

  const { auth_key } = await deriveKeys(password, accountId);
  const { public_key } = await invoke<{ public_key: string }>("generate_keypair");
  const machine_fingerprint = await invoke<string | null>("get_machine_fingerprint").catch(() => null);

  const res = await fetchWithTimeout(`${serverUrl}/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, account_id: accountId, auth_key, public_key, machine_fingerprint }),
  });

  if (res.status === 409) throw new Error("Email already registered");
  if (!res.ok) throw new Error(`Registration failed: ${res.status}`);

  const data = await res.json();

  await keychainSet("mode", "server");
  await keychainSet("email", email);
  await keychainSet("server_url", serverUrl);
  await keychainSet("jwt", data.jwt_token);
  await keychainSet("refresh_token", data.refresh_token);
  reloadSubscription();
}
