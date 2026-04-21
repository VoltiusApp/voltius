/**
 * Team vault sync service.
 *
 * Manages the shared AES-256-GCM key per team (stored as wrapped copies per
 * member in the server's `team_vault_keys` table) and the shared CRDT blob
 * stored in `team_sync_blobs`.
 *
 * Flow:
 *   - On first "Enable sharing": initTeamVaultKey()  ← generates + stores the key
 *   - On add member:             distributeKeyToNewMember()  ← wraps for new user
 *   - After any local mutation:  pushTeamBlob()  ← CRDT-merge + encrypt + upload
 *   - On SSE event / login:      pullAndMergeTeam()  ← download + decrypt + merge
 */

import { invoke } from "@tauri-apps/api/core";
import { useVaultStore } from "@/stores/vaultStore";
import { mergeEntities, mergeSecrets, type TimestampedEntity } from "@/services/crdt";
import { wrapSessionKeyForUser, unwrapSessionKey, getMyX25519Keypair } from "@/services/multiplayerService";
import * as teamService from "@/services/teamService";
import type { TeamMember } from "@/services/teamService";
import { ENTITY_FILES } from "@/services/sync";

// ─── Re-export types needed by consumers ─────────────────────────────────────

export type { TeamMember };

// ─── Internal types ───────────────────────────────────────────────────────────

interface BlobPayload {
  files: Record<string, string>;
  secrets: Record<string, string>;
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

async function fetchWithAuth(url: string, init: RequestInit): Promise<Response> {
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

// ─── Key management ───────────────────────────────────────────────────────────

/**
 * Generate a fresh 32-byte team vault key, store it in the keychain, and
 * upload wrapped copies for each existing member (plus self) to the server.
 *
 * Call this once when a vault first has sharing enabled. There are typically
 * no other members yet at that point, but the function handles the general
 * case so it can also be called to recover / re-initialise a missing key.
 */
export async function initTeamVaultKey(
  teamId: string,
  members: TeamMember[],
): Promise<void> {
  // Reuse cached key if present — avoids regenerating a new key and breaking
  // blobs that were already encrypted with the old key. Only generate a fresh
  // key on the very first call (no cache entry exists yet).
  const cached = await invoke<string | null>("keychain_get", { key: `team_vault_key_${teamId}` });
  let rawKey: Uint8Array;
  if (cached) {
    rawKey = Uint8Array.from(atob(cached), (c) => c.charCodeAt(0));
  } else {
    rawKey = crypto.getRandomValues(new Uint8Array(32));
    await invoke("keychain_set", {
      key: `team_vault_key_${teamId}`,
      value: btoa(String.fromCharCode(...rawKey)),
    });
  }
  const keyBytes = Array.from(rawKey);

  // Ensure our own public key is up-to-date on the server
  const { publicKey: myPublicKey } = await getMyX25519Keypair();
  await teamService.updatePublicKey(myPublicKey);

  // Wrap for self: we wrap using our own public key so we can unwrap later
  // (even though we also cache it locally, this ensures consistency)
  const myWrappedKey = await wrapSessionKeyForUser(rawKey, myPublicKey);

  const myUserId = await teamService.getMyUserId();
  if (!myUserId) throw new Error("Not authenticated");

  const keys: { user_id: string; wrapped_key: string }[] = [
    { user_id: myUserId, wrapped_key: myWrappedKey },
  ];

  // Wrap for each other member
  for (const member of members) {
    if (member.user_id === myUserId) continue;
    if (!member.public_key) continue;
    const wrapped = await wrapSessionKeyForUser(rawKey, member.public_key);
    keys.push({ user_id: member.user_id, wrapped_key: wrapped });
  }

  const serverUrl = await getServerUrl();
  if (!serverUrl) throw new Error("Not connected to server");

  const res = await fetchWithAuth(`${serverUrl}/v1/teams/${teamId}/vault-key`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys }),
  });
  if (!res.ok) throw new Error(`Failed to upload vault keys: ${res.status}`);

  void keyBytes; // consumed above via rawKey / Array.from
}

/**
 * Retrieve the team vault key as a number[] (for passing to Rust invoke calls).
 *
 * Resolution order:
 * 1. Local keychain cache (fast path, avoids server round-trip).
 * 2. Server: GET wrapped key + unwrap with own X25519 private key.
 *
 * Throws if the key is not found anywhere (team was created before this feature
 * shipped — caller should then call initTeamVaultKey).
 */
