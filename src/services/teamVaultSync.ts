/**
 * Team vault sync service.
 *
 * Team vaults are cloud-only (online-only). The XChaCha20-Poly1305 key is held in
 * memory for the session; never written to the OS keychain.
 *
 * Key management:
 *   - initTeamVaultKey()          ← called once when sharing is enabled
 *   - getTeamVaultKey()           ← fetches from server (or hits in-memory cache)
 *   - distributeKeyToNewMember()  ← wraps key for a new member
 *
 * Data management:
 *   - fetchTeamData()  ← download + decrypt + populate Zustand store slices
 *   - saveTeamData()   ← collect Zustand store slices + encrypt + upload
 */

import { invoke } from "@tauri-apps/api/core";
import i18n from "@/i18n";
import { wrapSessionKeyForUser, unwrapSessionKey, getMyX25519Keypair } from "@/services/multiplayerService";
import * as teamService from "@/services/teamService";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";
import { getSecret, storeSecret, deleteSecret } from "@/services/vault";
import type { Connection, Identity, SshKey, Folder, Snippet, PortForwardingRule } from "@/types";
import type { TeamMember } from "@/services/teamService";
import { appFetch } from "@/services/http";
import { log } from "@/lib/logger";
import { listTeamObjects, type TeamObjectRecord } from "@/services/teamObjects";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import {
  shouldShowBlockingTeamVaultLoad,
  TeamVaultRefreshQueue,
  type TeamVaultRefreshOptions,
} from "@/services/teamVaultRefresh";
import { classifyTeamObjectListError } from "@/services/teamVaultLoadErrors";

export type { TeamMember };

// ─── Internal types ───────────────────────────────────────────────────────────

interface BlobPayload {
  files: Record<string, string>;
  secrets: Record<string, string>;
}

// ─── In-memory key cache (process memory only — gone on logout/close) ─────────

const _teamKeyCache = new Map<string, number[]>();
const _teamRefreshQueue = new TeamVaultRefreshQueue();

export function clearTeamKeyCache(): void {
  _teamKeyCache.clear();
}

export function deleteTeamKey(teamId: string): void {
  _teamKeyCache.delete(teamId);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

async function getServerUrl(): Promise<string | null> {
  return invoke<string | null>("keychain_get", { key: "server_url" });
}

async function getJwt(): Promise<string | null> {
  return invoke<string | null>("keychain_get", { key: "jwt" });
}

function isJwtExpiredOrExpiring(jwt: string): boolean {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1]));
    return Date.now() > payload.exp * 1000 - 60_000;
  } catch {
    return true;
  }
}

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
  await useSubscriptionStore.getState().load().catch(() => undefined);
  return jwt_token;
}

