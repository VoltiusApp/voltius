import { invoke } from "@tauri-apps/api/core";
import { appFetch } from "@/services/http";
import { useSubscriptionStore } from "@/stores/subscriptionStore";

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

async function fetchTeamApi(path: string, init: RequestInit): Promise<Response> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) throw new Error("Not connected to server");

  let jwt = await getJwt();
  if (!jwt || isJwtExpiredOrExpiring(jwt)) jwt = await tryRefreshJwt();
  if (!jwt) throw new Error("Session expired — please log in again");

  const makeHeaders = (token: string) => ({
    ...(init.headers as Record<string, string>),
    Authorization: `Bearer ${token}`,
  });

  let res = await appFetch(`${serverUrl}${path}`, { ...init, headers: makeHeaders(jwt) });
  if (res.status === 401) {
    const newJwt = await tryRefreshJwt();
    if (!newJwt) throw new Error("Session expired — please log in again");
    res = await appFetch(`${serverUrl}${path}`, { ...init, headers: makeHeaders(newJwt) });
  }
  if (res.status === 403) throw new Error("You do not have permission for this team vault operation");
  if (res.status === 402) throw new Error("Team vault requires an active Teams or Business subscription");
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") ?? "60", 10);
    throw new Error(`Rate limited — retry in ${retryAfter}s`);
  }
  return res;
}

export async function listTeamObjects(teamId: string): Promise<TeamObjectRecord[]> {
  const res = await fetchTeamApi(`/v1/teams/${teamId}/objects`, { method: "GET" });
  if (!res.ok) throw new Error(`Failed to list team objects: ${res.status}`);
  return res.json();
}

export async function upsertTeamObject(teamId: string, object: UpsertTeamObject): Promise<void> {
  const res = await fetchTeamApi(`/v1/teams/${teamId}/objects`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(object),
  });
  if (!res.ok) throw new Error(`Failed to save team object: ${res.status}`);
}

export async function deleteTeamObject(teamId: string, objectId: string): Promise<void> {
  const res = await fetchTeamApi(`/v1/teams/${teamId}/objects/${objectId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete team object: ${res.status}`);
}

export async function listTeamSecrets(teamId: string): Promise<TeamSecretRecord[]> {
  const res = await fetchTeamApi(`/v1/teams/${teamId}/secrets`, { method: "GET" });
  if (!res.ok) throw new Error(`Failed to list team secrets: ${res.status}`);
  return res.json();
}

export async function upsertTeamSecret(teamId: string, secret: UpsertTeamSecret): Promise<void> {
  const res = await fetchTeamApi(`/v1/teams/${teamId}/secrets`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(secret),
  });
  if (!res.ok) throw new Error(`Failed to save team secret: ${res.status}`);
}
