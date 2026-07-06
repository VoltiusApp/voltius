import { invoke } from "@tauri-apps/api/core";
import i18n from "@/i18n";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { getVaultKey, unlockVaultIfNeeded } from "@/services/vault";
import { useThemeStore } from "@/stores/themeStore";
import { buildUserDataBundle, mergeUserDataBundle, applyUserDataBundle } from "@/services/user-data/registry";
import type { UserDataBundle } from "@/services/user-data/formats";
import { useConnectionStore } from "@/stores/connectionStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { useFolderStore } from "@/stores/folderStore";
import { useTeamStore } from "@/stores/teamStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import { mergeEntities, mergeSecrets, type TimestampedEntity } from "@/services/crdt";
import { useVaultKeysStore } from "@/stores/vaultKeysStore";
import { buildDecryptKeyCandidates } from "@/services/vaultKeyCandidates";
import { getMyX25519Keypair } from "@/services/multiplayerService";
import { initTeamVaultKey } from "@/services/teamVaultSync";
import { onTeamLogin } from "@/services/teamDataManager";
import { handleMembershipChangedEvent } from "@/services/teamMembershipEvents";
import * as teamService from "@/services/teamService";
import { appFetch } from "@/services/http";
import { SseDataLineParser } from "@/services/realtimeSseEvents";
import { connectNativeSse } from "@/services/nativeSseStream";
import { useCrossDeviceSessionsStore } from "@/stores/crossDeviceSessionsStore";
import { log } from "@/lib/logger";

export interface BlobPayload {
  files: Record<string, string>;
  secrets: Record<string, string>;
}

interface DeviceInfo {
  device_id: string;
  metadata: Record<string, unknown>;
  updated_at: string;
}

/** Must mirror ENTITY_FILES in src-tauri/src/commands/sync.rs. */
export const ENTITY_FILES = [
  "connections.json",
  "identities.json",
  "ssh_keys.json",
  "folders.json",
  "snippets.json",
  "snippet_folders.json",
  "port_forwarding_rules.json",
] as const;

export type SyncStatus = "idle" | "syncing" | "success" | "error" | "offline";

// ─── Sync state (module-level, not a store) ──────────────────────────────────

let _status: SyncStatus = "idle";
let _lastSync: Date | null = null;
let _error: string | null = null;
let _cloudActive = false;
let _blobSizeBytes: number | null = null;
const _listeners = new Set<() => void>();

export function getSyncState() {
  return { status: _status, lastSync: _lastSync, error: _error, cloudActive: _cloudActive, blobSizeBytes: _blobSizeBytes };
}

export function onSyncStateChange(fn: () => void): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

function setState(status: SyncStatus, error?: string) {
  _status = status;
  _error = error ?? null;
  if (status === "success") _lastSync = new Date();
  _listeners.forEach((fn) => fn());
}

/** DIAGNOSTIC: log any awaited op slower than the threshold, to name a main-thread stall. */
async function timed<T>(label: string, fn: () => Promise<T>, thresholdMs = 1000): Promise<T> {
  const t = performance.now();
  try {
    return await fn();
  } finally {
    const dt = performance.now() - t;
    if (dt >= thresholdMs) log.info(`[perf] ${label} ${dt.toFixed(0)}ms`);
  }
}

async function applyRemoteTheme(remotePayload: BlobPayload): Promise<void> {
  try {
    const remoteRaw = remotePayload.files["theme.json"];
    if (!remoteRaw) return;
    const remote = JSON.parse(remoteRaw) as { updatedAt?: string };
    if (!remote.updatedAt) return;
    const localRaw = await timed("theme_load", () => invoke<string | null>("theme_load"));
    if (localRaw) {
      const local = JSON.parse(localRaw) as { updatedAt?: string };
      if (local.updatedAt && local.updatedAt >= remote.updatedAt) return;
    }
    await timed("theme_save", () => invoke("theme_save", { state: remoteRaw }));
    await timed("theme.loadFromDisk", () => useThemeStore.getState().loadFromDisk());
  } catch {}
}

async function applyRemoteSettings(remotePayload: BlobPayload): Promise<void> {
  try {
    const remoteRaw = remotePayload.files["settings.json"];
    if (!remoteRaw) return;
    const remote = JSON.parse(remoteRaw) as UserDataBundle;
    if (remote.type !== "voltius-user-data") return;
    const localRaw = await timed("settings_load", () => invoke<string | null>("settings_load"));
    const local = localRaw ? (JSON.parse(localRaw) as UserDataBundle) : null;
    const { merged, updatedKeys } = mergeUserDataBundle(local, remote);
    if (updatedKeys.length === 0) return;
    await timed("settings_save", () => invoke("settings_save", { state: JSON.stringify(merged) }));
    await timed("applyUserDataBundle", () => applyUserDataBundle(merged, updatedKeys));
  } catch {}
}