async function fetchWithAuth(url: string, init: RequestInit): Promise<Response> {
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

// ─── Key management ───────────────────────────────────────────────────────────

/**
 * Get the team vault key as number[]. Hits in-memory cache first, then fetches
 * from server and unwraps with the local X25519 private key.
 *
 * Throws typed string errors for callers to route to the right UX state:
 *   "offline"          — network error or navigator.onLine === false
 *   "forbidden"        — server returned 403 (membership revoked)
 *   "payment_required" — server returned 402 (subscription lapsed)
 *   "not_found"        — server returned 404 (key never initialised)
 *   "error"            — anything else
 */
export async function getTeamVaultKey(teamId: string): Promise<number[]> {
  const cached = _teamKeyCache.get(teamId);
  if (cached) return cached;

  if (!navigator.onLine) throw "offline";

  const serverUrl = await getServerUrl();
  if (!serverUrl) throw "offline";

  let res: Response;
  try {
    res = await fetchWithAuth(`${serverUrl}/v1/teams/${teamId}/vault-key`, { method: "GET" });
  } catch {
    throw "offline";
  }

  if (res.status === 403) throw "forbidden";
  if (res.status === 402) throw "payment_required";
  if (res.status === 404) throw "not_found";
  if (!res.ok) throw "error";

  const { wrapped_key, wrapped_by_user_id } = await res.json() as {
    wrapped_key: string;
    wrapped_by_user_id: string;
  };

  const members = await teamService.listMembers(teamId);
  const wrapper = members.find((m) => m.user_id === wrapped_by_user_id);
  if (!wrapper) throw "error";

  const rawKey = await unwrapSessionKey(wrapped_key, wrapper.public_key);
  const keyBytes = Array.from(rawKey);
  _teamKeyCache.set(teamId, keyBytes);
  return keyBytes;
}

/**
 * Initialise the team vault key. Tries to reuse any existing key first (404 →
 * generates fresh). Uploads wrapped copies for self and all provided members.
 *
 * Call once when sharing is first enabled, and again when re-distributing to
 * all members (idempotent).
 */
export async function initTeamVaultKey(
  teamId: string,
  members: TeamMember[],
): Promise<void> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) throw new Error(i18n.t("common.error.notConnectedToServer"));

  let rawKey: Uint8Array;
  try {
    const existingBytes = await getTeamVaultKey(teamId);
    rawKey = new Uint8Array(existingBytes);
  } catch (err) {
    if (err !== "not_found") throw new Error(i18n.t("common.error.keyFetchFailed", { error: String(err) }));
    rawKey = crypto.getRandomValues(new Uint8Array(32));
  }

  const { publicKey: myPublicKey } = await getMyX25519Keypair();
  await teamService.updatePublicKey(myPublicKey);

  const myUserId = await teamService.getMyUserId();
  if (!myUserId) throw new Error(i18n.t("common.error.notAuthenticated"));

  const myWrappedKey = await wrapSessionKeyForUser(rawKey, myPublicKey);

  const keys: { user_id: string; wrapped_key: string }[] = [
    { user_id: myUserId, wrapped_key: myWrappedKey },
  ];

  for (const member of members) {
    if (member.user_id === myUserId) continue;
    if (!member.public_key) continue;
    const wrapped = await wrapSessionKeyForUser(rawKey, member.public_key);
    keys.push({ user_id: member.user_id, wrapped_key: wrapped });
  }

  const res = await fetchWithAuth(`${serverUrl}/v1/teams/${teamId}/vault-key`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys }),
  });
  if (!res.ok) throw new Error(i18n.t("common.error.failedToUploadVaultKeys", { status: res.status }));

  _teamKeyCache.set(teamId, Array.from(rawKey));
}

/**
 * Wrap the team vault key for a newly added member and upload it to the server.
 */
export async function distributeKeyToNewMember(
  teamId: string,
  memberUserId: string,
  memberPublicKey: string,
): Promise<void> {
  if (!memberPublicKey) return;

  let rawKey: number[];
  try {
    rawKey = await getTeamVaultKey(teamId);
  } catch {
    return;
  }

  const rawKeyBytes = new Uint8Array(rawKey);
  const wrapped = await wrapSessionKeyForUser(rawKeyBytes, memberPublicKey);

  const serverUrl = await getServerUrl();
  if (!serverUrl) throw new Error(i18n.t("common.error.notConnectedToServer"));

  const res = await fetchWithAuth(`${serverUrl}/v1/teams/${teamId}/vault-key`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys: [{ user_id: memberUserId, wrapped_key: wrapped }] }),
  });
  if (!res.ok) throw new Error(i18n.t("common.error.failedToDistributeVaultKey", { status: res.status }));
}

// ─── Data fetch / save ────────────────────────────────────────────────────────

/**
 * Fetch the team blob, decrypt it, and populate the in-memory store slices.
 * Sets teamVaultStatus to the appropriate state. Never throws — all errors are
 * surfaced via the store status.
 */
export async function fetchTeamData(teamId: string, options: TeamVaultRefreshOptions = {}): Promise<void> {
  return _teamRefreshQueue.run(teamId, () => _fetchTeamData(teamId, options));
}

