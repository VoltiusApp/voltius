import { invoke } from "@tauri-apps/api/core";
import i18n from "@/i18n";
import { logFailure } from "@/lib/logger";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { getJwt, getServerUrl, isJwtExpiredOrExpiring } from "@/services/authTokens";
import { fetchAuthRateLimited } from "@/services/authFetch";
import { getVaultKey, unlockVaultIfNeeded } from "@/services/vault";
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
import { mergeEntities, mergeSecrets, secretsDiffer, type TimestampedEntity } from "@/services/crdt";
import { filterRemoteExcluded, collectExcludedIds } from "./syncExclusion";
import { filterIncoming, filterOutgoing, restoreLocal } from "@/services/user-data/syncFilter";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useVaultKeysStore } from "@/stores/vaultKeysStore";
import { buildDecryptKeyCandidates } from "@/services/vaultKeyCandidates";
import { publishMyPublicKey } from "@/services/multiplayerService";
import { initTeamVaultKey } from "@/services/teamVaultSync";
import { onTeamLogin } from "@/services/teamDataManager";
import { handleMembershipChangedEvent } from "@/services/teamMembershipEvents";
import * as teamService from "@/services/teamService";
import { appFetch } from "@/services/http";
import { SseDataLineParser } from "@/services/realtimeSseEvents";
import { connectNativeSse } from "@/services/nativeSseStream";
import { useCrossDeviceSessionsStore } from "@/stores/crossDeviceSessionsStore";
import { parseUsingEvent } from "@/services/presenceEvent";
import { bytesToBase64, base64ToBytes } from "@/services/teamVaultSyncCore";

