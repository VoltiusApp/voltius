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
 *
 * Team objects are written per row by saveTeamVaultObject (see
 * teamObjectPersistence.ts). The legacy whole-blob writer was removed with #229:
 * uploading collected store state would turn a row this client failed to decrypt
 * into a deletion for the whole team.
 */

import { invoke } from "@tauri-apps/api/core";
import i18n from "@/i18n";
import { wrapSessionKeyForUser, unwrapSessionKey, publishMyPublicKey } from "@/services/multiplayerService";
import * as teamService from "@/services/teamService";
import { getServerUrl } from "@/services/authTokens";
import { fetchAuthRateLimited as fetchWithAuth } from "@/services/authFetch";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";
import { storeSecret, deleteSecret } from "@/services/vault";
import { logFailure } from "@/lib/logger";
import type { Connection, Identity, SshKey, Folder, Snippet, PortForwardingRule } from "@/types";
import type { TeamMember } from "@/services/teamService";
import { listTeamObjects, type TeamObjectRecord } from "@/services/teamObjects";
import {
  shouldShowBlockingTeamVaultLoad,
  TeamVaultRefreshQueue,
  type TeamVaultRefreshOptions,
} from "@/services/teamVaultRefresh";
import { classifyTeamObjectListError } from "@/services/teamVaultLoadErrors";
import {
  base64ToBytes,
  parseTeamVaultBlobFiles,
} from "@/services/teamVaultSyncCore";

export type { TeamMember };

// ─── Internal types ───────────────────────────────────────────────────────────

interface BlobPayload {
  files: Record<string, string>;
  secrets: Record<string, string>;
}

// ─── In-memory key cache (process memory only — gone on logout/close) ─────────

const _teamKeyCache = new Map<string, number[]>();
// In-flight fetch/unwrap promises, keyed by team. Without this, N concurrent
// getTeamVaultKey(teamId) calls on a cold cache (e.g. decoding N encrypted
// objects during hydration, #229) each start their own GET vault-key +
// listMembers + unwrap, stampeding the rate-limited vault-key route until it
// 429s — which callers then fold into "offline" and silently drop rows.
const _teamKeyInFlight = new Map<string, Promise<number[]>>();
// Per-team eviction generation. deleteTeamKey/clearTeamKeyCache bump it;
// getTeamVaultKey captures it before starting a fetch and only writes the
// resolved key into _teamKeyCache if the generation is still the one it
// started with. Deleting the map entry can't cancel a fetch already in
// flight — the caller that started it still holds the promise in its
// closure — so without this guard a key evicted for a kicked member (#216)
// could be written straight back into the cache moments later by a fetch
// that was already on its way when the eviction landed. Task 5 put
// getTeamVaultKey on the per-row hydrate path, which made this far more
// likely to actually happen (#229).
const _teamKeyGeneration = new Map<string, number>();
const _teamRefreshQueue = new TeamVaultRefreshQueue();

function _currentGeneration(teamId: string): number {
  return _teamKeyGeneration.get(teamId) ?? 0;
}

function _bumpGeneration(teamId: string): void {
  _teamKeyGeneration.set(teamId, _currentGeneration(teamId) + 1);
}

export function clearTeamKeyCache(): void {
  // Bump every team that could have a fetch in flight, not just the ones
  // with a resolved cache entry — an in-flight fetch has no _teamKeyCache
  // row yet but must still be invalidated.
  const teamIds = new Set([..._teamKeyCache.keys(), ..._teamKeyInFlight.keys(), ..._teamKeyGeneration.keys()]);
  for (const teamId of teamIds) _bumpGeneration(teamId);
  _teamKeyCache.clear();
  _teamKeyInFlight.clear();
}

export function deleteTeamKey(teamId: string): void {
  _bumpGeneration(teamId);
  _teamKeyCache.delete(teamId);
  _teamKeyInFlight.delete(teamId);
}

// ─── Key management ───────────────────────────────────────────────────────────

/**
 * Get the team vault key as number[]. Hits in-memory cache first, then fetches
 * from server and unwraps with the local X25519 private key.
 *
 * Throws typed string errors for callers to route to the right UX state:
 *   "offline"          — network error or navigator.onLine === false
 *   "forbidden"        — server returned 403 (removed from the team, or the
 *                        caller's role lacks VIEW_SECRETS — callers that can
 *                        tell the two apart should; see fetchTeamData)
 *   "payment_required" — server returned 402 (subscription lapsed)
 *   "awaiting_key"     — server returned 404 (no wrapped key for this member yet)
 *   "key_mismatch"     — the key arrived but this device's identity cannot open
 *                        it; retrying cannot help, unlike "error" (#228)
 *   "error"            — anything else, including a key evicted by
 *                        deleteTeamKey/clearTeamKeyCache while this fetch was
 *                        still in flight (e.g. #216's kick eviction)
 */