async function _fetchTeamData(teamId: string, options: TeamVaultRefreshOptions): Promise<void> {
  const stateStore = useTeamVaultStateStore.getState();
  const blockingLoad = shouldShowBlockingTeamVaultLoad(options);
  if (blockingLoad) stateStore.setStatus(teamId, "loading");

  const serverUrl = await getServerUrl();
  if (!serverUrl) {
    if (options.background) return;
    await _clearTeamStores(teamId);
    stateStore.setStatus(teamId, "offline");
    return;
  }

  const tFetch = performance.now();
  try {
    const objects = await listTeamObjects(teamId);
    if (objects.length > 0) {
      await _hydrateTeamObjectStores(teamId, objects);
      const { backfillExistingTeamVaultSecrets, hydrateTeamVaultSecrets } = await import("@/services/teamVaultSecrets");
      await hydrateTeamVaultSecrets(teamId).catch(() => {});
      if (!options.background) await backfillExistingTeamVaultSecrets(teamId).catch(() => {});
      log.info(`[perf] fetchTeamData objects=${objects.length} background=${!!options.background} ${(performance.now() - tFetch).toFixed(0)}ms`);
      stateStore.setStatus(teamId, "loaded");
      return;
    }
  } catch (err) {
    if (options.background) return;
    const action = classifyTeamObjectListError(err);
    if (action === "fallback") {
      // Fall through to legacy key/blob loading. Some clients may hit transient
      // object-route failures immediately after invitation while the legacy blob
      // route already has the vault data available.
    } else {
      await _clearTeamStores(teamId);
      stateStore.setStatus(teamId, action);
      return;
    }
  }

  let key: number[];
  try {
    key = await getTeamVaultKey(teamId);
  } catch (err) {
    const validStatuses = ["offline", "forbidden", "payment_required", "not_found", "error"] as const;
    type S = typeof validStatuses[number];
    const status: S = validStatuses.includes(err as S) ? (err as S) : "error";
    if (options.background) return;
    // Clear team store slices so stale data doesn't linger
    await _clearTeamStores(teamId);
    stateStore.setStatus(teamId, status);
    return;
  }

  let blobPayload: BlobPayload;
  try {
    const res = await fetchWithAuth(`${serverUrl}/v1/teams/${teamId}/sync-blob`, { method: "GET" });
    if (res.status === 404) {
      // No blob yet — owner hasn't pushed data. Show as empty vault.
      if (options.background) return;
      await _clearTeamStores(teamId);
      stateStore.setStatus(teamId, "loaded");
      return;
    }
    if (!res.ok) {
      if (options.background) return;
      await _clearTeamStores(teamId);
      stateStore.setStatus(teamId, "error");
      return;
    }
    const { blob: blobB64 } = await res.json() as { blob: string; updated_at: string };
    const blobBytes = base64ToBytes(blobB64);
    blobPayload = await invoke<BlobPayload>("backup_decrypt", { encKey: key, blob: blobBytes });
  } catch {
    if (options.background) return;
    await _clearTeamStores(teamId);
    stateStore.setStatus(teamId, "error");
    return;
  }

  const parse = <T>(json: string | undefined): T[] => {
    try { return JSON.parse(json ?? "[]"); } catch { return []; }
  };

  const { useConnectionStore } = await import("@/stores/connectionStore");
  const { useIdentityStore } = await import("@/stores/identityStore");
  const { useKeyStore } = await import("@/stores/keyStore");
  const { useFolderStore } = await import("@/stores/folderStore");
  const { useSnippetStore } = await import("@/stores/snippetStore");
  const { useSnippetFolderStore } = await import("@/stores/snippetFolderStore");
  const { usePortForwardingStore } = await import("@/stores/portForwardingStore");

  useConnectionStore.getState().setTeamConnections(teamId, parse<Connection>(blobPayload.files["connections.json"]));
  useIdentityStore.getState().setTeamIdentities(teamId, parse<Identity>(blobPayload.files["identities.json"]));
  useKeyStore.getState().setTeamKeys(teamId, parse<SshKey>(blobPayload.files["ssh_keys.json"]));
  useFolderStore.getState().setTeamFolders(teamId, parse<Folder>(blobPayload.files["folders.json"]));
  useSnippetStore.getState().setTeamSnippets(teamId, parse<Snippet>(blobPayload.files["snippets.json"]));
  useSnippetFolderStore.getState().setTeamSnippetFolders(teamId, parse<Folder>(blobPayload.files["snippet_folders.json"]));
  usePortForwardingStore.getState().setTeamRules(teamId, parse<PortForwardingRule>(blobPayload.files["port_forwarding_rules.json"]));

  for (const [k, v] of Object.entries(blobPayload.secrets ?? {})) {
    await storeSecret(k, v).catch(() => {});
  }

  stateStore.setStatus(teamId, "loaded");
}

