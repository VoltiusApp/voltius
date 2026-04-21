import { invoke } from "@tauri-apps/api/core";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getJwt(): Promise<string | null> {
  return invoke<string | null>("keychain_get", { key: "jwt" });
}

async function getServerUrl(): Promise<string | null> {
  return invoke<string | null>("keychain_get", { key: "server_url" });
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
  const res = await fetch(`${serverUrl}/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) return null;
  const { jwt_token } = await res.json();
  await invoke("keychain_set", { key: "jwt", value: jwt_token });
  return jwt_token;
}

async function fetchAuth(url: string, init: RequestInit = {}): Promise<Response> {
  let jwt = await getJwt();
  if (!jwt || isJwtExpiredOrExpiring(jwt)) {
    jwt = await tryRefreshJwt();
    if (!jwt) throw new Error("Session expired — please log in again");
  }
  const makeHeaders = (token: string) => ({
    ...(init.headers as Record<string, string>),
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  });
  let res = await fetch(url, { ...init, headers: makeHeaders(jwt) });
  if (res.status === 401) {
    const newJwt = await tryRefreshJwt();
    if (!newJwt) throw new Error("Session expired — please log in again");
    res = await fetch(url, { ...init, headers: makeHeaders(newJwt) });
  }
  return res;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Team {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  role: string;
}

export interface TeamMember {
  team_id: string;
  user_id: string;
  role: string;
  invited_by: string | null;
  joined_at: string;
  email: string;
  public_key: string;
  custom_role_id: string | null;
  custom_role_name: string | null;
  custom_role_permissions: number | null;
}

export interface CustomRole {
  id: string;
  team_id: string;
  name: string;
  permissions: number;
  created_at: string;
}

// ─── API calls ────────────────────────────────────────────────────────────────

export async function createTeam(name: string): Promise<Team> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) throw new Error("Not connected to server");
  const res = await fetchAuth(`${serverUrl}/v1/teams`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Failed to create team: ${res.status}`);
  return res.json();
}

export async function listTeams(): Promise<Team[]> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) return [];
  const res = await fetchAuth(`${serverUrl}/v1/teams`);
  if (!res.ok) return [];
  return res.json();
}

export async function listMembers(teamId: string): Promise<TeamMember[]> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) throw new Error("Not connected to server");
  const res = await fetchAuth(`${serverUrl}/v1/teams/${teamId}/members`);
  if (!res.ok) throw new Error(`Failed to list members: ${res.status}`);
  return res.json();
}

export async function addMember(
  teamId: string,
  /** Invite by email address */
  email: string,
  role?: string,
): Promise<void> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) throw new Error("Not connected to server");
  const res = await fetchAuth(`${serverUrl}/v1/teams/${teamId}/members`, {
    method: "POST",
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error("User not found — they must have a Voltius account");
    throw new Error(`Failed to add member: ${res.status}`);
  }
}

export async function addMemberById(
  teamId: string,
  userId: string,
  role?: string,
): Promise<void> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) throw new Error("Not connected to server");
  const res = await fetchAuth(`${serverUrl}/v1/teams/${teamId}/members`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId, role }),
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error("User not found");
    if (res.status === 400) throw new Error("Cannot add yourself");
    throw new Error(`Failed to add member: ${res.status}`);
  }
}

export async function updateMemberRole(
  teamId: string,
  userId: string,
  role: string,
): Promise<void> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) throw new Error("Not connected to server");
  const res = await fetchAuth(`${serverUrl}/v1/teams/${teamId}/members/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
  if (!res.ok) {
    if (res.status === 403) throw new Error("Only the team owner can change roles");
    throw new Error(`Failed to update role: ${res.status}`);
  }
}

export async function assignCustomRole(
  teamId: string,
  userId: string,
  customRoleId: string,
): Promise<void> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) throw new Error("Not connected to server");
  const res = await fetchAuth(`${serverUrl}/v1/teams/${teamId}/members/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ custom_role_id: customRoleId }),
  });
  if (!res.ok) {
    if (res.status === 403) throw new Error("Only the team owner can change roles");
    throw new Error(`Failed to assign custom role: ${res.status}`);
  }
}

// ─── Custom roles CRUD ────────────────────────────────────────────────────────

export async function listCustomRoles(teamId: string): Promise<CustomRole[]> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) return [];
  const res = await fetchAuth(`${serverUrl}/v1/teams/${teamId}/roles`);
  if (!res.ok) return [];
  return res.json();
}

export async function createCustomRole(
  teamId: string,
  name: string,
  permissions: number,
): Promise<CustomRole> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) throw new Error("Not connected to server");
  const res = await fetchAuth(`${serverUrl}/v1/teams/${teamId}/roles`, {
    method: "POST",
    body: JSON.stringify({ name, permissions }),
  });
  if (!res.ok) {
    if (res.status === 409) throw new Error("A role with this name already exists");
    throw new Error(`Failed to create role: ${res.status}`);
  }
  return res.json();
}

export async function updateCustomRole(
  teamId: string,
  roleId: string,
  updates: { name?: string; permissions?: number },
): Promise<void> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) throw new Error("Not connected to server");
  const res = await fetchAuth(`${serverUrl}/v1/teams/${teamId}/roles/${roleId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Failed to update role: ${res.status}`);
}

export async function deleteCustomRole(teamId: string, roleId: string): Promise<void> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) throw new Error("Not connected to server");
  const res = await fetchAuth(`${serverUrl}/v1/teams/${teamId}/roles/${roleId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    if (res.status === 409) throw new Error("Role is still assigned to one or more members");
    throw new Error(`Failed to delete role: ${res.status}`);
  }
}

export async function searchUsers(q: string): Promise<{ user_id: string; email: string; public_key: string }[]> {
  if (q.length < 2) return [];
  const serverUrl = await getServerUrl();
  if (!serverUrl) return [];
  const res = await fetchAuth(`${serverUrl}/v1/users/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  return res.json();
}

export async function removeMember(teamId: string, userId: string): Promise<void> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) throw new Error("Not connected to server");
  const res = await fetchAuth(`${serverUrl}/v1/teams/${teamId}/members/${userId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to remove member: ${res.status}`);
}

export async function updatePublicKey(publicKey: string): Promise<void> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) throw new Error("Not connected to server");
  const res = await fetchAuth(`${serverUrl}/v1/auth/public-key`, {
    method: "PUT",
    body: JSON.stringify({ public_key: publicKey }),
  });
  if (!res.ok) throw new Error(`Failed to update public key: ${res.status}`);
}

export async function getJwtToken(): Promise<string | null> {
  return getJwt();
}

/** Returns the current user's server UUID (from the JWT `sub` claim), or null if not logged in. */
export async function getMyUserId(): Promise<string | null> {
  const jwt = await getJwt();
  if (!jwt) return null;
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1]));
    return (payload.sub as string) ?? null;
  } catch {
    return null;
  }
}

export async function getServerUrlValue(): Promise<string | null> {
  return getServerUrl();
}
