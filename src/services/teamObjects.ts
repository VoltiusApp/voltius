import i18n from "@/i18n";
import { appFetch } from "@/services/http";
import { getJwt, getServerUrl, isJwtExpiredOrExpiring, tryRefreshJwt } from "@/services/authTokens";
import { clientHeaders } from "@/services/clientHeaders";
import type { RuleEntry } from "@/services/permissions";

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
  rule_set_id?: string | null;
  my_permissions?: number;
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
  rule_set_id?: string | null;
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

  const capability = await clientHeaders();
  const makeHeaders = (token: string) => ({
    ...capability,
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

async function ruleSetRequest(teamId: string, path: string, init: RequestInit, messageKey: string): Promise<Response> {
  const res = await fetchTeamApi(`/v1/teams/${teamId}/rule-sets${path}`, {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  if (res.status === 413) throw apiError(i18n.t("common.error.tooManyRuleEntries"), { status: 413 });
  await ensureOk(res, messageKey);
  return res;
}

export async function createRuleSet(teamId: string, entries: RuleEntry[]): Promise<string> {
  const res = await ruleSetRequest(teamId, "", { method: "POST", body: JSON.stringify({ entries }) }, "common.error.failedToSaveRuleSet");
  return ((await res.json()) as { id: string }).id;
}

export async function copyRuleSet(teamId: string, setId: string): Promise<string> {
  const res = await ruleSetRequest(teamId, `/${setId}/copy`, { method: "POST" }, "common.error.failedToSaveRuleSet");
  return ((await res.json()) as { id: string }).id;
}

export async function getRuleSet(teamId: string, setId: string): Promise<RuleEntry[]> {
  const res = await ruleSetRequest(teamId, `/${setId}`, { method: "GET" }, "common.error.failedToLoadRuleSet");
  return ((await res.json()) as { entries: RuleEntry[] }).entries;
}

export async function putRuleSet(teamId: string, setId: string, entries: RuleEntry[]): Promise<void> {
  await ruleSetRequest(teamId, `/${setId}`, { method: "PUT", body: JSON.stringify({ entries }) }, "common.error.failedToSaveRuleSet");
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

/**
 * Rotation's secrets-side bulk rewrite: updates ciphertext + key_version only,
 * no audit stamp, one broadcast per batch. Sibling of reencryptTeamObjects.
 */
export async function reencryptTeamSecrets(
  teamId: string,
  items: { secret_id: string; ciphertext: string; key_version: number }[],
): Promise<void> {
  const res = await fetchTeamApi(`/v1/teams/${teamId}/secrets/reencrypt`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(items),
  });
  await ensureOk(res, "common.error.failedToSaveTeamSecret");
}