async function _hydrateTeamObjectStores(teamId: string, objects: TeamObjectRecord[]): Promise<void> {
  const active = objects.filter((o) => !o.deleted_at);
  const byType = <T>(type: TeamObjectRecord["object_type"]): T[] =>
    active
      .filter((o) => o.object_type === type)
      .map((o) => ({ ...(o.metadata as object), updated_by: o.updated_by } as T));

  const { useConnectionStore } = await import("@/stores/connectionStore");
  const { useIdentityStore } = await import("@/stores/identityStore");
  const { useKeyStore } = await import("@/stores/keyStore");
  const { useFolderStore } = await import("@/stores/folderStore");
  const { useSnippetStore } = await import("@/stores/snippetStore");
  const { useSnippetFolderStore } = await import("@/stores/snippetFolderStore");
  const { usePortForwardingStore } = await import("@/stores/portForwardingStore");

  useConnectionStore.getState().setTeamConnections(teamId, byType<Connection>("connection"));
  useIdentityStore.getState().setTeamIdentities(teamId, byType<Identity>("identity"));
  useKeyStore.getState().setTeamKeys(teamId, byType<SshKey>("key"));
  useFolderStore.getState().setTeamFolders(teamId, byType<Folder>("folder"));
  useSnippetStore.getState().setTeamSnippets(teamId, byType<Snippet>("snippet"));
  useSnippetFolderStore.getState().setTeamSnippetFolders(teamId, byType<Folder>("snippet_folder"));
  usePortForwardingStore.getState().setTeamRules(teamId, byType<PortForwardingRule>("port_forwarding_rule"));

  const { useTeamObjectPrefsStore } = await import("@/stores/teamObjectPrefsStore");
  await useTeamObjectPrefsStore.getState().load(teamId).catch(() => {});
}

/**
 * Collect in-memory team store slices, encrypt them, and upload to the server.
 * Throws on failure — callers are expected to handle errors (e.g. retry toast).
 */