export async function getTeamVaultKey(teamId: string): Promise<number[]> {
  // 1. Check keychain
  const cached = await invoke<string | null>("keychain_get", {
    key: `team_vault_key_${teamId}`,
  });
  if (cached) {
    const bytes = Uint8Array.from(atob(cached), (c) => c.charCodeAt(0));
    return Array.from(bytes);
  }

  // 2. Fetch from server and unwrap
  const serverUrl = await getServerUrl();
  if (!serverUrl) throw new Error("Not connected to server");

  const res = await fetchWithAuth(`${serverUrl}/v1/teams/${teamId}/vault-key`, {
    method: "GET",
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error(`team_vault_key_not_found:${teamId}`);
    throw new Error(`Failed to fetch vault key: ${res.status}`);
  }

  const { wrapped_key, wrapped_by_user_id } = await res.json() as {
    wrapped_key: string;
    wrapped_by_user_id: string;
  };

  // Look up the wrapping user's public key from team members
  const members = await teamService.listMembers(teamId);
  const wrapper = members.find((m) => m.user_id === wrapped_by_user_id);
  if (!wrapper) throw new Error("Wrapping user not found in team");

  const rawKey = await unwrapSessionKey(wrapped_key, wrapper.public_key);

  // Cache for future use
  await invoke("keychain_set", {
    key: `team_vault_key_${teamId}`,
    value: btoa(String.fromCharCode(...rawKey)),
  });

  return Array.from(rawKey);
}

/**
 * Wrap the team vault key for a newly added member and upload it to the server.
 * Called from teamStore after addMember/addMemberById once the member list is refreshed.
 */
export async function distributeKeyToNewMember(
  teamId: string,
  memberUserId: string,
  memberPublicKey: string,
): Promise<void> {
  if (!memberPublicKey) {
    // Member hasn't set a public key yet (hasn't logged in) — skip silently
    return;
  }

  let rawKey: number[];
  try {
    rawKey = await getTeamVaultKey(teamId);
  } catch {
    // Key not initialised yet — nothing to distribute
    return;
  }

  const rawKeyBytes = new Uint8Array(rawKey);
  const wrapped = await wrapSessionKeyForUser(rawKeyBytes, memberPublicKey);

  const serverUrl = await getServerUrl();
  if (!serverUrl) throw new Error("Not connected to server");

  const res = await fetchWithAuth(`${serverUrl}/v1/teams/${teamId}/vault-key`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys: [{ user_id: memberUserId, wrapped_key: wrapped }] }),
  });
  if (!res.ok) throw new Error(`Failed to distribute vault key: ${res.status}`);
}

// ─── Team blob push / pull ────────────────────────────────────────────────────

/**
 * Push the current local team-vault entities to the server.
 *
 * Steps:
 *   1. Export full local state.
 *   2. Filter to entities whose vault_ids include teamId.
 *   3. GET the current server blob; if it exists, decrypt + parse it.
 *   4. CRDT-merge local team entities with server team entities.
 *   5. Encrypt the merged payload with the team vault key.
 *   6. PUT to /v1/teams/:teamId/sync-blob.
 */