export interface BlobPayload {
  files: Record<string, string>;
  secrets: Record<string, string>;
  /** Per-secret last-write timestamps; a key here but not in `secrets` is a deletion tombstone. */
  secret_clocks?: Record<string, string>;
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

async function applyRemoteSettings(remotePayload: BlobPayload): Promise<void> {
  try {
    const remoteRaw = remotePayload.files["settings.json"];
    if (!remoteRaw) return;
    const remote = JSON.parse(remoteRaw) as UserDataBundle;
    if (remote.type !== "voltius-user-data") return;
    const localRaw = await invoke<string | null>("settings_load");
    const local = localRaw ? (JSON.parse(localRaw) as UserDataBundle) : null;
    const { merged, updatedKeys } = mergeUserDataBundle(local, filterIncoming(remote));
    if (updatedKeys.length === 0) return;
    await invoke("settings_save", { state: JSON.stringify(merged) });
    // settings.json keeps the merge result; the stores get this device's
    // held-back values back on top of it. Writing the restored bundle to disk
    // would put held-back values in the file backup_export uploads.
    await applyUserDataBundle(restoreLocal(merged), updatedKeys, { remote: true });
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

export { getServerUrl };

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
  await useSubscriptionStore.getState().load().catch(logFailure("subscription load"));
  const isProNow = useSubscriptionStore.getState().isPro;
  const isTeamsNow = useSubscriptionStore.getState().isTeams;

  if (wasProBefore && !isProNow) {
    const { useNotificationStore } = await import("@/stores/notificationStore");
    const { useUIStore } = await import("@/stores/uiStore");
    useNotificationStore.getState().addToast({
      source: { kind: "plugin", id: "system", name: "Voltius" },
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
        fetchTeamData(team.id).catch(logFailure(`retry payment-blocked vault team=${team.id}`));
      }
    }
  }

  return jwt_token;
}

function isPaymentRequired(error: unknown): boolean {
  return error instanceof Error && (error.message.includes("402") || error.message.includes("Payment Required"));
}

async function loadTeamsForCurrentUser(): Promise<boolean> {
  await useTeamStore.getState().loadTeams().catch(logFailure("loadTeams"));
  return useTeamStore.getState().teams.length > 0;
}

/**
 * fetch() wrapper that proactively refreshes the JWT before expiry and backs off
 * on 429. Re-exported from here because `connectionPresence` imports it by this
 * name; the implementation is the shared one in `authFetch`.
 */
export function fetchWithAuth(url: string, init: RequestInit): Promise<Response> {
  return fetchAuthRateLimited(url, init);
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
  for (const encKey of candidates) {
    try {
      return await invoke<BlobPayload>("backup_decrypt", { encKey, blob: blobBytes });
    } catch (e) {
      // Wrong key for this blob — try the next candidate. Any other failure is
      // structural corruption; re-throw so it isn't silently swallowed.
      if (String(e).includes("Decryption failed")) continue;
      throw e;
    }
  }
  throw new BlobDecryptError();
}

// ─── Team ID helpers ─────────────────────────────────────────────────────────


// ─── Core sync operations ────────────────────────────────────────────────────

/**
 * Ids of every entity object that must not participate in sync — individually
 * excluded, or belonging to a sync-disabled type. Used to filter both the
 * outbound blob (`backup_export`) and inbound remote payloads (pull merge).
 *
 * Exported so non-server sync destinations (e.g. the gist-sync plugin export
 * path, issue #47) apply the same exclusion filter as the built-in server sync.
 */
export function getExcludedObjectIds(): string[] {
  const prefs = useSyncPrefsStore.getState();
  return collectExcludedIds(
    [
      { type: "connection", ids: useConnectionStore.getState().connections.map((c) => c.id) },
      { type: "identity", ids: useIdentityStore.getState().identities.map((i) => i.id) },
      { type: "key", ids: useKeyStore.getState().keys.map((k) => k.id) },
      {
        type: "folder",
        // Snippet folders ride the `folder` type deliberately: FolderCard reads
        // isObjectSynced(id, "folder") for both trees, so one toggle has to
        // govern both or a snippet folder would show as held back while still
        // syncing.
        ids: [...useFolderStore.getState().folders, ...useSnippetFolderStore.getState().folders]
          .map((f) => f.id),
      },
      { type: "snippet", ids: useSnippetStore.getState().snippets.map((s) => s.id) },
      { type: "port-forwarding-rule", ids: usePortForwardingStore.getState().rules.map((r) => r.id) },
    ],
    prefs.isObjectSynced,
    prefs.excludedIds,
  );
}

/** `plugin-registry.json` duplicates `appSettings.plugins.overrides`, so every
 *  destination withholds it under the same condition — that part isn't
 *  destination-specific, unlike theme.json below. `isSettingSynced` is false
 *  whenever the whole appSettings domain is off, so this one check covers both
 *  the domain toggle and the per-key one. */
function skippedConfigFilesCore(): string[] {
  const skipped: string[] = [];
  if (!useSyncPrefsStore.getState().isSettingSynced("appSettings.plugins.overrides")) {
    skipped.push("plugin-registry.json");
  }
  return skipped;
}

/**
 * Config files that must not enter the SERVER blob this round.
 *
 * `theme.json` is always withheld here: themes travel in the settings bundle,
 * and `applyRemoteSettings` merges that bundle on pull, so a second wire would
 * be redundant and could fight the domain toggle.
 *
 * Exported for its test; plugin destinations use `getPluginSkippedSyncFiles`.
 */
export function getSkippedSyncFiles(): string[] {
  return ["theme.json", ...skippedConfigFilesCore()];
}

/**
 * Config files that must not enter a PLUGIN (third-party) blob this round.
 *
 * Unlike the server destination, plugin destinations never merge the settings
 * bundle — `theme.json` is their *only* theme route (see `importStates` in
 * runtime.ts). So it must still travel there whenever the themes domain is
 * synced, and is withheld only when the user has switched that domain off.
 * This asymmetry with `getSkippedSyncFiles` is deliberate, not a bug: it
 * exists because the two destinations don't apply the same wire for themes.
 *
 * A file-level rule is the only rule this wire can enforce, which is why
 * `themes.location` no longer rides inside theme.json (issue #163): a per-key
 * decision the plugin path cannot see is a promise it cannot keep.
 */
export function getPluginSkippedSyncFiles(): string[] {
  const skipped = skippedConfigFilesCore();
  if (!useSyncPrefsStore.getState().isDomainSynced("themes")) {
    skipped.push("theme.json");
  }
  return skipped;
}

/**
 * Ensure settings.json is current before ANY `backup_export` caller reads it.
 * Filtered: this file is both the local merge base and part of the uploaded
 * blob, so a switched-off domain has to be absent from it, not merely ignored
 * on arrival. Every `backup_export` caller (server push, plugin export) must
 * call this first — issue #47 was exactly a second caller skipping a step
 * like this one.
 */
export async function writeFilteredSettings(): Promise<void> {
  // Not swallowed: backup_export reads settings.json from disk regardless of
  // this call's outcome, so a hidden failure here would upload the
  // pre-toggle, unfiltered file. A failed sync round is strictly better than
  // uploading held-back data — let this throw and abort the round.
  const bundle = filterOutgoing(buildUserDataBundle());
  await invoke("settings_save", { state: JSON.stringify(bundle) });
}

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

  await writeFilteredSettings();

  const blob: number[] = await invoke("backup_export", {
    encKey,
    accountId,
    deviceId,
    excludedIds: getExcludedObjectIds(),
    skipFiles: getSkippedSyncFiles(),
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
  // Register the public key even for users with no linked vaults, so it is
  // already there when they're added to a team. publishMyPublicKey still
  // refuses on an unproven vault key (#228).
  try {
    await publishMyPublicKey();
  } catch { /* best-effort */ }

  // Owners/managers: re-distribute key to ALL current members (idempotent).
  const teamIds = useTeamStore.getState().teams.map((t) => t.id);
  for (const teamId of teamIds) {
    try {
      await useTeamStore.getState().loadRoles(teamId).catch(logFailure(`login: loadRoles team=${teamId}`));
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
      teams.map((t) => inv("keychain_delete", { key: `team_vault_key_${t.id}` }).catch(logFailure(`legacy team key migration team=${t.id}`))),
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

  const res = await fetchWithAuth(
    `${serverUrl}/v1/sync/blob?device_id=${encodeURIComponent(remoteDeviceId)}`,
    { method: "GET" },
  );
  if (res.status === 404) return false; // remote device has no blob yet
  if (!res.ok) return false; // skip unreachable devices

  const { blob: blobB64 } = await res.json();
  const blobBytes = base64ToBytes(blobB64);

  const rawRemotePayload = await decryptBlobWithFallback(blobBytes);
  const remotePayload = filterRemoteExcluded(
    rawRemotePayload,
    getExcludedObjectIds(),
    ENTITY_FILES,
  );

  await applyRemoteSettings(remotePayload);
  applyRemoteLiveSessions(remoteDeviceId, remotePayload);

  const localPayload = await invoke<BlobPayload>("state_export_raw");

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
  const secretMerge = mergeSecrets(
    localSecrets,
    localPayload.secret_clocks ?? {},
    remotePayload.secrets ?? {},
    remotePayload.secret_clocks ?? {},
  );
  if (!anyChange && secretsDiffer(localSecrets, secretMerge.secrets)) anyChange = true;

  if (!anyChange) return false; // remote had nothing new — skip write

  await invoke("state_import", {
    files: mergedFiles,
    secrets: secretMerge.secrets,
    secretClocks: secretMerge.clocks,
  });
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
  const minDisplay = 600;

  try {
    await unlockVaultIfNeeded();

    // Refresh team membership first so getSyncableTeamIds() sees current state
    // and the sidebar immediately reflects joins/removals (no blob change needed).
    await loadTeamsForCurrentUser();

    const [devices, localDeviceId] = await Promise.all([listDevices(), getDeviceId()]);

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
  try {
    await unlockVaultIfNeeded();

    if (!useSubscriptionStore.getState().isPro && await loadTeamsForCurrentUser()) {
      await completeTeamLoginSetup();
      setState("success");
      return;
    }

    const serverUrl = await getServerUrl();
    if (!serverUrl) throw new Error(i18n.t("common.error.notConnectedToServer"));

    const devices = await listDevices();
    const excludedIds = getExcludedObjectIds();

    // Accumulate remote state starting from empty — local disk never touched
    let mergedFiles: Record<string, string> = Object.fromEntries(
      ENTITY_FILES.map((f) => [f, "[]"]),
    );
    let mergedSecrets: Record<string, string> = {};
    let mergedSecretClocks: Record<string, string> = {};

    let decryptFailures = 0;
    for (const device of devices) {
      try {
        const res = await fetchWithAuth(
          `${serverUrl}/v1/sync/blob?device_id=${encodeURIComponent(device.device_id)}`,
          { method: "GET" },
        );
        if (res.status === 404 || !res.ok) continue;

        const { blob: blobB64 } = await res.json();
        const blobBytes = base64ToBytes(blobB64);
        const remotePayload = filterRemoteExcluded(
          await decryptBlobWithFallback(blobBytes),
          excludedIds,
          ENTITY_FILES,
        );

        await applyRemoteSettings(remotePayload);
        applyRemoteLiveSessions(device.device_id, remotePayload);

        const newFiles: Record<string, string> = {};
        for (const file of ENTITY_FILES) {
          const parse = (s: string): TimestampedEntity[] => { try { return JSON.parse(s); } catch { return []; } };
          newFiles[file] = JSON.stringify(
            mergeEntities(parse(mergedFiles[file]), parse(remotePayload.files[file] ?? "[]")),
          );
        }
        // Per-secret LWW merge: freshest write across devices wins (issue #35).
        const secretMerge = mergeSecrets(
          mergedSecrets,
          mergedSecretClocks,
          remotePayload.secrets ?? {},
          remotePayload.secret_clocks ?? {},
        );
        mergedSecrets = secretMerge.secrets;
        mergedSecretClocks = secretMerge.clocks;
        mergedFiles = newFiles;
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

    await invoke("state_import", { files: mergedFiles, secrets: mergedSecrets, secretClocks: mergedSecretClocks });
    await reloadAllStores();
    await push();
    await completeTeamLoginSetup();

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
  try {
    await unlockVaultIfNeeded();

    if (!useSubscriptionStore.getState().isPro && await loadTeamsForCurrentUser()) {
      await completeTeamLoginSetup();
      setState("success");
      return;
    }

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
    await completeTeamLoginSetup();

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
    syncNow(true).catch(logFailure("forced push after local mutation")); // forcePush: local mutation must be uploaded
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

async function refetchActiveSessions(): Promise<void> {
  const { useTeamSessionStore } = await import("@/stores/teamSessionStore");
  await useTeamSessionStore.getState().fetchActiveSessions().catch(logFailure("fetchActiveSessions"));
}

/**
 * Runs one cleanup step, logging a failure instead of propagating it. The steps
 * below are independent, and a throw in any of them — a failed dynamic import
 * was enough — used to skip every step after it, keychain wipe included (#233).
 */
async function guarded<T>(context: string, fn: () => Promise<T> | T): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    logFailure(context)(e);
    return undefined;
  }
}

/** Everything a client must undo once it learns it is no longer on a team. */
async function offboardFromTeam(tid: string, teamName: string): Promise<void> {
  const step = <T,>(what: string, fn: () => Promise<T> | T) =>
    guarded(`offboarding ${tid}: ${what}`, fn);

  // membership_changed carries no reason, so a departure this client caused
  // itself is only recognisable from the marker it left behind.
  const departure = await step("read the departure marker", async () => {
    const { selfDeparture } = await import("@/services/teamOffboarding");
    return selfDeparture(tid);
  });

  // A team this client deleted while owning it is not an offboarding at all.
  // Make-private has already adopted its objects locally under the *same* ids,
  // so the wipe below would name the user's own live credentials, the vault
  // would be marked forbidden, and the notice would announce a removal that
  // never happened (#249). The caller has already torn down what it owns.
  if (departure === "self-deleted") return;

  // Evict the in-memory vault key immediately so the kicked member can't use a
  // cached key to decrypt data after losing access.
  await step("evict the vault key", async () => {
    const { deleteTeamKey } = await import("@/services/teamVaultSync");
    deleteTeamKey(tid);
  });

  // Wipe before anything else: the wipe names its keychain entries from the
  // object IDs still held in the stores, and every step below either empties
  // those stores or can throw before reaching it. Clearing the stores alone
  // left a removed member holding the team's plaintext passwords and private
  // keys (#216).
  // undefined means the wipe never ran, so the key names are unknown and
  // unrecoverable; an empty array means it ran clean.
  const leftoverSecrets = await step("wipe the team's secrets", async () => {
    const { clearTeamStoresAndSecrets } = await import("@/services/teamVaultSync");
    return clearTeamStoresAndSecrets(tid);
  });

  const survivors = leftoverSecrets ?? [];
  if (survivors.length > 0) {
    await step("queue the surviving secrets for a later retry", async () => {
      const { usePendingSecretWipeStore } = await import("@/stores/pendingSecretWipeStore");
      usePendingSecretWipeStore.getState().enqueue(tid, survivors);
    });
  }

  await step("clear the team store slices", () => {
    useTeamStore.getState().removeTeam(tid);
  });

  // Unlink any local vault that was pointing at this team so the vault button
  // disappears from the sidebar rather than staying as a broken cloud-linked vault.
  await step("unlink local vaults", async () => {
    const { useVaultStore } = await import("@/stores/vaultStore");
    const vaultStore = useVaultStore.getState();
    for (const vault of vaultStore.vaults.filter((v) => v.teamId === tid)) {
      vaultStore.setVaultTeamId(vault.id, null);
    }
  });

  await step("mark the vault forbidden", async () => {
    const { useTeamVaultStateStore } = await import("@/stores/teamVaultStateStore");
    useTeamVaultStateStore.getState().setStatus(tid, "forbidden");
  });

  await step("notify", async () => {
    const { notifyMembershipEnded, notifySecretsNotWiped } = await import("@/services/teamInbox");
    // Only a removal the user did not ask for is news to them.
    if (departure === undefined) notifyMembershipEnded(teamName);
    // Credentials the user thinks are gone are still readable on this device.
    // That is the one offboarding failure they need to hear about.
    if (leftoverSecrets === undefined || survivors.length > 0) {
      notifySecretsNotWiped(tid, teamName);
    }
  });
}

export async function handleRealtimeEvent(eventData: string, myDeviceId: string): Promise<void> {
  if (eventData.startsWith("team:")) {
    const teamId = eventData.slice(5);
    _teamEventListeners.forEach((fn) => fn(teamId));
    const { fetchTeamData } = await import("@/services/teamVaultSync");
    fetchTeamData(teamId, { background: true }).catch(logFailure(`team event: fetchTeamData team=${teamId}`));
  } else if (eventData.startsWith("team_members:")) {
    const teamId = eventData.slice("team_members:".length);
    await Promise.all([
      useTeamStore.getState().loadTeams(),
      useTeamStore.getState().loadMembers(teamId),
      useTeamStore.getState().loadRoles(teamId),
    ]);
    // Distribute the vault key to any member who lacks one. Reconciliation
    // against the server's key-holder list (rather than a local membership
    // diff) also covers the adder-is-only-key-holder case, where the new
    // member is already in membersByTeam by the time this event fires so the
    // old diff saw zero newcomers and skipped distribution (issue #41).
    const { reconcileTeamVaultKeys } = await import("@/services/teamVaultSync");
    await reconcileTeamVaultKeys(teamId).catch(logFailure(`team_members: reconcileTeamVaultKeys team=${teamId}`));
    useTeamStore.getState().loadPendingInvitations(teamId).catch(logFailure(`team_members: loadPendingInvitations team=${teamId}`));
  } else if (eventData.startsWith("pending_invitations_changed:")) {
    useTeamStore.getState().loadMyPendingInvitations().catch(logFailure("pending_invitations_changed: loadMyPendingInvitations"));
  } else if (eventData === "membership_changed") {
    // Also fired at every recipient of a freshly wrapped vault key. Those users
    // are already members, so the delta below is zero and nothing would re-read
    // the key that just landed (issue #70).
    const { refreshAwaitingKeyTeams } = await import("@/services/teamDataManager");
    refreshAwaitingKeyTeams().catch(logFailure("membership_changed: refreshAwaitingKeyTeams"));

    // Snapshot the names BEFORE loadTeams() runs: the removal is detected by
    // diffing against a reloaded list, so by the time onTeamRemoved fires the
    // departed team is already gone from the store and only its id remains.
    const teamNamesBefore = new Map(
      useTeamStore.getState().teams.map((t) => [t.id, t.name] as const),
    );

    handleMembershipChangedEvent({
      getTeamIds: () => useTeamStore.getState().teams.map((t) => t.id),
      loadTeams: () => useTeamStore.getState().loadTeams(),
      onTeamAdded: async (teamId) => {
        const { joinAndLoadTeamVault } = await import("@/services/teamDataManager");
        await joinAndLoadTeamVault(teamId);
      },
      onTeamRemoved: (tid) => offboardFromTeam(tid, teamNamesBefore.get(tid) ?? tid),
    }).catch(logFailure("membership_changed"));
  } else if (eventData.startsWith("presence:")) {
    const parts = eventData.split(":");
    const userId = parts[1];
    const online = parts[2] === "online";
    useTeamStore.getState().setMemberOnline(userId, online);
  } else if (eventData.startsWith("using:")) {
    const parsed = parseUsingEvent(eventData);
    if (parsed) {
      const { useConnectionPresenceStore } = await import("@/stores/connectionPresenceStore");
      const store = useConnectionPresenceStore.getState();
      if (parsed.inUse) store.addUser(parsed.connectionId, parsed.userId);
      else store.removeUser(parsed.connectionId, parsed.userId);
    }
  } else if (eventData === "token_invalidated") {
    tryRefreshJwt().catch(logFailure("token_invalidated: tryRefreshJwt"));
  } else if (eventData.startsWith("session_shared:") || eventData.startsWith("session_ended:")) {
    await refetchActiveSessions();
  } else if (eventData !== myDeviceId) {
    syncNow().catch(logFailure("cross-device push: syncNow"));
    // "sync" is the server's lagged-receiver fallback: session_shared /
    // session_ended may have been dropped, so refetch active sessions too.
    // Scoped to that event — ordinary cross-device pushes carry a device id
    // and must not each cost a session round-trip.
    if (eventData === "sync") refetchActiveSessions().catch(logFailure("sync fallback: refetchActiveSessions"));
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
  setMyPresence(true);

  // Sync immediately on (re)connect to catch any events missed while offline
  syncNow().catch(logFailure("syncNow on realtime connect"));

  // Seed connection-presence snapshot so we render correct state even before any
  // SSE event arrives this session.
  (async () => {
    const [{ fetchCurrentConnectionUsage }, { useConnectionPresenceStore }] = await Promise.all([
      import("@/services/connectionPresence"),
      import("@/stores/connectionPresenceStore"),
    ]);
    const entries = await fetchCurrentConnectionUsage();
    useConnectionPresenceStore.getState().setSnapshot(entries);
  })().catch(logFailure("connection presence snapshot"));

  const parser = new SseDataLineParser();
  const connect = (token: string) => connectNativeSse(
    `${serverUrl}/v1/sync/stream`,
    { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
    signal,
    (text) => {
      // Each SSE data line contains either the pusher's device_id (personal sync)
      // or "team:{team_id}" (team blob pushed by another member).
      for (const eventData of parser.push(text)) {
        handleRealtimeEvent(eventData, myDeviceId).catch(logFailure(`realtime event ${eventData}`));
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
    setMyPresence(false);
  }
}

/** Presence events only carry other members — the server never tells us about
 *  ourselves. Mirror our own stream state into any loaded members list so our
 *  row doesn't sit on whatever the server's presence map held at fetch time. */
function setMyPresence(online: boolean): void {
  void (async () => {
    const { getMyUserId } = await import("@/services/teamService");
    const myUserId = await getMyUserId();
    if (myUserId) useTeamStore.getState().setSelfOnline(myUserId, online);
  })().catch(logFailure("self presence mirror"));
}