export async function getTeamVaultKey(teamId: string): Promise<number[]> {
  const cached = _teamKeyCache.get(teamId);
  if (cached) return cached;

  // Join whatever fetch is already in flight for this team instead of
  // starting a second one — see the comment on _teamKeyInFlight above.
  const existing = _teamKeyInFlight.get(teamId);
  if (existing) return existing;

  // The generation guard has to live inside the shared promise itself, not
  // in a check the initiating caller runs after its own await: every
  // concurrent joiner above returns this same promise object directly and
  // never runs any code of its own after it resolves, so a check outside
  // this chain would only protect the caller that happened to start the
  // fetch.
  const generation = _currentGeneration(teamId);
  const inFlight = _fetchAndUnwrapTeamVaultKey(teamId).then((keyBytes) => {
    // The key was evicted (deleteTeamKey/clearTeamKeyCache) while this fetch
    // was on the wire — most importantly, a member just kicked from the team
    // (#216). Do not resurrect it into the cache, and do not hand it back to
    // any caller either; treat it the same as any other failed fetch.
    if (_currentGeneration(teamId) !== generation) throw "error";
    _teamKeyCache.set(teamId, keyBytes);
    return keyBytes;
  });
  _teamKeyInFlight.set(teamId, inFlight);
  // Detached cleanup subscriber: always drop the in-flight entry once the
  // fetch settles (success or failure) so a later call can retry after a
  // transient error instead of being poisoned by it. The `.catch` here only
  // silences this derived chain — callers still observe the rejection via
  // their own `await inFlight`/`await getTeamVaultKey(...)`.
  inFlight.finally(() => _teamKeyInFlight.delete(teamId)).catch(() => {});

  return inFlight;
}

async function _fetchAndUnwrapTeamVaultKey(teamId: string): Promise<number[]> {
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
  if (res.status === 404) throw "awaiting_key";
  if (!res.ok) throw "error";

  const { wrapped_key, wrapped_by_user_id } = await res.json() as {
    wrapped_key: string;
    wrapped_by_user_id: string;
  };

  const members = await teamService.listMembers(teamId);
  const wrapper = members.find((m) => m.user_id === wrapped_by_user_id);
  if (!wrapper) throw "error";

  let rawKey: Uint8Array;
  try {
    rawKey = await unwrapSessionKey(wrapped_key, wrapper.public_key);
  } catch {
    throw "key_mismatch";
  }
  return Array.from(rawKey);
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
    if (err !== "awaiting_key") throw new Error(i18n.t("common.error.keyFetchFailed", { error: String(err) }));
    rawKey = crypto.getRandomValues(new Uint8Array(32));
  }

  const myPublicKey = await publishMyPublicKey();

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

/**
 * Reconcile vault-key distribution for a team (issue #41).
 *
 * Distribution is otherwise purely event-driven (team creation + the live
 * `team_members` SSE diff), so a member who joins while the only key-holder is
 * offline — or the very first invitee, whom the adder's own event never counts
 * as "new" — is left with no key and silently locked out. This closes that gap:
 * whenever a key-holder loads a team (login) or sees a membership change, it
 * compares `team_members` against the server's key-holder list and wraps the key
 * for anyone missing it.
 *
 * Safe to call on any team: if this client can't unwrap the key itself it isn't
 * a key-holder and returns immediately. Only genuinely keyless members trigger a
 * PUT, so repeated calls don't churn or re-notify existing holders.
 */