export async function pushTeamBlob(teamId: string): Promise<void> {
  const teamKey = await getTeamVaultKey(teamId);

  const serverUrl = await getServerUrl();
  if (!serverUrl) throw new Error("Not connected to server");

  // Export full local state (unencrypted)
  const localPayload = await invoke<BlobPayload>("state_export_raw");

  // Filter each entity file to entities belonging to this team vault
  const localTeamFiles: Record<string, string> = {};
  for (const file of ENTITY_FILES) {
    const entities: (TimestampedEntity & { vault_id?: string })[] = (() => {
      try { return JSON.parse(localPayload.files[file] ?? "[]"); }
      catch { return []; }
    })();
    const teamEntities = entities.filter((e) => e.vault_id === teamId);
    localTeamFiles[file] = JSON.stringify(teamEntities);
  }


  // Fetch and decrypt current server blob (for CRDT merge to avoid overwriting)
  let serverTeamFiles: Record<string, string> = Object.fromEntries(
    ENTITY_FILES.map((f) => [f, "[]"]),
  );

  const blobRes = await fetchWithAuth(`${serverUrl}/v1/teams/${teamId}/sync-blob`, {
    method: "GET",
  });
  if (blobRes.ok) {
    const { blob: blobB64 } = await blobRes.json() as { blob: string; updated_at: string };
    const blobBytes = base64ToBytes(blobB64);
    try {
      const remotePayload = await invoke<BlobPayload>("backup_decrypt", {
        encKey: teamKey,
        blob: blobBytes,
      });
      serverTeamFiles = remotePayload.files;
    } catch {
      // Corrupted or unreadable blob — proceed with local-only state
    }
  }

  // CRDT-merge: local wins on conflict for own entities, server wins for others
  const mergedFiles: Record<string, string> = {};
  for (const file of ENTITY_FILES) {
    const parse = (s: string): TimestampedEntity[] => {
      try { return JSON.parse(s); } catch { return []; }
    };
    const merged = mergeEntities(parse(localTeamFiles[file]), parse(serverTeamFiles[file]));
    mergedFiles[file] = JSON.stringify(merged);
  }

  // Secrets: only include secrets for entities in this team vault (by key prefix if any)
  // For simplicity, we sync all secrets — they are E2EE-protected anyway
  const mergedSecrets = localPayload.secrets ?? {};

  // Encrypt merged payload
  const encryptedBlob: number[] = await invoke("encrypt_payload", {
    encKey: teamKey,
    files: mergedFiles,
    secrets: mergedSecrets,
  });

  const res = await fetchWithAuth(`${serverUrl}/v1/teams/${teamId}/sync-blob`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blob: bytesToBase64(encryptedBlob) }),
  });
  if (!res.ok) throw new Error(`Failed to push team blob: ${res.status}`);
}

/**
 * Pull the team blob from the server, decrypt it, CRDT-merge with full local
 * state, and write the merged result back to disk.
 *
 * Returns true if the remote blob contained data newer than local state.
 * Returns false if the team has no blob yet (404) or nothing changed.
 */
export async function pullAndMergeTeam(teamId: string): Promise<boolean> {
  const teamKey = await getTeamVaultKey(teamId);

  const serverUrl = await getServerUrl();
  if (!serverUrl) return false;

  const blobRes = await fetchWithAuth(`${serverUrl}/v1/teams/${teamId}/sync-blob`, {
    method: "GET",
  });
  if (blobRes.status === 404) return false;
  if (!blobRes.ok) throw new Error(`Failed to fetch team blob: ${blobRes.status}`);

  const { blob: blobB64 } = await blobRes.json() as { blob: string; updated_at: string };
  const blobBytes = base64ToBytes(blobB64);

  const remotePayload = await invoke<BlobPayload>("backup_decrypt", {
    encKey: teamKey,
    blob: blobBytes,
  });

  // Get full local state
  const localPayload = await invoke<BlobPayload>("state_export_raw");

  const parse = (payload: BlobPayload, file: string): TimestampedEntity[] => {
    try { return JSON.parse(payload.files[file] ?? "[]"); }
    catch { return []; }
  };

  // CRDT-merge each entity file; track whether remote had anything new
  const mergedFiles: Record<string, string> = {};
  let anyChange = false;
  for (const file of ENTITY_FILES) {
    const local = parse(localPayload, file);
    const remote = parse(remotePayload, file);
    const merged = mergeEntities(local, remote);
    mergedFiles[file] = JSON.stringify(merged);
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

// ─── Vault linkage helpers ────────────────────────────────────────────────────

/**
 * Return all teamIds that should be synced:
 * - Local vaults with a linked teamId
 * - Raw team UUIDs directly in selectedVaultIds (members who joined a team but
 *   haven't created a linked local vault yet — "standalone" team selection)
 */
export function getLinkedTeamIds(): string[] {
  const { vaults, selectedVaultIds } = useVaultStore.getState();

  const linkedIds = vaults
    .filter((v) => v.teamId != null)
    .map((v) => v.teamId as string);
  const linkedSet = new Set(linkedIds);

  // Standalone: selected IDs that are not local vault IDs and not already in linkedSet
  const vaultIdSet = new Set(vaults.map((v) => v.id));
  const standaloneIds = selectedVaultIds.filter(
    (vid) => vid !== "personal" && !vaultIdSet.has(vid) && !linkedSet.has(vid),
  );

  return [...linkedIds, ...standaloneIds];
}

