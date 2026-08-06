import i18n from "@/i18n";
import { appFetch } from "@/services/http";
import { getJwt, getServerUrl, isJwtExpiredOrExpiring, tryRefreshJwt } from "@/services/authTokens";

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
  updated_at: string;
}

export interface UpsertTeamObject<T = unknown> {
  object_id: string;
  object_type: TeamObjectType;
  name?: string;
  folder_id?: string;
  metadata: T;
}

export interface UpsertTeamSecret {
  secret_id: string;
  object_id: string;
  secret_type: string;
  ciphertext: string;
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

async function fetchTeamApi(path: string, init: RequestInit): Promise<Response> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) throw apiError(i18n.t("common.error.notConnectedToServer"), { offline: true });

  let jwt = await getJwt();
  if (!jwt || isJwtExpiredOrExpiring(jwt)) jwt = await tryRefreshJwt();
  if (!jwt) throw new Error(i18n.t("common.error.sessionExpired"));

  const makeHeaders = (token: string) => ({
    ...(init.headers as Record<string, string>),
    Authorization: `Bearer ${token}`,
  });

  let res = await appFetch(`${serverUrl}${path}`, { ...init, headers: makeHeaders(jwt) });
  if (res.status === 401) {
    const newJwt = await tryRefreshJwt();
    if (!newJwt) throw new Error(i18n.t("common.error.sessionExpired"));
    res = await appFetch(`${serverUrl}${path}`, { ...init, headers: makeHeaders(newJwt) });
  }
  if (res.status === 403) throw apiError(i18n.t("common.error.noPermissionTeamVaultOp"), { status: res.status });
  if (res.status === 402) throw apiError(i18n.t("common.error.teamVaultRequiresSubscription"), { status: res.status });
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") ?? "60", 10);
    throw apiError(i18n.t("common.error.rateLimited", { seconds: retryAfter }), { status: res.status });
  }
  return res;
}

export async function listTeamObjects(teamId: string): Promise<TeamObjectRecord[]> {
  const res = await fetchTeamApi(`/v1/teams/${teamId}/objects`, { method: "GET" });
  if (!res.ok) throw new Error(i18n.t("common.error.failedToListTeamObjects", { status: res.status }));
  return res.json();
}

export async function upsertTeamObject(teamId: string, object: UpsertTeamObject): Promise<void> {
  const res = await fetchTeamApi(`/v1/teams/${teamId}/objects`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(object),
  });
  if (!res.ok) throw new Error(i18n.t("common.error.failedToSaveTeamObject", { status: res.status }));
}

export async function deleteTeamObject(teamId: string, objectId: string): Promise<void> {
  const res = await fetchTeamApi(`/v1/teams/${teamId}/objects/${objectId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(i18n.t("common.error.failedToDeleteTeamObject", { status: res.status }));
}

export interface TeamObjectPrefRecord {
  object_id: string;
  pinned: boolean | null;
  updated_at: string;
}

export async function listTeamObjectPrefs(teamId: string): Promise<TeamObjectPrefRecord[]> {
  const res = await fetchTeamApi(`/v1/teams/${teamId}/object_prefs`, { method: "GET" });
  if (!res.ok) throw new Error(i18n.t("common.error.failedToListTeamObjectPrefs", { status: res.status }));
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
  if (!res.ok) throw new Error(i18n.t("common.error.failedToSaveTeamObjectPref", { status: res.status }));
}

export async function deleteTeamObjectPref(teamId: string, objectId: string): Promise<void> {
  const res = await fetchTeamApi(`/v1/teams/${teamId}/object_prefs/${objectId}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(i18n.t("common.error.failedToDeleteTeamObjectPref", { status: res.status }));
  }
}

export async function listTeamSecrets(teamId: string): Promise<TeamSecretRecord[]> {
  const res = await fetchTeamApi(`/v1/teams/${teamId}/secrets`, { method: "GET" });
  if (!res.ok) throw new Error(i18n.t("common.error.failedToListTeamSecrets", { status: res.status }));
  return res.json();
}

export async function upsertTeamSecret(teamId: string, secret: UpsertTeamSecret): Promise<void> {
  const res = await fetchTeamApi(`/v1/teams/${teamId}/secrets`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(secret),
  });
  if (!res.ok) throw new Error(i18n.t("common.error.failedToSaveTeamSecret", { status: res.status }));
}

/** 404 is success: the secret is already gone from the vault. */
export async function deleteTeamSecret(teamId: string, secretId: string): Promise<void> {
  const res = await fetchTeamApi(`/v1/teams/${teamId}/secrets/${encodeURIComponent(secretId)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(i18n.t("common.error.failedToDeleteTeamSecret", { status: res.status }));
  }
}
