import { getVersion } from "@tauri-apps/api/app";
import i18n from "@/i18n";
import { appFetch } from "@/services/http";
import { getJwt, getServerUrl, isJwtExpiredOrExpiring, tryRefreshJwt } from "@/services/authTokens";

// Cached: the app version cannot change while the process runs. Caching the
// in-flight *promise* (not just the resolved value) means concurrent callers
// share one getVersion() call instead of each firing their own. A rejection
// clears the cache so the next call retries rather than inheriting a
// poisoned value forever — see src/stores/marketplaceStore.ts for the sibling
// pattern this follows.
let versionPromise: Promise<string | null> | null = null;
function clientVersion(): Promise<string | null> {
  versionPromise ??= getVersion().catch(() => {
    versionPromise = null; // retry next call rather than caching the failure
    return null;
  });
  return versionPromise;
}

export type TeamObjectType =
  | "connection"
  | "identity"
  | "key"
  | "folder"
  | "snippet"
  | "snippet_folder"
  | "port_forwarding_rule";

export interface TeamObjectRecord<T = unknown> {
  object_id: string;
  object_type: TeamObjectType;
  name?: string;
  folder_id?: string;
  metadata: T;
  updated_at: string;
  updated_by: string;
  deleted_at?: string | null;
}

export interface TeamSecretRecord {
  secret_id: string;
  object_id: string;
  secret_type: string;
  ciphertext: string;
  key_version: number;
  updated_at: string;
}

export interface UpsertTeamObject<T = unknown> {
  object_id: string;
  object_type: TeamObjectType;
  name?: string | null;
  folder_id?: string | null;
  metadata: T;
}

export interface UpsertTeamSecret {
  secret_id: string;
  object_id: string;
  secret_type: string;
  ciphertext: string;
  key_version: number;
}

/**
 * Error thrown by {@link fetchTeamApi} carrying machine-readable classification
 * data alongside the (translated, user-facing) message. Callers must classify
 * on `status`/`offline` rather than matching translated message text, which
 * breaks under non-English locales.
 */
export type TeamObjectApiError = Error & { status?: number; offline?: boolean };

function apiError(message: string, opts?: { status?: number; offline?: boolean }): TeamObjectApiError {
  const err = new Error(message) as TeamObjectApiError;
  if (opts?.status !== undefined) err.status = opts.status;
  if (opts?.offline) err.offline = true;
  return err;
}

/**
 * Throws a classifiable {@link TeamObjectApiError} (never a bare `Error`) when
 * `res` is not ok, so every caller's failures carry `status` the same way the
 * special-cased statuses in {@link fetchTeamApi} do. `ignoreStatus` lets
 * delete endpoints treat "already gone" as success.
 */
async function ensureOk(res: Response, messageKey: string, opts?: { ignoreStatus?: number }): Promise<void> {
  if (res.ok || res.status === opts?.ignoreStatus) return;
  throw apiError(i18n.t(messageKey, { status: res.status }), { status: res.status });
}

async function fetchTeamApi(path: string, init: RequestInit): Promise<Response> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) throw apiError(i18n.t("common.error.notConnectedToServer"), { offline: true });

  let jwt = await getJwt();
  if (!jwt || isJwtExpiredOrExpiring(jwt)) jwt = await tryRefreshJwt();
  if (!jwt) throw new Error(i18n.t("common.error.sessionExpired"));

  const version = await clientVersion();
  const makeHeaders = (token: string) => ({
    ...(init.headers as Record<string, string>),
    Authorization: `Bearer ${token}`,
    // Lets a server opt into refusing writes from builds that predate the
    // encrypted metadata format (#229). Compatibility only — spoofable, and
    // never used for authorization. Omitted (rather than a fabricated
    // sentinel) when the version can't be resolved: an absent header reads
    // honestly as "unknown", unlike a lied-about "0.0.0".
    ...(version !== null ? { "X-Client-Version": version } : {}),
  });

  let res = await appFetch(`${serverUrl}${path}`, { ...init, headers: makeHeaders(jwt) });
  if (res.status === 401) {
    const newJwt = await tryRefreshJwt();
    if (!newJwt) throw new Error(i18n.t("common.error.sessionExpired"));
    res = await appFetch(`${serverUrl}${path}`, { ...init, headers: makeHeaders(newJwt) });
  }
  if (res.status === 403) throw apiError(i18n.t("common.error.noPermissionTeamVaultOp"), { status: res.status });
  if (res.status === 402) throw apiError(i18n.t("common.error.teamVaultRequiresSubscription"), { status: res.status });
  if (res.status === 426) throw apiError(i18n.t("common.error.clientTooOldForTeamVault"), { status: res.status });
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") ?? "60", 10);
    throw apiError(i18n.t("common.error.rateLimited", { seconds: retryAfter }), { status: res.status });
  }
  return res;
}

