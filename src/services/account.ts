import { invoke } from "@tauri-apps/api/core";
import { setVaultKey, verifyVaultKey, lockVault, getVaultStatus, unlockVaultIfNeeded, wipeLocalConfig } from "./vault";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useVaultKeysStore } from "@/stores/vaultKeysStore";
import { appFetch, isAbortError } from "@/services/http";

function reloadSubscription() {
  useSubscriptionStore.getState().load().catch(() => {});
}

const FORCE_LOCK_FLAG_KEY = "voltius.force-lock-next-auth";

interface DeriveKeysResult {
  auth_key: string;   // base64 — sent to server
  enc_key: number[];  // raw 32 bytes — kek (semantic rename; bit-identical to old enc_key)
}

interface GeneratedUserSecrets {
  dek: number[];
  x25519_private: number[];
  x25519_public: string; // base64
}

interface UnwrappedUserSecrets {
  dek: number[];
  x25519_private: number[];
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

async function generateUserSecrets(): Promise<GeneratedUserSecrets> {
  return invoke<GeneratedUserSecrets>("generate_user_secrets_cmd");
}

async function wrapUserSecrets(kek: number[], dek: number[], x25519Private: number[]): Promise<string> {
  return invoke<string>("wrap_user_secrets_cmd", { kek, dek, x25519Private });
}

async function unwrapUserSecrets(kek: number[], wrappedB64: string): Promise<UnwrappedUserSecrets> {
  return invoke<UnwrappedUserSecrets>("unwrap_user_secrets_cmd", { kek, wrappedB64 });
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
  const secrets = await generateUserSecrets();
  const wrapped_user_secrets = await wrapUserSecrets(enc_key, secrets.dek, secrets.x25519_private);
  const machine_fingerprint = await invoke<string | null>("get_machine_fingerprint").catch(() => null);

  const res = await fetchWithTimeout(`${serverUrl}/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      account_id: accountId,
      auth_key,
      public_key: secrets.x25519_public,
      wrapped_user_secrets,
      machine_fingerprint,
    }),
  });

  if (res.status === 409) throw new Error("Email already registered");
  if (!res.ok) throw new Error(`Registration failed: ${res.status}`);

  const data = await res.json();

  useVaultKeysStore.getState().set({ dek: secrets.dek, x25519Private: secrets.x25519_private, kek: enc_key });
  setVaultKey(secrets.dek);

  await keychainSet("master_password", password);
  await keychainSet("account_id", accountId);
  await keychainSet("mode", "server");
  await keychainSet("email", email);
  await keychainSet("jwt", data.jwt_token);
  await keychainSet("refresh_token", data.refresh_token);
  await keychainSet("server_url", serverUrl);
  await keychainSet("wrapped_user_secrets", wrapped_user_secrets);
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
    const { auth_key, enc_key: kek } = await deriveKeys(password, accountId);
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

    if (data.wrapped_user_secrets) {
      const unwrapped = await unwrapUserSecrets(kek, data.wrapped_user_secrets);
      useVaultKeysStore.getState().set({ dek: unwrapped.dek, x25519Private: unwrapped.x25519_private, kek });
      setVaultKey(unwrapped.dek);
      await keychainSet("wrapped_user_secrets", data.wrapped_user_secrets);
    } else {
      // Legacy account — trigger one-time migration
      await migrateToWrappedUserSecrets(password, accountId, kek, resolvedServerUrl, data.jwt_token);
    }

    reloadSubscription();
  }
}

/** Auto-login from keychain — instant (no secret access). */
export async function autoLogin(): Promise<boolean> {
  // A keychain failure here (e.g. an OS keychain backend unavailable on a platform)
  // must degrade to "no session", never throw — an unhandled rejection would abort the
  // splash init and freeze the app on its loading screen.
  let password: string | null, accountId: string | null, mode: string | null;
  try {
    [password, accountId, mode] = await Promise.all([
      keychainGet("master_password"),
      keychainGet("account_id"),
      keychainGet("mode"),
    ]);
  } catch {
    return false;
  }
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
      const { enc_key: kek } = await deriveKeys(password, accountId);
      encKey = kek;

      // Adopt dek when this device has previously unwrapped user secrets (cached at
      // login/migration). Converges every session onto dek so the kek/dek split heals.
      // Offline: unwrap + verify are local Tauri calls, no network — autoLogin stays instant.
      const wrapped = await keychainGet("wrapped_user_secrets");
      if (wrapped) {
        try {
          const unwrapped = await unwrapUserSecrets(kek, wrapped);
          useVaultKeysStore.getState().set({
            dek: unwrapped.dek,
            x25519Private: unwrapped.x25519_private,
            kek,
          });
          // Pick the key that actually opens secrets.enc — prefer dek, fall back to kek.
          // Guards against a device whose on-disk vault is still kek-encrypted.
          const { exists } = await getVaultStatus();
          if (!exists) {
            encKey = unwrapped.dek;
          } else {
            try {
              await verifyVaultKey(unwrapped.dek);
              encKey = unwrapped.dek;
            } catch {
              encKey = kek;
            }
          }
        } catch {
          // Corrupt/foreign cached secrets — stay on kek.
          encKey = kek;
        }
      }

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
  useVaultKeysStore.getState().clear();
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

export async function getCurrentDisplayName(): Promise<string | null> {
  return keychainGet("display_name");
}

export async function fetchAndCacheDisplayName(): Promise<string | null> {
  const [jwt, serverUrl] = await Promise.all([keychainGet("jwt"), keychainGet("server_url")]);
  if (!jwt || !serverUrl) return null;
  try {
    const res = await fetchWithTimeout(`${serverUrl}/v1/auth/me`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) return null;
    const me = await res.json();
    if (me.display_name) await keychainSet("display_name", me.display_name);
    return me.display_name ?? null;
  } catch {
    return null;
  }
}

export async function updateDisplayName(newName: string): Promise<void> {
  const [jwt, serverUrl] = await Promise.all([keychainGet("jwt"), keychainGet("server_url")]);
  if (!jwt || !serverUrl) throw new Error("Not connected to server");

  const res = await fetchWithTimeout(`${serverUrl}/v1/auth/display-name`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ display_name: newName }),
  });
  if (res.status === 422) throw new Error("Display name must be 1–50 characters");
  if (!res.ok) throw new Error(`Failed to update display name: ${res.status}`);

  await keychainSet("display_name", newName);
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

  await keychainSet("master_password", password);
  await keychainSet("mode", "local");

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
  const res = await fetchWithTimeout(`${serverUrl}/v1/auth/challenge?email=${encodeURIComponent(email)}`);
  if (!res.ok) throw new Error("Account not found");
  const { account_id: accountId } = await res.json();

  const { auth_key, enc_key: kek } = await deriveKeys(password, accountId);

  const loginRes = await fetchWithTimeout(`${serverUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account_id: accountId, auth_key }),
  });
  if (!loginRes.ok) throw new Error("Invalid email or password");
  const data = await loginRes.json();

  let vaultKey = kek;
  if (data.wrapped_user_secrets) {
    const unwrapped = await unwrapUserSecrets(kek, data.wrapped_user_secrets);
    useVaultKeysStore.getState().set({ dek: unwrapped.dek, x25519Private: unwrapped.x25519_private, kek });
    vaultKey = unwrapped.dek;
    await keychainSet("wrapped_user_secrets", data.wrapped_user_secrets);
  }

  setVaultKey(vaultKey);

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

  const { auth_key, enc_key: kek } = await deriveKeys(password, accountId);
  const secrets = await generateUserSecrets();
  const wrapped_user_secrets = await wrapUserSecrets(kek, secrets.dek, secrets.x25519_private);
  const machine_fingerprint = await invoke<string | null>("get_machine_fingerprint").catch(() => null);

  const res = await fetchWithTimeout(`${serverUrl}/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      account_id: accountId,
      auth_key,
      public_key: secrets.x25519_public,
      wrapped_user_secrets,
      machine_fingerprint,
    }),
  });

  if (res.status === 409) throw new Error("Email already registered");
  if (!res.ok) throw new Error(`Registration failed: ${res.status}`);

  const data = await res.json();

  useVaultKeysStore.getState().set({ dek: secrets.dek, x25519Private: secrets.x25519_private, kek });

  await keychainSet("mode", "server");
  await keychainSet("email", email);
  await keychainSet("server_url", serverUrl);
  await keychainSet("jwt", data.jwt_token);
  await keychainSet("refresh_token", data.refresh_token);
  await keychainSet("wrapped_user_secrets", wrapped_user_secrets);
  reloadSubscription();
}

// ─── New account management features ─────────────────────────────────────────

export async function changeMasterPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const [accountId, jwt, serverUrl] = await Promise.all([
    keychainGet("account_id"),
    keychainGet("jwt"),
    keychainGet("server_url"),
  ]);
  if (!accountId) throw new Error("No account found");
  if (!jwt || !serverUrl) throw new Error("Not connected to server");

  const { auth_key: old_auth_key, enc_key: old_kek } = await deriveKeys(currentPassword, accountId);

  let cachedDek = useVaultKeysStore.getState().dek;
  let cachedX25519 = useVaultKeysStore.getState().x25519Private;

  if (!cachedDek || !cachedX25519) {
    const meRes = await fetchWithTimeout(`${serverUrl}/v1/auth/me`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!meRes.ok) throw new Error("Failed to fetch account info");
    const me = await meRes.json();
    if (!me.wrapped_user_secrets) throw new Error("Account not migrated yet — please log in from the Tauri app first");
    const unwrapped = await unwrapUserSecrets(old_kek, me.wrapped_user_secrets);
    cachedDek = unwrapped.dek;
    cachedX25519 = unwrapped.x25519_private;
  }

  const { auth_key: new_auth_key, enc_key: new_kek } = await deriveKeys(newPassword, accountId);
  const new_wrapped_user_secrets = await wrapUserSecrets(new_kek, cachedDek, cachedX25519);

  const res = await fetchWithTimeout(`${serverUrl}/v1/auth/password`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ old_auth_key, new_auth_key, new_wrapped_user_secrets }),
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("Current password is incorrect");
    throw new Error(`Password change failed: ${res.status}`);
  }

  const data = await res.json();
  await keychainSet("master_password", newPassword);
  await keychainSet("jwt", data.jwt_token);
  await keychainSet("refresh_token", data.refresh_token);
  await keychainSet("wrapped_user_secrets", new_wrapped_user_secrets);
  useVaultKeysStore.getState().set({ dek: cachedDek, x25519Private: cachedX25519, kek: new_kek });
  reloadSubscription();
}

export async function changeEmail(newEmail: string, currentPassword: string): Promise<void> {
  const [accountId, jwt, serverUrl] = await Promise.all([
    keychainGet("account_id"),
    keychainGet("jwt"),
    keychainGet("server_url"),
  ]);
  if (!accountId) throw new Error("No account found");
  if (!jwt || !serverUrl) throw new Error("Not connected to server");

  const { auth_key } = await deriveKeys(currentPassword, accountId);

  const res = await fetchWithTimeout(`${serverUrl}/v1/auth/email`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ new_email: newEmail, auth_key }),
  });
  if (res.status === 409) throw new Error("Email is already in use");
  if (res.status === 401) throw new Error("Incorrect password");
  if (!res.ok) throw new Error(`Email update failed: ${res.status}`);

  await keychainSet("email", newEmail);
  await refreshSession();
}

async function migrateToWrappedUserSecrets(
  _password: string,
  _accountId: string,
  kek: number[],
  serverUrl: string,
  jwt: string,
): Promise<void> {
  try {
    // Derive existing deterministic X25519 keypair from legacy enc_key (= kek)
    const { private_key: legacyX25519PrivateB64 } =
      await invoke<{ public_key: string; private_key: string }>("derive_x25519_keypair", { encKey: kek });

    const legacyX25519Private = Array.from(
      Uint8Array.from(atob(legacyX25519PrivateB64), (c) => c.charCodeAt(0))
    );

    const secrets = await generateUserSecrets();
    const dek = secrets.dek;

    // Re-encrypt secrets.enc: old key was kek (legacy), new key is dek
    await invoke("secrets_rekey", { oldEncKey: kek, newEncKey: dek });

    // Build user_secrets with legacy X25519 private key (preserves public key on server)
    const wrapped_user_secrets = await wrapUserSecrets(kek, dek, legacyX25519Private);

    const res = await fetchWithTimeout(`${serverUrl}/v1/auth/wrapped-user-secrets`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ wrapped_user_secrets }),
    });
    if (!res.ok) {
      console.warn("Migration upload failed:", res.status);
      // Don't throw — fall back to using kek as vault key
      setVaultKey(kek);
      return;
    }

    useVaultKeysStore.getState().set({ dek, x25519Private: legacyX25519Private, kek });
    setVaultKey(dek);
    await keychainSet("wrapped_user_secrets", wrapped_user_secrets);

    const { push } = await import("@/services/sync");
    push().catch(() => {});
  } catch (e) {
    console.warn("Migration failed, falling back to legacy key:", e);
    setVaultKey(kek);
  }
}