export async function reconcileTeamVaultKeys(teamId: string): Promise<void> {
  // Only a key-holder can distribute. Bail before touching the network for
  // anything else if we can't obtain the raw key ourselves.
  try {
    await getTeamVaultKey(teamId);
  } catch {
    return;
  }

  let members: TeamMember[];
  let holders: Set<string>;
  let myUserId: string | null;
  try {
    [members, holders, myUserId] = await Promise.all([
      teamService.listMembers(teamId),
      teamService.getVaultKeyHolders(teamId).then((ids) => new Set(ids)),
      teamService.getMyUserId(),
    ]);
  } catch {
    return;
  }

  const missing = members.filter(
    (m) => m.public_key && m.user_id !== myUserId && !holders.has(m.user_id),
  );
  if (missing.length === 0) return;

  await Promise.allSettled(
    missing.map((m) => distributeKeyToNewMember(teamId, m.user_id, m.public_key)),
  );
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
    await clearTeamStoresAndSecrets(teamId);
    stateStore.setStatus(teamId, "offline");
    return;
  }

  try {
    const objects = await listTeamObjects(teamId);
    if (objects.length > 0) {
      await _hydrateTeamObjectStores(teamId, objects);
      // Background migration of rows predating #229. Never blocks the load, and
      // a failure leaves the remaining rows for the next connect.
      void import("@/services/teamObjectReencrypt")
        .then(({ runReencryptionPass }) => runReencryptionPass(teamId, objects))
        .catch(() => {});
      const { backfillExistingTeamVaultSecrets, hydrateTeamVaultSecrets } = await import("@/services/teamVaultSecrets");
      // Credentials are what makes a host connectable, so a failure here is not
      // cosmetic: the vault renders fully populated and every host needing a
      // stored secret then fails at authentication. Record it instead of
      // swallowing it (issue #190).
      const credentialsOk = await hydrateTeamVaultSecrets(teamId).then(() => true, () => false);
      stateStore.setCredentialsUnavailable(teamId, !credentialsOk);
      if (!options.background) await backfillExistingTeamVaultSecrets(teamId).catch(() => {});
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
      await clearTeamStoresAndSecrets(teamId);
      stateStore.setStatus(teamId, action);
      return;
    }
  }

  let key: number[];
  try {
    key = await getTeamVaultKey(teamId);
  } catch (err) {
    if (options.background) return;
    const validStatuses = ["offline", "forbidden", "payment_required", "awaiting_key", "key_mismatch", "error"] as const;
    type Thrown = typeof validStatuses[number];
    let status: Thrown | "loaded" = validStatuses.includes(err as Thrown) ? (err as Thrown) : "error";
    // A 403 here means one of two very different things: the caller was removed
    // from the team, or their role simply lacks VIEW_SECRETS (connect-only,
    // issue #187). The route cannot tell them apart, but the client can — a
    // revoked member no longer has the team in their own team list. A 403 while
    // the team is still listed is a role restriction, and such a member reads
    // this vault through the object routes only: the empty list they just got
    // IS their view of the vault, so show it rather than a false revocation.
    if (status === "forbidden" && (await _isStillATeamMember(teamId))) {
      status = "loaded";
    }
    // Clear team store slices so stale data doesn't linger
    await clearTeamStoresAndSecrets(teamId);
    stateStore.setStatus(teamId, status);
    return;
  }

  let blobPayload: BlobPayload;
  try {
    const res = await fetchWithAuth(`${serverUrl}/v1/teams/${teamId}/sync-blob`, { method: "GET" });
    if (res.status === 404) {
      // No blob yet — owner hasn't pushed data. Show as empty vault.
      if (options.background) return;
      await clearTeamStoresAndSecrets(teamId);
      stateStore.setStatus(teamId, "loaded");
      return;
    }
    if (!res.ok) {
      if (options.background) return;
      await clearTeamStoresAndSecrets(teamId);
      stateStore.setStatus(teamId, "error");
      return;
    }
    const { blob: blobB64 } = await res.json() as { blob: string; updated_at: string };
    const blobBytes = base64ToBytes(blobB64);
    blobPayload = await invoke<BlobPayload>("backup_decrypt", { encKey: key, blob: blobBytes });
  } catch {
    if (options.background) return;
    await clearTeamStoresAndSecrets(teamId);
    stateStore.setStatus(teamId, "error");
    return;
  }

  const { useConnectionStore } = await import("@/stores/connectionStore");
  const { useIdentityStore } = await import("@/stores/identityStore");
  const { useKeyStore } = await import("@/stores/keyStore");
  const { useFolderStore } = await import("@/stores/folderStore");
  const { useSnippetStore } = await import("@/stores/snippetStore");
  const { useSnippetFolderStore } = await import("@/stores/snippetFolderStore");
  const { usePortForwardingStore } = await import("@/stores/portForwardingStore");

  const slices = parseTeamVaultBlobFiles(blobPayload.files);
  useConnectionStore.getState().setTeamConnections(teamId, slices.connections as Connection[]);
  useIdentityStore.getState().setTeamIdentities(teamId, slices.identities as Identity[]);
  useKeyStore.getState().setTeamKeys(teamId, slices.keys as SshKey[]);
  useFolderStore.getState().setTeamFolders(teamId, slices.folders as Folder[]);
  useSnippetStore.getState().setTeamSnippets(teamId, slices.snippets as Snippet[]);
  useSnippetFolderStore.getState().setTeamSnippetFolders(teamId, slices.snippetFolders as Folder[]);
  usePortForwardingStore.getState().setTeamRules(teamId, slices.portForwardingRules as PortForwardingRule[]);

  for (const [k, v] of Object.entries(blobPayload.secrets ?? {})) {
    await storeSecret(k, v).catch(() => {});
  }

  stateStore.setStatus(teamId, "loaded");
}