function applyRemoteLiveSessions(remoteDeviceId: string, remotePayload: BlobPayload): void {
  try {
    const raw = remotePayload.files["live_sessions.json"];
    if (!raw) return;
    const doc = JSON.parse(raw) as { deviceId?: string };
    // The manifest names its publisher; a blob restored onto a different
    // device could carry a stale foreign manifest — only trust a match.
    if (doc?.deviceId !== remoteDeviceId) return;
    useCrossDeviceSessionsStore.getState().ingestManifest(doc);
  } catch {}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getJwt(): Promise<string | null> {
  return timed("keychain_get:jwt", () => invoke<string | null>("keychain_get", { key: "jwt" }));
}

export async function getServerUrl(): Promise<string | null> {
  return timed("keychain_get:server_url", () => invoke<string | null>("keychain_get", { key: "server_url" }));
}

/** Try to refresh the access token using the stored refresh_token. Returns new JWT or null. */
async function tryRefreshJwt(): Promise<string | null> {
  const [refreshToken, serverUrl] = await Promise.all([
    invoke<string | null>("keychain_get", { key: "refresh_token" }),
    getServerUrl(),
  ]);
  if (!refreshToken || !serverUrl) return null;

  const res = await appFetch(`${serverUrl}/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) return null;

  const { jwt_token } = await res.json();
  await invoke("keychain_set", { key: "jwt", value: jwt_token });

  const wasProBefore = useSubscriptionStore.getState().isPro;
  const wasTeamsBefore = useSubscriptionStore.getState().isTeams;
  await useSubscriptionStore.getState().load().catch(() => {});
  const isProNow = useSubscriptionStore.getState().isPro;
  const isTeamsNow = useSubscriptionStore.getState().isTeams;

  if (wasProBefore && !isProNow) {
    const { useNotificationStore } = await import("@/stores/notificationStore");
    const { useUIStore } = await import("@/stores/uiStore");
    useNotificationStore.getState().addToast({
      pluginId: "system",
      pluginName: "Voltius",
      type: "toast",
      message: i18n.t("common.toast.proSubscriptionEnded"),
      severity: "warning",
      duration: 0,
      action: {
        label: i18n.t("common.toast.managePlan"),
        onClick: () => useUIStore.getState().openSettings("account"),
      },
    });
  }

  // Subscription restored to teams — retry any vaults that were blocked on 402
  if (!wasTeamsBefore && isTeamsNow) {
    const { useTeamVaultStateStore } = await import("@/stores/teamVaultStateStore");
    const { useTeamStore } = await import("@/stores/teamStore");
    const { fetchTeamData } = await import("@/services/teamVaultSync");
    const { statusByTeamId } = useTeamVaultStateStore.getState();
    const teams = useTeamStore.getState().teams;
    for (const team of teams) {
      if (statusByTeamId[team.id] === "payment_required") {
        fetchTeamData(team.id).catch(() => {});
      }
    }
  }

  return jwt_token;
}

function isJwtExpiredOrExpiring(jwt: string): boolean {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1]));
    return Date.now() > payload.exp * 1000 - 60_000; // refresh 60s before expiry
  } catch {
    return true;
  }
}

function isPaymentRequired(error: unknown): boolean {
  return error instanceof Error && (error.message.includes("402") || error.message.includes("Payment Required"));
}

async function loadTeamsForCurrentUser(): Promise<boolean> {
  await useTeamStore.getState().loadTeams().catch(() => {});
  return useTeamStore.getState().teams.length > 0;
}

/** fetch() wrapper that proactively refreshes the JWT before expiry and backs off on 429. */
export async function fetchWithAuth(url: string, init: RequestInit): Promise<Response> {
  let jwt = await getJwt();

  if (!jwt || isJwtExpiredOrExpiring(jwt)) {
    jwt = await tryRefreshJwt();
    if (!jwt) throw new Error(i18n.t("common.error.sessionExpired"));
  }

  const makeHeaders = (token: string) => ({
    ...(init.headers as Record<string, string>),
    Authorization: `Bearer ${token}`,
  });

  let res = await appFetch(url, { ...init, headers: makeHeaders(jwt) });

  // Fallback: if server still returns 401, try one more refresh
  if (res.status === 401) {
    const newJwt = await tryRefreshJwt();
    if (!newJwt) throw new Error(i18n.t("common.error.sessionExpired"));
    res = await appFetch(url, { ...init, headers: makeHeaders(newJwt) });
  }

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") ?? "60", 10);
    throw new Error(i18n.t("common.error.rateLimited", { seconds: retryAfter }));
  }

  return res;
}

let _deviceId: string | null = null;

/**
 * Returns a stable device ID that persists across app restarts.
 *
 * Uses localStorage so the ID survives process restarts (unlike sessionStorage,
 * which generated a new UUID on every launch and accumulated orphaned blobs on
 * the server). The SSE self-push filter still works correctly for the common
 * single-instance case. In the rare scenario of two simultaneous instances they
 * share the ID, which means one won't receive live SSE nudges from itself — a
 * minor degradation that's acceptable vs. unbounded blob accumulation.
 */
async function getDeviceId(): Promise<string> {
  if (_deviceId) return _deviceId;
  let id = localStorage.getItem("voltius.device_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("voltius.device_id", id);
  }
  _deviceId = id;
  return id;
}

async function getEncKey(): Promise<number[]> {
  const key = getVaultKey();
  if (!key) throw new Error(i18n.t("common.error.vaultLocked"));
  return key;
}

/** Thrown when a sync blob can't be decrypted with any vault key the session holds. */
class BlobDecryptError extends Error {
  constructor() {
    super("Sync blob could not be decrypted with any available vault key");
    this.name = "BlobDecryptError";
  }
}

/**
 * Decrypt a sync blob, trying every vault key the session holds (active vault key,
 * then kek, then dek). Recovers blobs written by devices on the *other* key during
 * the kek/dek split. Throws BlobDecryptError only if no key works.
 *
 * Coverage is limited to the keys actually present: getVaultKey() always, plus kek
 * and dek when vaultKeysStore is populated (set by interactive login and — once it
 * adopts dek — autoLogin). A bare autoLogin session before that holds only one key.
 *
 * Only an AEAD/wrong-key failure ("Decryption failed …") advances to the next key.
 * A structural error (bad length, malformed blob, or corrupt JSON after a successful
 * decrypt) is re-thrown immediately — that is real corruption, not a key mismatch,
 * and trying other keys would only mask it.
 */
async function decryptBlobWithFallback(blobBytes: number[]): Promise<BlobPayload> {
  const { kek, dek } = useVaultKeysStore.getState();
  const candidates = buildDecryptKeyCandidates(getVaultKey(), kek, dek);
  for (let i = 0; i < candidates.length; i++) {
    const encKey = candidates[i];
    const t = performance.now();
    try {
      const r = await invoke<BlobPayload>("backup_decrypt", { encKey, blob: blobBytes });
      log.info(`[perf] backup_decrypt attempt=${i + 1}/${candidates.length} bytes=${blobBytes.length} ok ${(performance.now() - t).toFixed(0)}ms`);
      return r;
    } catch (e) {
      log.info(`[perf] backup_decrypt attempt=${i + 1}/${candidates.length} bytes=${blobBytes.length} fail ${(performance.now() - t).toFixed(0)}ms`);
      // Wrong key for this blob — try the next candidate. Any other failure is
      // structural corruption; re-throw so it isn't silently swallowed.
      if (String(e).includes("Decryption failed")) continue;
      throw e;
    }
  }
  throw new BlobDecryptError();
}

// ─── Encoding helpers (chunked to avoid blocking the main thread) ─────────────

function bytesToBase64(bytes: number[]): string {
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.slice(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): number[] {
  const binary = atob(b64);
  const out = new Array<number>(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ─── Team ID helpers ─────────────────────────────────────────────────────────


// ─── Core sync operations ────────────────────────────────────────────────────

/** Export local data and upload to server. */
export async function push(): Promise<void> {
  const encKey = await getEncKey();
  const [serverUrl, deviceId, accountId] = await Promise.all([
    getServerUrl(),
    getDeviceId(),
    invoke<string | null>("keychain_get", { key: "account_id" }),
  ]);

  if (!serverUrl || !accountId) throw new Error(i18n.t("common.error.notConnectedToServer"));

  await unlockVaultIfNeeded();

  // Ensure settings.json is current before backup_export reads it.
  try {
    const bundle = buildUserDataBundle();
    await invoke("settings_save", { state: JSON.stringify(bundle) });
  } catch {}

  const tExport = performance.now();
  const blob: number[] = await invoke("backup_export", {
    encKey,
    accountId,
    deviceId,
  });
  const tEncode = performance.now();
  const blobB64 = bytesToBase64(blob);
  log.info(`[perf] push backup_export bytes=${blob.length} ${(tEncode - tExport).toFixed(0)}ms bytesToBase64 ${(performance.now() - tEncode).toFixed(0)}ms`);

  const res = await fetchWithAuth(`${serverUrl}/v1/sync/blob`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      device_id: deviceId,
      blob: blobB64,
      metadata: { device_id: deviceId, synced_at: new Date().toISOString() },
    }),
  });

  if (!res.ok) throw new Error(i18n.t("common.error.serverError", { status: res.status }));

  _blobSizeBytes = blob.length;
}

/** List all devices that have uploaded a blob for this account. */
async function listDevices(): Promise<DeviceInfo[]> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) return [];
  const res = await fetchWithAuth(`${serverUrl}/v1/sync/devices`, { method: "GET" });
  if (!res.ok) return [];
  const { devices } = await res.json();
  return devices ?? [];
}

/** Reload all in-memory stores from disk after a merge. */
async function reloadAllStores(): Promise<void> {
  await Promise.all([
    useConnectionStore.getState().loadConnections(),
    useIdentityStore.getState().loadIdentities(),
    useKeyStore.getState().loadKeys(),
    usePluginRegistryStore.getState().load(),
    useFolderStore.getState().loadFolders(),
    useTeamStore.getState().loadTeams(),
    useSnippetStore.getState().loadSnippets(),
    useSnippetFolderStore.getState().loadFolders(),
    usePortForwardingStore.getState().loadRules(),
  ]);
}

async function completeTeamLoginSetup(): Promise<void> {
  // Register public key unconditionally — needed even for users with no linked vaults
  // so that when they're added to a team their key is already on the server.
  try {
    const { publicKey } = await getMyX25519Keypair();
    await teamService.updatePublicKey(publicKey);
  } catch { /* best-effort */ }

  // Owners/managers: re-distribute key to ALL current members (idempotent).
  const teamIds = useTeamStore.getState().teams.map((t) => t.id);
  for (const teamId of teamIds) {
    try {
      await useTeamStore.getState().loadRoles(teamId).catch(() => {});
      const { teams, rolesByTeam } = useTeamStore.getState();
      const myTeam = teams.find((t) => t.id === teamId);
      const teamRoles = rolesByTeam[teamId] ?? [];
      const isPrivileged = (myTeam?.role_ids ?? []).some((rid) => {
        const r = teamRoles.find((role) => role.id === rid);
        return r?.is_builtin && (r.name === "owner" || r.name === "manager");
      });
      if (isPrivileged) {
        const members = await teamService.listMembers(teamId);
        await initTeamVaultKey(teamId, members);
      }
    } catch { /* best-effort */ }
  }

  // Migrate stale keychain entries from the old implementation (one-time).
  const migrated = localStorage.getItem("voltius.team_key_migration_v1");
  if (!migrated) {
    const { invoke: inv } = await import("@tauri-apps/api/core");
    const teams = useTeamStore.getState().teams;
    await Promise.allSettled(
      teams.map((t) => inv("keychain_delete", { key: `team_vault_key_${t.id}` }).catch(() => {})),
    );
    localStorage.setItem("voltius.team_key_migration_v1", "1");
  }

  await onTeamLogin();
}

/**
 * Fetch a remote device's blob, decrypt it, CRDT-merge with local state, and write to disk.
 * Returns true if remote had data newer than local (i.e. local state actually changed).
 * Errors for individual devices are swallowed so one offline device doesn't abort the sync.
 */
async function pullAndMerge(remoteDeviceId: string): Promise<boolean> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) return false;

  const res = await timed("pullAndMerge fetchBlob", () => fetchWithAuth(
    `${serverUrl}/v1/sync/blob?device_id=${encodeURIComponent(remoteDeviceId)}`,
    { method: "GET" },
  ));
  if (res.status === 404) return false; // remote device has no blob yet
  if (!res.ok) return false; // skip unreachable devices

  const { blob: blobB64 } = await res.json();
  const tDecode = performance.now();
  const blobBytes = base64ToBytes(blobB64);
  log.info(`[perf] pullAndMerge base64ToBytes b64=${blobB64.length} bytes=${blobBytes.length} ${(performance.now() - tDecode).toFixed(0)}ms`);

  const remotePayload = await decryptBlobWithFallback(blobBytes);

  await timed("applyRemoteTheme", () => applyRemoteTheme(remotePayload));
  await timed("applyRemoteSettings", () => applyRemoteSettings(remotePayload));
  applyRemoteLiveSessions(remoteDeviceId, remotePayload);

  const localPayload = await timed("state_export_raw", () => invoke<BlobPayload>("state_export_raw"));

  const parse = (payload: BlobPayload, file: string): TimestampedEntity[] => {
    try { return JSON.parse(payload.files[file] ?? "[]"); }
    catch { return []; }
  };

  const mergedFiles: Record<string, string> = {};
  let anyChange = false;
  for (const file of ENTITY_FILES) {
    const local = parse(localPayload, file);
    const remote = parse(remotePayload, file);
    const merged = mergeEntities(local, remote);
    mergedFiles[file] = JSON.stringify(merged);
    // Detect change: different count, or any entity with a newer clock from remote
    if (merged.length !== local.length) {
      anyChange = true;
    } else {
      const localById = new Map(local.map((e) => [e.id, e]));
      for (const m of merged) {
        const l = localById.get(m.id);
        if (!l || m.updated_at > l.updated_at) { anyChange = true; break; }
      }
    }
  }

  const localSecrets = localPayload.secrets ?? {};
  const mergedSecrets = mergeSecrets(localSecrets, remotePayload.secrets ?? {});
  if (!anyChange) {
    for (const k of Object.keys(mergedSecrets)) {
      if (mergedSecrets[k] !== localSecrets[k]) { anyChange = true; break; }
    }
  }

  if (!anyChange) return false; // remote had nothing new — skip write

  const tImport = performance.now();
  await invoke("state_import", { files: mergedFiles, secrets: mergedSecrets });
  log.info(`[perf] pullAndMerge state_import secretCount=${Object.keys(mergedSecrets).length} ${(performance.now() - tImport).toFixed(0)}ms`);
  return true;
}

/**
 * Full sync: merge from all remote devices, then push if needed.
 *
 * @param forcePush  true when called from a local mutation (scheduleSync) — always
 *                   uploads the local blob so other devices see the change.
 *                   false (default) when called from SSE — only pushes if remote
 *                   data actually changed local state, preventing infinite loops.
 */
export async function syncNow(forcePush = false): Promise<void> {
  if (_status === "syncing") return;

  // Personal blob sync is a Pro feature — free-tier accounts have no blob quota.
  if (!useSubscriptionStore.getState().isPro) return;

  setState("syncing");

  const start = Date.now();
  const perfStart = performance.now();
  const minDisplay = 600;
  log.info(`[perf] syncNow start forcePush=${forcePush}`);

  try {
    await unlockVaultIfNeeded();

    // Refresh team membership first so getSyncableTeamIds() sees current state
    // and the sidebar immediately reflects joins/removals (no blob change needed).
    await loadTeamsForCurrentUser();

    const [devices, localDeviceId] = await Promise.all([listDevices(), getDeviceId()]);
    log.info(`[perf] syncNow devices=${devices.length}`);

    // Pull and merge each remote device sequentially (each merge feeds the next).
    // Per-device errors are non-fatal: skip corrupted/mismatched blobs rather than
    // surfacing a confusing "decryption failed" to the user.
    let anyPersonalChanged = false;
    let decryptFailures = 0;
    for (const device of devices) {
      if (device.device_id === localDeviceId) continue;
      try {
        const changed = await pullAndMerge(device.device_id);
        if (changed) anyPersonalChanged = true;
      } catch (e) {
        if (e instanceof BlobDecryptError) {
          decryptFailures++;
          console.debug(`[sync] undecryptable blob from device ${device.device_id}`);
        } else {
          console.debug(`[sync] non-decrypt error for device ${device.device_id}:`, e);
        }
        // Skip this device (unreadable or unreachable) and continue.
      }
    }
    if (decryptFailures > 0) {
      console.debug(`[sync] ${decryptFailures} device blob(s) could not be decrypted with any key`);
    }

    if (anyPersonalChanged) {
      await reloadAllStores();
    }

    // Only push personal blob if forced (local mutation) or remote had new data.
    // Skipping push when nothing changed breaks the push→SSE→pull→push→… loop.
    if (forcePush || anyPersonalChanged) {
      await push();
    }

    log.info(`[perf] syncNow done total=${(performance.now() - perfStart).toFixed(0)}ms`);
    const elapsed = Date.now() - start;
    if (elapsed < minDisplay) await new Promise((r) => setTimeout(r, minDisplay - elapsed));
    setState("success");
  } catch (e) {
    const elapsed = Date.now() - start;
    if (elapsed < minDisplay) await new Promise((r) => setTimeout(r, minDisplay - elapsed));
    if (isPaymentRequired(e) && await loadTeamsForCurrentUser()) {
      await completeTeamLoginSetup();
      setState("success");
      return;
    }
    const msg = e instanceof Error ? e.message : String(e);
    setState(navigator.onLine === false ? "offline" : "error", msg);
    throw e;
  }
}

/**
 * Sign-in sync for EXISTING cloud accounts.
 *
 * Unlike syncOnLogin (which merges local + remote), this function starts from
 * an empty accumulator and merges ONLY remote device blobs together.
 * Local disk state is NEVER read — guaranteed no local contamination.
 *
 * Use this when switching from any local account into an existing cloud account.
 * For new cloud accounts (linkToCloud), use syncOnLogin instead.
 */
export async function syncOnLoginReplace(): Promise<void> {
  const t0 = performance.now();
  log.info("[perf] syncOnLoginReplace start");
  try {
    await unlockVaultIfNeeded();

    if (!useSubscriptionStore.getState().isPro && await loadTeamsForCurrentUser()) {
      await completeTeamLoginSetup();
      log.info(`[perf] syncOnLoginReplace done (team-only) total=${(performance.now() - t0).toFixed(0)}ms`);
      setState("success");
      return;
    }

    const serverUrl = await getServerUrl();
    if (!serverUrl) throw new Error(i18n.t("common.error.notConnectedToServer"));

    const devices = await listDevices();
    log.info(`[perf] syncOnLoginReplace devices=${devices.length}`);

    // Accumulate remote state starting from empty — local disk never touched
    let mergedFiles: Record<string, string> = Object.fromEntries(
      ENTITY_FILES.map((f) => [f, "[]"]),
    );
    let mergedSecrets: Record<string, string> = {};

    let decryptFailures = 0;
    for (const device of devices) {
      try {
        const res = await fetchWithAuth(
          `${serverUrl}/v1/sync/blob?device_id=${encodeURIComponent(device.device_id)}`,
          { method: "GET" },
        );
        if (res.status === 404 || !res.ok) continue;

        const { blob: blobB64 } = await res.json();
        const tDecode = performance.now();
        const blobBytes = base64ToBytes(blobB64);
        log.info(`[perf] syncOnLoginReplace base64ToBytes b64=${blobB64.length} bytes=${blobBytes.length} ${(performance.now() - tDecode).toFixed(0)}ms`);
        const remotePayload = await decryptBlobWithFallback(blobBytes);

        await applyRemoteTheme(remotePayload);
        await applyRemoteSettings(remotePayload);
        applyRemoteLiveSessions(device.device_id, remotePayload);

        const newFiles: Record<string, string> = {};
        for (const file of ENTITY_FILES) {
          const parse = (s: string): TimestampedEntity[] => { try { return JSON.parse(s); } catch { return []; } };
          newFiles[file] = JSON.stringify(
            mergeEntities(parse(mergedFiles[file]), parse(remotePayload.files[file] ?? "[]")),
          );
        }
        mergedFiles = newFiles;
        mergedSecrets = mergeSecrets(mergedSecrets, remotePayload.secrets ?? {});
      } catch (e) {
        if (e instanceof BlobDecryptError) {
          decryptFailures++;
          console.debug(`[sync] undecryptable blob from device ${device.device_id}`);
        } else {
          console.debug(`[sync] non-decrypt error for device ${device.device_id}:`, e);
        }
        // Skip unreadable blobs — don't abort the whole replace-sync.
      }
    }
    if (decryptFailures > 0) {
      console.debug(`[sync] login pull: ${decryptFailures} device blob(s) could not be decrypted with any key`);
    }

    const tImport = performance.now();
    await invoke("state_import", { files: mergedFiles, secrets: mergedSecrets });
    log.info(`[perf] syncOnLoginReplace state_import ${(performance.now() - tImport).toFixed(0)}ms`);
    await reloadAllStores();
    const tPush = performance.now();
    await push();
    const tTeam = performance.now();
    await completeTeamLoginSetup();
    log.info(`[perf] syncOnLoginReplace push ${(tTeam - tPush).toFixed(0)}ms completeTeamLoginSetup ${(performance.now() - tTeam).toFixed(0)}ms total=${(performance.now() - t0).toFixed(0)}ms`);

    setState("success");
  } catch (e) {
    if (isPaymentRequired(e) && await loadTeamsForCurrentUser()) {
      await completeTeamLoginSetup();
      setState("success");
      return;
    }
    const msg = e instanceof Error ? e.message : String(e);
    setState("error", msg);
  }
}

/** Pull on login to restore data from server, then push local state. */
export async function syncOnLogin(): Promise<void> {
  const t0 = performance.now();
  log.info("[perf] syncOnLogin start");
  try {
    await unlockVaultIfNeeded();

    if (!useSubscriptionStore.getState().isPro && await loadTeamsForCurrentUser()) {
      await completeTeamLoginSetup();
      log.info(`[perf] syncOnLogin done (team-only) total=${(performance.now() - t0).toFixed(0)}ms`);
      setState("success");
      return;
    }

    // Pull ALL devices including own — skipping self would prevent recovery
    // after a local wipe (single-user: own blob is the only source of truth).
    // CRDT merge is idempotent so pulling own blob on normal login is safe.
    const devices = await listDevices();
    log.info(`[perf] syncOnLogin devices=${devices.length}`);

    const tPull = performance.now();
    for (const device of devices) {
      try {
        await pullAndMerge(device.device_id);
      } catch {
        // Skip unreadable blobs (corrupted, wrong key, etc.) — don't abort login sync.
      }
    }
    log.info(`[perf] syncOnLogin pull-loop ${(performance.now() - tPull).toFixed(0)}ms`);

    const tReload = performance.now();
    await reloadAllStores();
    log.info(`[perf] syncOnLogin reloadAllStores ${(performance.now() - tReload).toFixed(0)}ms`);
    const tPush = performance.now();
    await push();
    log.info(`[perf] syncOnLogin push ${(performance.now() - tPush).toFixed(0)}ms`);
    const tTeam = performance.now();
    await completeTeamLoginSetup();
    log.info(`[perf] syncOnLogin completeTeamLoginSetup ${(performance.now() - tTeam).toFixed(0)}ms total=${(performance.now() - t0).toFixed(0)}ms`);

    setState("success");
  } catch (e) {
    if (isPaymentRequired(e) && await loadTeamsForCurrentUser()) {
      await completeTeamLoginSetup();
      setState("success");
      return;
    }
    const msg = e instanceof Error ? e.message : String(e);
    setState("error", msg);
  }
}

// ─── Debounced sync on mutations ──────────────────────────────────────────────

let _syncTimer: ReturnType<typeof setTimeout> | null = null;

/** Schedule a sync 2 s after the last mutation (debounced). */
export function scheduleSync() {
  if (!useSubscriptionStore.getState().isPro) return;
  if (_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    _syncTimer = null;
    syncNow(true).catch(() => {}); // forcePush: local mutation must be uploaded
  }, 2000);
}

// ─── Real-time SSE sync ───────────────────────────────────────────────────────

const _teamEventListeners = new Set<(teamId: string) => void>();

export function onTeamSseEvent(fn: (teamId: string) => void): () => void {
  _teamEventListeners.add(fn);
  return () => { _teamEventListeners.delete(fn); };
}

let _sseAbort: AbortController | null = null;

/**
 * Open a persistent SSE connection to the server. When another device uploads
 * a blob, the server sends its device_id. Team blob pushes from other members
 * arrive as "team:{team_id}" events on the same stream — no per-team SSE needed.
 * Auto-reconnects on disconnect with a 5 s back-off.
 */
export function startRealtimeSync(): void {
  stopRealtimeSync();
  _sseAbort = new AbortController();
  void _sseLoop(_sseAbort.signal);
}

export function stopRealtimeSync(): void {
  _sseAbort?.abort();
  _sseAbort = null;
}

async function _sseLoop(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      await _sseConnect(signal);
    } catch {
      // connection dropped or failed — fall through to reconnect delay
    }
    if (!signal.aborted) {
      await new Promise<void>((r) => setTimeout(r, 5_000));
    }
  }
}

async function handleRealtimeEvent(eventData: string, myDeviceId: string): Promise<void> {
  if (eventData.startsWith("team:")) {
    const teamId = eventData.slice(5);
    _teamEventListeners.forEach((fn) => fn(teamId));
    const { fetchTeamData } = await import("@/services/teamVaultSync");
    fetchTeamData(teamId, { background: true }).catch(() => {});
  } else if (eventData.startsWith("team_members:")) {
    const teamId = eventData.slice("team_members:".length);
    const prevMemberIds = new Set(
      (useTeamStore.getState().membersByTeam[teamId] ?? []).map((m) => m.user_id),
    );
    await Promise.all([
      useTeamStore.getState().loadTeams(),
      useTeamStore.getState().loadMembers(teamId),
      useTeamStore.getState().loadRoles(teamId),
    ]);
    const newMembers = (useTeamStore.getState().membersByTeam[teamId] ?? []).filter(
      (m) => !prevMemberIds.has(m.user_id) && m.public_key,
    );
    if (newMembers.length > 0) {
      const { distributeKeyToNewMember } = await import("@/services/teamVaultSync");
      await Promise.allSettled(
        newMembers.map((m) => distributeKeyToNewMember(teamId, m.user_id, m.public_key)),
      );
    }
    useTeamStore.getState().loadPendingInvitations(teamId).catch(() => {});
  } else if (eventData.startsWith("pending_invitations_changed:")) {
    useTeamStore.getState().loadMyPendingInvitations().catch(() => {});
  } else if (eventData === "membership_changed") {
    handleMembershipChangedEvent({
      getTeamIds: () => useTeamStore.getState().teams.map((t) => t.id),
      loadTeams: () => useTeamStore.getState().loadTeams(),
      onTeamAdded: async (teamId) => {
        const { joinAndLoadTeamVault } = await import("@/services/teamDataManager");
        await joinAndLoadTeamVault(teamId);
      },
      onTeamRemoved: async (tid) => {
        // Evict the in-memory vault key immediately so the kicked member can't
        // use a cached key to decrypt data after losing access.
        const { deleteTeamKey } = await import("@/services/teamVaultSync");
        deleteTeamKey(tid);

        // Remove all per-team slices from the team store (members, roles, etc.)
        useTeamStore.getState().removeTeam(tid);

        // Unlink any local vault that was pointing at this team so the vault
        // button disappears from the sidebar rather than staying as a broken
        // cloud-linked vault.
        const { useVaultStore } = await import("@/stores/vaultStore");
        const vaultStore = useVaultStore.getState();
        for (const vault of vaultStore.vaults.filter((v) => v.teamId === tid)) {
          vaultStore.setVaultTeamId(vault.id, null);
        }

        const [
          { useTeamVaultStateStore },
          { useConnectionStore },
          { useIdentityStore },
          { useKeyStore },
          { useFolderStore },
          { useSnippetStore },
          { useSnippetFolderStore },
          { usePortForwardingStore },
        ] = await Promise.all([
          import("@/stores/teamVaultStateStore"),
          import("@/stores/connectionStore"),
          import("@/stores/identityStore"),
          import("@/stores/keyStore"),
          import("@/stores/folderStore"),
          import("@/stores/snippetStore"),
          import("@/stores/snippetFolderStore"),
          import("@/stores/portForwardingStore"),
        ]);
        useTeamVaultStateStore.getState().setStatus(tid, "forbidden");
        useConnectionStore.getState().clearTeamConnections(tid);
        useIdentityStore.getState().clearTeamIdentities(tid);
        useKeyStore.getState().clearTeamKeys(tid);
        useFolderStore.getState().clearTeamFolders(tid);
        useSnippetStore.getState().clearTeamSnippets(tid);
        useSnippetFolderStore.getState().clearTeamSnippetFolders(tid);
        usePortForwardingStore.getState().clearTeamRules(tid);
      },
    }).catch(() => {});
  } else if (eventData.startsWith("presence:")) {
    const parts = eventData.split(":");
    const userId = parts[1];
    const online = parts[2] === "online";
    useTeamStore.getState().setMemberOnline(userId, online);
  } else if (eventData.startsWith("using:")) {
    // Format: using:<subject_user_id>:<connection_id>:<0|1>
    const rest = eventData.slice("using:".length);
    const firstColon = rest.indexOf(":");
    const lastColon = rest.lastIndexOf(":");
    if (firstColon > 0 && lastColon > firstColon) {
      const userId = rest.slice(0, firstColon);
      const connectionId = rest.slice(firstColon + 1, lastColon);
      const inUse = rest.slice(lastColon + 1) === "1";
      const { useConnectionPresenceStore } = await import("@/stores/connectionPresenceStore");
      if (inUse) useConnectionPresenceStore.getState().addUser(connectionId, userId);
      else useConnectionPresenceStore.getState().removeUser(connectionId, userId);
    }
  } else if (eventData === "token_invalidated") {
    tryRefreshJwt().catch(() => {});
  } else if (eventData !== myDeviceId) {
    syncNow().catch(() => {});
  }
}

async function _sseConnect(signal: AbortSignal): Promise<void> {
  const [serverUrl, storedJwt, myDeviceId] = await Promise.all([
    getServerUrl(),
    getJwt(),
    getDeviceId(),
  ]);
  if (!serverUrl) return;

  let jwt = storedJwt;
  if (!jwt || isJwtExpiredOrExpiring(jwt)) jwt = await tryRefreshJwt();
  if (!jwt) return;

  _cloudActive = true;
  _listeners.forEach((fn) => fn());

  // Sync immediately on (re)connect to catch any events missed while offline
  syncNow().catch(() => {});

  // Seed connection-presence snapshot so we render correct state even before any
  // SSE event arrives this session.
  (async () => {
    const [{ fetchCurrentConnectionUsage }, { useConnectionPresenceStore }] = await Promise.all([
      import("@/services/connectionPresence"),
      import("@/stores/connectionPresenceStore"),
    ]);
    const entries = await fetchCurrentConnectionUsage();
    useConnectionPresenceStore.getState().setSnapshot(entries);
  })().catch(() => {});

  const parser = new SseDataLineParser();
  const connect = (token: string) => connectNativeSse(
    `${serverUrl}/v1/sync/stream`,
    { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
    signal,
    (text) => {
      // Each SSE data line contains either the pusher's device_id (personal sync)
      // or "team:{team_id}" (team blob pushed by another member).
      for (const eventData of parser.push(text)) {
        handleRealtimeEvent(eventData, myDeviceId).catch(() => {});
      }
    },
  );
  const connectAndFlush = async (token: string) => {
    await connect(token);
    for (const eventData of parser.flush()) {
      await handleRealtimeEvent(eventData, myDeviceId);
    }
  };

  try {
    await connectAndFlush(jwt);
  } catch (err) {
    if (err instanceof Error && err.message.includes("401")) {
      const refreshedJwt = await tryRefreshJwt();
      if (refreshedJwt) await connectAndFlush(refreshedJwt);
    } else {
      throw err;
    }
  } finally {
    _cloudActive = false;
    _listeners.forEach((fn) => fn());
  }
}