export async function saveTeamData(teamId: string): Promise<void> {
  const key = await getTeamVaultKey(teamId);

  const serverUrl = await getServerUrl();
  if (!serverUrl) throw "offline";

  const { useConnectionStore } = await import("@/stores/connectionStore");
  const { useIdentityStore } = await import("@/stores/identityStore");
  const { useKeyStore } = await import("@/stores/keyStore");
  const { useFolderStore } = await import("@/stores/folderStore");
  const { useSnippetStore } = await import("@/stores/snippetStore");
  const { useSnippetFolderStore } = await import("@/stores/snippetFolderStore");
  const { usePortForwardingStore } = await import("@/stores/portForwardingStore");

  const teamConns = useConnectionStore.getState().teamConnections[teamId] ?? [];
  const teamKeys = useKeyStore.getState().teamKeys[teamId] ?? [];
  const teamIdentities = useIdentityStore.getState().teamIdentities[teamId] ?? [];

  const files: Record<string, string> = {
    "connections.json": JSON.stringify(teamConns),
    "identities.json": JSON.stringify(teamIdentities),
    "ssh_keys.json": JSON.stringify(teamKeys),
    "folders.json": JSON.stringify(useFolderStore.getState().teamFolders[teamId] ?? []),
    "snippets.json": JSON.stringify(useSnippetStore.getState().teamSnippets[teamId] ?? []),
    "snippet_folders.json": JSON.stringify(useSnippetFolderStore.getState().teamSnippetFolders[teamId] ?? []),
    "port_forwarding_rules.json": JSON.stringify(usePortForwardingStore.getState().teamRules[teamId] ?? []),
  };

  const secretEntries = await Promise.all([
    ...teamConns.flatMap((c) => [
      getSecret(`key:${c.id}`).then((v) => v ? [`key:${c.id}`, v] : null).catch(() => null),
      getSecret(`password:${c.id}`).then((v) => v ? [`password:${c.id}`, v] : null).catch(() => null),
    ]),
    ...teamKeys.flatMap((k) => [
      getSecret(`key:${k.id}:private`).then((v) => v ? [`key:${k.id}:private`, v] : null).catch(() => null),
      getSecret(`key:${k.id}:public`).then((v) => v ? [`key:${k.id}:public`, v] : null).catch(() => null),
    ]),
    ...teamIdentities.map((i) =>
      getSecret(`identity:${i.id}:password`).then((v) => v ? [`identity:${i.id}:password`, v] : null).catch(() => null),
    ),
  ]);
  const secrets: Record<string, string> = {};
  for (const e of secretEntries) {
    if (e) secrets[e[0]] = e[1];
  }

  const encryptedBlob: number[] = await invoke("encrypt_payload", {
    encKey: key,
    files,
    secrets,
  });

  const res = await fetchWithAuth(`${serverUrl}/v1/teams/${teamId}/sync-blob`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blob: bytesToBase64(encryptedBlob) }),
  });
  if (!res.ok) throw new Error(i18n.t("common.error.failedToSaveTeamData", { status: res.status }));
}

async function _clearTeamStores(teamId: string): Promise<void> {
  const { useConnectionStore } = await import("@/stores/connectionStore");
  const { useIdentityStore } = await import("@/stores/identityStore");
  const { useKeyStore } = await import("@/stores/keyStore");
  const { useFolderStore } = await import("@/stores/folderStore");
  const { useSnippetStore } = await import("@/stores/snippetStore");
  const { useSnippetFolderStore } = await import("@/stores/snippetFolderStore");
  const { usePortForwardingStore } = await import("@/stores/portForwardingStore");

  // Wipe secrets from disk before clearing in-memory state so we still have the IDs.
  const conns = useConnectionStore.getState().teamConnections[teamId] ?? [];
  const keys = useKeyStore.getState().teamKeys[teamId] ?? [];
  const identities = useIdentityStore.getState().teamIdentities[teamId] ?? [];
  await Promise.allSettled([
    ...conns.flatMap((c) => [
      deleteSecret(`key:${c.id}`),
      deleteSecret(`password:${c.id}`),
    ]),
    ...keys.flatMap((k) => [
      deleteSecret(`key:${k.id}:private`),
      deleteSecret(`key:${k.id}:public`),
    ]),
    ...identities.map((i) => deleteSecret(`identity:${i.id}:password`)),
  ]);

  useConnectionStore.getState().setTeamConnections(teamId, []);
  useIdentityStore.getState().setTeamIdentities(teamId, []);
  useKeyStore.getState().setTeamKeys(teamId, []);
  useFolderStore.getState().setTeamFolders(teamId, []);
  useSnippetStore.getState().setTeamSnippets(teamId, []);
  useSnippetFolderStore.getState().setTeamSnippetFolders(teamId, []);
  usePortForwardingStore.getState().setTeamRules(teamId, []);

  const { useTeamObjectPrefsStore } = await import("@/stores/teamObjectPrefsStore");
  useTeamObjectPrefsStore.getState().clearTeam(teamId);
}