/**
 * True when the client still lists `teamId` among the caller's teams. The
 * server drops revoked teams from that list and `onTeamRemoved` clears the
 * store, so this separates "your role can't do that" from "you were removed".
 */
async function _isStillATeamMember(teamId: string): Promise<boolean> {
  const { useTeamStore } = await import("@/stores/teamStore");
  return useTeamStore.getState().teams.some((t) => t.id === teamId);
}

export async function _hydrateTeamObjectStores(teamId: string, objects: TeamObjectRecord[]): Promise<void> {
  const active = objects.filter((o) => !o.deleted_at);

  const { decodeObjectMetadata } = await import("@/services/teamObjectEnvelope");

  // Rows written before #229 carry plaintext metadata and decode to themselves.
  // A row that will not decrypt is dropped rather than spread: a half-object
  // with no id or host is worse in the stores than an absent one, and it would
  // be written straight back on the next save.
  const decoded = await Promise.all(
    active.map(async (o) => {
      const metadata = await decodeObjectMetadata(teamId, o.metadata).catch(() => null);
      return metadata === null ? null : { ...o, metadata };
    }),
  );

  const usable = decoded.filter((o): o is TeamObjectRecord & { metadata: object } => o !== null);

  const byType = <T>(type: TeamObjectRecord["object_type"]): T[] =>
    usable
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
 * Deletes `keys` from the keychain, returning the ones that did not go away.
 *
 * `Promise.allSettled` on its own made a partial wipe indistinguishable from a
 * clean one: a rejected delete leaves the plaintext secret on disk and nothing
 * recorded that it did (issue #233).
 */
async function deleteSecrets(keys: string[]): Promise<string[]> {
  const results = await Promise.allSettled(keys.map((k) => deleteSecret(k)));
  const failed: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      failed.push(keys[i]);
      logFailure(`keychain wipe of ${keys[i]}`)(r.reason);
    }
  });
  return failed;
}

/**
 * Retries keychain deletions left over from a failed offboarding wipe.
 *
 * Called once per login. A team the user belongs to again is dropped without
 * deleting anything: those entries have since been re-hydrated for a live
 * vault, and the queue only ever meant "these should not be on this device".
 */
export async function drainPendingSecretWipes(): Promise<void> {
  const { usePendingSecretWipeStore } = await import("@/stores/pendingSecretWipeStore");
  const { useTeamStore } = await import("@/stores/teamStore");
  const store = usePendingSecretWipeStore.getState();
  const currentTeamIds = new Set(useTeamStore.getState().teams.map((t) => t.id));

  for (const [teamId, keys] of Object.entries(store.keysByTeamId)) {
    if (currentTeamIds.has(teamId)) {
      store.resolve(teamId, keys);
      continue;
    }
    const failed = new Set(await deleteSecrets(keys));
    store.resolve(teamId, keys.filter((k) => !failed.has(k)));
  }
}

/**
 * Empties the team's store slices and wipes its secrets from the keychain.
 * Returns the keychain keys that survived the wipe — a caller offboarding the
 * user from the team must treat a non-empty result as secrets still on disk.
 */
export async function clearTeamStoresAndSecrets(teamId: string): Promise<string[]> {
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
  const failedKeys = await deleteSecrets([
    ...conns.flatMap((c) => [`key:${c.id}`, `password:${c.id}`, `passphrase:${c.id}`]),
    ...keys.flatMap((k) => [`key:${k.id}:private`, `key:${k.id}:public`, `key:${k.id}:passphrase`]),
    ...identities.map((i) => `identity:${i.id}:password`),
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

  return failedKeys;
}