export async function listTeamObjects(teamId: string): Promise<TeamObjectRecord[]> {
  const res = await fetchTeamApi(`/v1/teams/${teamId}/objects`, { method: "GET" });
  await ensureOk(res, "common.error.failedToListTeamObjects");
  return res.json();
}

export async function upsertTeamObject(teamId: string, object: UpsertTeamObject): Promise<void> {
  const res = await fetchTeamApi(`/v1/teams/${teamId}/objects`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(object),
  });
  await ensureOk(res, "common.error.failedToSaveTeamObject");
}

export async function deleteTeamObject(teamId: string, objectId: string): Promise<void> {
  const res = await fetchTeamApi(`/v1/teams/${teamId}/objects/${objectId}`, { method: "DELETE" });
  await ensureOk(res, "common.error.failedToDeleteTeamObject");
}

/**
 * One-time migration write for rows predating #229: updates `metadata` only,
 * leaving `updated_at`/`updated_by` untouched server-side and broadcasting
 * once per batch. `metadata` is always an `EncryptedEnvelope` in practice, but
 * this module has no dependency on the envelope shape, so it stays `unknown`
 * at this layer. Uses `apiError` (not a plain `Error`) so `runReencryptionPass`
 * can classify failures by `status` rather than translated message text.
 */
export async function reencryptTeamObjects(
  teamId: string,
  items: { object_id: string; metadata: unknown }[],
): Promise<void> {
  const res = await fetchTeamApi(`/v1/teams/${teamId}/objects/reencrypt`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(items),
  });
  await ensureOk(res, "common.error.failedToSaveTeamObject");
}

export interface TeamObjectPrefRecord {
  object_id: string;
  pinned: boolean | null;
  updated_at: string;
}

export async function listTeamObjectPrefs(teamId: string): Promise<TeamObjectPrefRecord[]> {
  const res = await fetchTeamApi(`/v1/teams/${teamId}/object_prefs`, { method: "GET" });
  await ensureOk(res, "common.error.failedToListTeamObjectPrefs");
  return res.json();
}

export async function upsertTeamObjectPref(
  teamId: string,
  objectId: string,
  pinned: boolean | null,
): Promise<void> {
  const res = await fetchTeamApi(`/v1/teams/${teamId}/object_prefs/${objectId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pinned }),
  });
  await ensureOk(res, "common.error.failedToSaveTeamObjectPref");
}

export async function deleteTeamObjectPref(teamId: string, objectId: string): Promise<void> {
  const res = await fetchTeamApi(`/v1/teams/${teamId}/object_prefs/${objectId}`, {
    method: "DELETE",
  });
  await ensureOk(res, "common.error.failedToDeleteTeamObjectPref", { ignoreStatus: 404 });
}

export async function listTeamSecrets(teamId: string): Promise<TeamSecretRecord[]> {
  const res = await fetchTeamApi(`/v1/teams/${teamId}/secrets`, { method: "GET" });
  await ensureOk(res, "common.error.failedToListTeamSecrets");
  return res.json();
}

export async function upsertTeamSecret(teamId: string, secret: UpsertTeamSecret): Promise<void> {
  const res = await fetchTeamApi(`/v1/teams/${teamId}/secrets`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(secret),
  });
  await ensureOk(res, "common.error.failedToSaveTeamSecret");
}

/** 404 is success: the secret is already gone from the vault. */
export async function deleteTeamSecret(teamId: string, secretId: string): Promise<void> {
  const res = await fetchTeamApi(`/v1/teams/${teamId}/secrets/${encodeURIComponent(secretId)}`, {
    method: "DELETE",
  });
  await ensureOk(res, "common.error.failedToDeleteTeamSecret", { ignoreStatus: 404 });
}
