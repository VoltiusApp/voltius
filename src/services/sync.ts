import { invoke } from "@tauri-apps/api/core";
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
import { getMyX25519Keypair } from "@/services/multiplayerService";
import { initTeamVaultKey } from "@/services/teamVaultSync";
import { onTeamLogin } from "@/services/teamDataManager";
import * as teamService from "@/services/teamService";

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

async function applyRemoteTheme(remotePayload: BlobPayload): Promise<void> {
  try {
    const remoteRaw = remotePayload.files["theme.json"];
    if (!remoteRaw) return;
    const remote = JSON.parse(remoteRaw) as { updatedAt?: string };
    if (!remote.updatedAt) return;
    const localRaw = await invoke<string | null>("theme_load");
    if (localRaw) {
      const local = JSON.parse(localRaw) as { updatedAt?: string };
      if (local.updatedAt && local.updatedAt >= remote.updatedAt) return;
    }
    await invoke("theme_save", { state: remoteRaw });
    await useThemeStore.getState().loadFromDisk();
  } catch {}
}

async function applyRemoteSettings(remotePayload: BlobPayload): Promise<void> {
  try {
    const remoteRaw = remotePayload.files["settings.json"];
    if (!remoteRaw) return;
    const remote = JSON.parse(remoteRaw) as UserDataBundle;
    if (remote.type !== "voltius-user-data") return;
    const localRaw = await invoke<string | null>("settings_load");
    const local = localRaw ? (JSON.parse(localRaw) as UserDataBundle) : null;
    const { merged, updatedKeys } = mergeUserDataBundle(local, remote);
    if (updatedKeys.length === 0) return;
    await invoke("settings_save", { state: JSON.stringify(merged) });
    await applyUserDataBundle(merged, updatedKeys);
  } catch {}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getJwt(): Promise<string | null> {
  return invoke<string | null>("keychain_get", { key: "jwt" });
}

export async function getServerUrl(): Promise<string | null> {
  return invoke<string | null>("keychain_get", { key: "server_url" });
}

/** Try to refresh the access token using the stored refresh_token. Returns new JWT or null. */
async function tryRefreshJwt(): Promise<string | null> {
  const [refreshToken, serverUrl] = await Promise.all([
    invoke<string | null>("keychain_get", { key: "refresh_token" }),
    getServerUrl(),
  ]);
  if (!refreshToken || !serverUrl) return null;

  const res = await fetch(`${serverUrl}/v1/auth/refresh`, {
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
      message: "Your Pro subscription has ended — sync has been paused.",
      severity: "warning",
      duration: 0,
      action: {
        label: "Manage plan →",
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

/** fetch() wrapper that proactively refreshes the JWT before expiry and backs off on 429. */
export async function fetchWithAuth(url: string, init: RequestInit): Promise<Response> {
  let jwt = await getJwt();

  if (!jwt || isJwtExpiredOrExpiring(jwt)) {
    jwt = await tryRefreshJwt();
    if (!jwt) throw new Error("Session expired — please log in again");
  }

  const makeHeaders = (token: string) => ({
    ...(init.headers as Record<string, string>),
    Authorization: `Bearer ${token}`,
  });

  let res = await fetch(url, { ...init, headers: makeHeaders(jwt) });

  // Fallback: if server still returns 401, try one more refresh
  if (res.status === 401) {
    const newJwt = await tryRefreshJwt();
    if (!newJwt) throw new Error("Session expired — please log in again");
    res = await fetch(url, { ...init, headers: makeHeaders(newJwt) });
  }

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") ?? "60", 10);
    throw new Error(`Rate limited — retry in ${retryAfter}s`);
  }

  return res;
}

let _deviceId: string | null = null;

/**
 * Returns a device ID that is:
 * - Stable within a process session (module variable + sessionStorage)
 * - Unique per simultaneous instance (sessionStorage is per-WebView-process)
 *
 * Previously used the OS keychain, which is shared between all instances of
 * the app running as the same OS user. That caused the SSE self-push filter
 * (`pusherDeviceId !== myDeviceId`) to suppress cross-instance sync events.
 */
async function getDeviceId(): Promise<string> {
  if (_deviceId) return _deviceId;
  let id = sessionStorage.getItem("voltius.device_id");
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem("voltius.device_id", id);
  }
  _deviceId = id;
  return id;
}

async function getEncKey(): Promise<number[]> {
  const key = getVaultKey();
  if (!key) throw new Error("Vault is locked");
  return key;
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

  if (!serverUrl || !accountId) throw new Error("Not connected to server");

  await unlockVaultIfNeeded();

  // Ensure settings.json is current before backup_export reads it.
  try {
    const bundle = buildUserDataBundle();
    await invoke("settings_save", { state: JSON.stringify(bundle) });
  } catch {}

  const blob: number[] = await invoke("backup_export", {
    encKey,
    accountId,
    deviceId,
  });

  const res = await fetchWithAuth(`${serverUrl}/v1/sync/blob`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      device_id: deviceId,
      blob: bytesToBase64(blob),
      metadata: { device_id: deviceId, synced_at: new Date().toISOString() },
    }),
  });

  if (!res.ok) throw new Error(`Server error: ${res.status}`);

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

/**
 * Fetch a remote device's blob, decrypt it, CRDT-merge with local state, and write to disk.
 * Returns true if remote had data newer than local (i.e. local state actually changed).
 * Errors for individual devices are swallowed so one offline device doesn't abort the sync.
 */
async function pullAndMerge(remoteDeviceId: string): Promise<boolean> {
  const [serverUrl, encKey] = await Promise.all([getServerUrl(), getEncKey()]);
  if (!serverUrl) return false;

  const res = await fetchWithAuth(
    `${serverUrl}/v1/sync/blob?device_id=${encodeURIComponent(remoteDeviceId)}`,
    { method: "GET" },
  );
  if (res.status === 404) return false; // remote device has no blob yet
  if (!res.ok) return false; // skip unreachable devices

  const { blob: blobB64 } = await res.json();
  const blobBytes = base64ToBytes(blobB64);

  // Decrypt remote blob without writing to disk
  const remotePayload = await invoke<BlobPayload>("backup_decrypt", { encKey, blob: blobBytes });

  await applyRemoteTheme(remotePayload);
  await applyRemoteSettings(remotePayload);

  // Get current local raw state (includes tombstones)
  const localPayload = await invoke<BlobPayload>("state_export_raw");

  const parse = (payload: BlobPayload, file: string): TimestampedEntity[] => {
    try { return JSON.parse(payload.files[file] ?? "[]"); }
    catch { return []; }
  };

  // CRDT-merge each entity file; track whether remote contributed any new data
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

  await invoke("state_import", { files: mergedFiles, secrets: mergedSecrets });
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
  setState("syncing");

  const start = Date.now();
  const minDisplay = 600;

  try {
    await unlockVaultIfNeeded();

    // Refresh team membership first so getSyncableTeamIds() sees current state
    // and the sidebar immediately reflects joins/removals (no blob change needed).
    await useTeamStore.getState().loadTeams().catch(() => {});

    const [devices, localDeviceId] = await Promise.all([listDevices(), getDeviceId()]);

    // Pull and merge each remote device sequentially (each merge feeds the next).
    // Per-device errors are non-fatal: skip corrupted/mismatched blobs rather than
    // surfacing a confusing "decryption failed" to the user.
    let anyPersonalChanged = false;
    for (const device of devices) {
      if (device.device_id === localDeviceId) continue;
      try {
        const changed = await pullAndMerge(device.device_id);
        if (changed) anyPersonalChanged = true;
      } catch {
        // Blob from this device is unreadable (corrupted, wrong key from a
        // password change on another client, etc.) — skip it and continue.
      }
    }

    // Reload stores after all merges
    if (anyPersonalChanged) {
      await reloadAllStores();
    }

    // Only push personal blob if forced (local mutation) or remote had new data.
    // Skipping push when nothing changed breaks the push→SSE→pull→push→… loop.
    if (forcePush || anyPersonalChanged) {
      await push();
    }

    const elapsed = Date.now() - start;
    if (elapsed < minDisplay) await new Promise((r) => setTimeout(r, minDisplay - elapsed));
    setState("success");
  } catch (e) {
    const elapsed = Date.now() - start;
    if (elapsed < minDisplay) await new Promise((r) => setTimeout(r, minDisplay - elapsed));
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
  try {
    await unlockVaultIfNeeded();

    const encKey = await getEncKey();
    const serverUrl = await getServerUrl();
    if (!serverUrl) throw new Error("Not connected to server");

    const devices = await listDevices();

    // Accumulate remote state starting from empty — local disk never touched
    let mergedFiles: Record<string, string> = Object.fromEntries(
      ENTITY_FILES.map((f) => [f, "[]"]),
    );
    let mergedSecrets: Record<string, string> = {};

    for (const device of devices) {
      try {
        const res = await fetchWithAuth(
          `${serverUrl}/v1/sync/blob?device_id=${encodeURIComponent(device.device_id)}`,
          { method: "GET" },
        );
        if (res.status === 404 || !res.ok) continue;

        const { blob: blobB64 } = await res.json();
        const blobBytes = base64ToBytes(blobB64);
        const remotePayload = await invoke<BlobPayload>("backup_decrypt", { encKey, blob: blobBytes });

        await applyRemoteTheme(remotePayload);
        await applyRemoteSettings(remotePayload);

        const newFiles: Record<string, string> = {};
        for (const file of ENTITY_FILES) {
          const parse = (s: string): TimestampedEntity[] => { try { return JSON.parse(s); } catch { return []; } };
          newFiles[file] = JSON.stringify(
            mergeEntities(parse(mergedFiles[file]), parse(remotePayload.files[file] ?? "[]")),
          );
        }
        mergedFiles = newFiles;
        mergedSecrets = mergeSecrets(mergedSecrets, remotePayload.secrets ?? {});
      } catch {
        // Skip unreadable blobs — don't abort the whole replace-sync.
      }
    }

    // Write merged cloud state to disk (local state is entirely bypassed)
    await invoke("state_import", { files: mergedFiles, secrets: mergedSecrets });
    await reloadAllStores();
    await push();

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

    // Load all team vaults into memory.
    await onTeamLogin();

    setState("success");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setState("error", msg);
  }
}

/** Pull on login to restore data from server, then push local state. */
export async function syncOnLogin(): Promise<void> {
  try {
    await unlockVaultIfNeeded();

    // Pull ALL devices including own — skipping self would prevent recovery
    // after a local wipe (single-user: own blob is the only source of truth).
    // CRDT merge is idempotent so pulling own blob on normal login is safe.
    const devices = await listDevices();

    for (const device of devices) {
      try {
        await pullAndMerge(device.device_id);
      } catch {
        // Skip unreadable blobs (corrupted, wrong key, etc.) — don't abort login sync.
      }
    }

    await reloadAllStores();
    await push();

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

    // Load all team vaults into memory.
    await onTeamLogin();

    setState("success");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setState("error", msg);
  }
}

// ─── Debounced sync on mutations ──────────────────────────────────────────────

let _syncTimer: ReturnType<typeof setTimeout> | null = null;

/** Schedule a sync 2 s after the last mutation (debounced). */
export function scheduleSync() {
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

async function _sseConnect(signal: AbortSignal): Promise<void> {
  const [serverUrl, jwt, myDeviceId] = await Promise.all([
    getServerUrl(),
    getJwt(),
    getDeviceId(),
  ]);
  if (!serverUrl || !jwt) return;

  const res = await fetch(`${serverUrl}/v1/sync/stream`, {
    headers: { Authorization: `Bearer ${jwt}`, Accept: "text/event-stream" },
    signal,
  });
  if (!res.ok || !res.body) return;

  _cloudActive = true;
  _listeners.forEach((fn) => fn());

  // Sync immediately on (re)connect to catch any events missed while offline
  syncNow().catch(() => {});

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      // Each SSE data line contains either the pusher's device_id (personal sync)
      // or "team:{team_id}" (team blob pushed by another member).
      for (const line of text.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const eventData = line.slice(5).trim();
        if (!eventData) continue;
        if (eventData.startsWith("team:")) {
          const teamId = eventData.slice(5);
          _teamEventListeners.forEach((fn) => fn(teamId));
          const { fetchTeamData } = await import("@/services/teamVaultSync");
          fetchTeamData(teamId).catch(() => {});
        } else if (eventData === "membership_changed") {
          const prevTeamIds = new Set(useTeamStore.getState().teams.map((t) => t.id));
          useTeamStore.getState().loadTeams().then(async () => {
            const newTeamIds = new Set(useTeamStore.getState().teams.map((t) => t.id));
            const removed = [...prevTeamIds].filter((tid) => !newTeamIds.has(tid));
            if (removed.length > 0) {
              const [
                { useTeamVaultStateStore },
                { useConnectionStore },
                { useIdentityStore },
                { useKeyStore },
                { useFolderStore },
                { useSnippetStore },
                { useSnippetFolderStore },
              ] = await Promise.all([
                import("@/stores/teamVaultStateStore"),
                import("@/stores/connectionStore"),
                import("@/stores/identityStore"),
                import("@/stores/keyStore"),
                import("@/stores/folderStore"),
                import("@/stores/snippetStore"),
                import("@/stores/snippetFolderStore"),
              ]);
              for (const tid of removed) {
                useTeamVaultStateStore.getState().setStatus(tid, "forbidden");
                useConnectionStore.getState().clearTeamConnections(tid);
                useIdentityStore.getState().clearTeamIdentities(tid);
                useKeyStore.getState().clearTeamKeys(tid);
                useFolderStore.getState().clearTeamFolders(tid);
                useSnippetStore.getState().clearTeamSnippets(tid);
                useSnippetFolderStore.getState().clearTeamSnippetFolders(tid);
              }
            }
          }).catch(() => {});
        } else if (eventData.startsWith("presence:")) {
          const parts = eventData.split(":");
          const userId = parts[1];
          const online = parts[2] === "online";
          useTeamStore.getState().setMemberOnline(userId, online);
        } else if (eventData === "token_invalidated") {
          tryRefreshJwt().catch(() => {});
        } else if (eventData !== myDeviceId) {
          syncNow().catch(() => {});
        }
      }
    }
  } finally {
    reader.cancel();
    _cloudActive = false;
    _listeners.forEach((fn) => fn());
  }
}
