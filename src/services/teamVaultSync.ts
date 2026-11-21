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

import { invoke } from "@/lib/invoke";
import i18n from "@/i18n";
import { wrapSessionKeyForUser, unwrapSessionKey, publishMyPublicKey } from "@/services/multiplayerService";
import * as teamService from "@/services/teamService";
import { getServerUrl } from "@/services/authTokens";
import { fetchAuthRateLimited as fetchWithAuth } from "@/services/authFetch";
import { undecryptableTotal, useTeamVaultStateStore, type TeamVaultStatus } from "@/stores/teamVaultStateStore";
import type { DecodeFailureCounts } from "@/services/teamObjectRows";
import { purgeLocalSecrets } from "@/services/vault";
import { teamSecretCache } from "@/services/teamSecretCache";
import { logFailure } from "@/lib/logger";
import { listedDataVersion, noteTeamDataSeen } from "@/services/teamVaultCatchUp";
import type { Connection, Identity, SshKey, Folder, Snippet, PortForwardingRule } from "@/types";
import type { TeamMember } from "@/services/teamService";
import { listTeamObjects, type TeamObjectRecord } from "@/services/teamObjects";
import {
  shouldShowBlockingTeamVaultLoad,
  TeamVaultRefreshQueue,
  type TeamVaultRefreshOptions,
} from "@/services/teamVaultRefresh";
import { classifyTeamObjectListError, isAccessRevoked, isTeamKeyError } from "@/services/teamVaultLoadErrors";
import {
  base64ToByteArray,
  bytesToBase64,
  parseTeamVaultBlobFiles,
} from "@/services/teamVaultSyncCore";

export type { TeamMember };

// ─── Internal types ───────────────────────────────────────────────────────────

interface BlobPayload {
  files: Record<string, string>;
  secrets: Record<string, string>;
}

// ─── In-memory key cache (process memory only — gone on logout/close) ─────────

export interface TeamKey {
  key: number[];
  version: number;
}

// Key and epoch live in one entry so no caller can pair a key with another key's epoch.
const _teamKeyCache = new Map<string, TeamKey>();
// In-flight fetch/unwrap promises, keyed by team. Without this, N concurrent
// getTeamVaultKey(teamId) calls on a cold cache (e.g. decoding N encrypted
// objects during hydration, #229) each start their own GET vault-key +
// listMembers + unwrap, stampeding the rate-limited vault-key route until it
// 429s — which callers then fold into "offline" and silently drop rows.
const _teamKeyInFlight = new Map<string, Promise<TeamKey>>();
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
const _teamRefreshQueue = new TeamVaultRefreshQueue<boolean>();
// Teams where a key_mismatch self-heal rotation was already tried this
// session — caps retries at one instead of one per refresh forever.
const _keyMismatchHealAttempted = new Set<string>();

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
  // This is the session-end wipe (logout/vault lock, see teamDataManager's
  // onSessionEnd) — raw historical DEKs must not survive it either, even
  // though deleteTeamKey (the per-team epoch-change eviction) deliberately
  // leaves these alone: a single team's epoch changing has no bearing on
  // another epoch's key.
  _teamKeyAtVersionCache.clear();
  _teamKeyAtVersionInFlight.clear();
  _keyMismatchHealAttempted.clear();
  _keyConflictLogged.clear();
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
  return (await getCurrentTeamKey(teamId)).key;
}

/** The current epoch's key together with that epoch. Same errors as getTeamVaultKey. */
export async function getCurrentTeamKey(teamId: string): Promise<TeamKey> {
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
  const inFlight = _fetchAndUnwrapTeamVaultKey(teamId).then((fresh) => {
    // The key was evicted (deleteTeamKey/clearTeamKeyCache) while this fetch
    // was on the wire — most importantly, a member just kicked from the team
    // (#216). Do not resurrect it into the cache, and do not hand it back to
    // any caller either; treat it the same as any other failed fetch.
    if (_currentGeneration(teamId) !== generation) throw "error";
    _teamKeyCache.set(teamId, fresh);
    return fresh;
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

export type TeamKeyRevalidation = "unchanged" | "replaced" | "revoked" | "conflict";

const _TRANSIENT_KEY_ERRORS = new Set<unknown>(["offline", "error", "update_required"]);
const _keyConflictLogged = new Set<string>();

function _sameKey(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

function _noteKeyConflict(teamId: string, reason: string): TeamKeyRevalidation {
  if (!_keyConflictLogged.has(teamId)) {
    _keyConflictLogged.add(teamId);
    logFailure(`teamVaultSync: kept cached key team=${teamId}`)(new Error(reason));
  }
  return "conflict";
}

/** Re-reads this member's wrap of a cached key; only a newer epoch replaces it. */
export async function revalidateTeamVaultKey(teamId: string): Promise<TeamKeyRevalidation> {
  if (!_teamKeyCache.has(teamId)) return "unchanged";
  const generation = _currentGeneration(teamId);
  const current = (): TeamKey | undefined =>
    _currentGeneration(teamId) === generation ? _teamKeyCache.get(teamId) : undefined;

  let wrapped: WrappedTeamKey;
  try {
    wrapped = await _fetchWrappedTeamKey(_currentKeyPath(teamId));
  } catch (err) {
    if (_TRANSIENT_KEY_ERRORS.has(err) || !current()) return "unchanged";
    deleteTeamKey(teamId);
    return "revoked";
  }
  const before = current();
  if (!before || wrapped.version < before.version) return "unchanged";

  let fresh: TeamKey;
  try {
    fresh = await _unwrapTeamKey(wrapped);
  } catch (err) {
    const cached = current();
    if (err !== "key_mismatch" || !cached || wrapped.version < cached.version) return "unchanged";
    // Same epoch: the cached key still opens existing rows. Newer epoch: it must stop sealing new ones.
    if (wrapped.version === cached.version) return _noteKeyConflict(teamId, "server wrap cannot be opened");
    deleteTeamKey(teamId);
    return "revoked";
  }
  const cached = current();
  if (!cached || fresh.version < cached.version) return "unchanged";
  if (fresh.version === cached.version) {
    if (_sameKey(fresh.key, cached.key)) return "unchanged";
    // Rotation always bumps the epoch, so the cached key is the one existing rows were sealed with.
    return _noteKeyConflict(teamId, "different key under the same epoch");
  }
  _teamKeyAtVersionCache.set(`${teamId}:${cached.version}`, cached.key);
  _teamKeyCache.set(teamId, fresh);
  return "replaced";
}

let _revalidationTail: Promise<void> = Promise.resolve();
let _revalidationQueued = false;

/** One team at a time, and bursts of events collapse into one pending pass, to stay under the vault-key rate limit. */
export function revalidateCachedTeamKeys(): Promise<void> {
  if (_revalidationQueued) return _revalidationTail;
  _revalidationQueued = true;
  _revalidationTail = _revalidationTail.then(async () => {
    _revalidationQueued = false;
    for (const teamId of new Set([..._teamKeyCache.keys(), ..._teamKeyInFlight.keys()])) {
      // A fetch that left before this event may cache the epoch it replaced.
      await _teamKeyInFlight.get(teamId)?.catch(() => {});
      const outcome = await revalidateTeamVaultKey(teamId);
      // A revoked key reloads in the foreground so the vault shows why it is no longer readable.
      if (outcome === "replaced" || outcome === "revoked") {
        fetchTeamData(teamId, { background: outcome === "replaced" }).catch(logFailure(`teamVaultSync: reload after key change team=${teamId}`));
      }
    }
  }).catch(logFailure("teamVaultSync: revalidateCachedTeamKeys"));
  return _revalidationTail;
}

/** Shared by the "current epoch" and "specific historical epoch" fetch paths:
 * GET the given vault-key URL, resolve the wrapping member, unwrap. Thrown
 * error strings match _fetchAndUnwrapTeamVaultKey's existing contract. */
interface WrappedTeamKey {
  wrappedKey: string;
  wrappedBy: string;
  version: number;
}

async function _fetchAndUnwrapVaultKeyUrl(path: string): Promise<TeamKey> {
  return _unwrapTeamKey(await _fetchWrappedTeamKey(path));
}

async function _fetchWrappedTeamKey(path: string): Promise<WrappedTeamKey> {
  if (!navigator.onLine) throw "offline";

  const serverUrl = await getServerUrl();
  if (!serverUrl) throw "offline";

  let res: Response;
  try {
    res = await fetchWithAuth(`${serverUrl}${path}`, { method: "GET" });
  } catch {
    throw "offline";
  }

  if (res.status === 403) throw "forbidden";
  if (res.status === 402) throw "payment_required";
  if (res.status === 426) throw "update_required";
  if (res.status === 404) throw "awaiting_key";
  if (!res.ok) throw "error";

  const { wrapped_key, wrapped_by_user_id, key_version } = await res.json() as {
    wrapped_key: string;
    wrapped_by_user_id: string;
    key_version?: number;
  };
  // Servers before epochs (#217) omit key_version; their rows are all epoch 1.
  return { wrappedKey: wrapped_key, wrappedBy: wrapped_by_user_id, version: key_version ?? 1 };
}

async function _unwrapTeamKey({ wrappedKey, wrappedBy, version }: WrappedTeamKey): Promise<TeamKey> {
  // Looked up directly rather than via the current member roster: a
  // historical epoch's key can be wrapped by someone since removed from the
  // team — the very event that triggers rotation — and the roster would
  // never find them again, permanently blocking recovery of that epoch.
  const wrapper = await teamService.getUserPublicKey(wrappedBy).catch(() => {
    throw "error";
  });
  if (!wrapper) throw "error";

  let rawKey: Uint8Array;
  try {
    rawKey = await unwrapSessionKey(wrappedKey, wrapper.public_key);
  } catch {
    throw "key_mismatch";
  }
  return { key: Array.from(rawKey), version };
}

const _currentKeyPath = (teamId: string): string => `/v1/teams/${teamId}/vault-key`;

async function _fetchAndUnwrapTeamVaultKey(teamId: string): Promise<TeamKey> {
  return _fetchAndUnwrapVaultKeyUrl(_currentKeyPath(teamId));
}

// Historical-epoch key cache, keyed by "teamId:version" — separate from the
// current-epoch cache above since a client may need both at once while a
// rotation is draining (some rows still on the old epoch, new rows on the new).
const _teamKeyAtVersionCache = new Map<string, number[]>();
const _teamKeyAtVersionInFlight = new Map<string, Promise<number[]>>();

/**
 * Fetch and unwrap a *specific* historical epoch's key, for decoding a row
 * whose kv/key_version is behind the team's current epoch. Never evicted by
 * clearTeamKeyCache/deleteTeamKey — those model "the current epoch changed
 * under us," which has no bearing on a fixed historical epoch's key.
 *
 * The cache/in-flight-dedup shape below mirrors getTeamVaultKey's above on
 * purpose, not left un-factored by oversight: getTeamVaultKey's version also
 * carries the eviction-generation guard (a kicked member's key must not be
 * resurrected mid-fetch, #216), which does not apply here — a historical
 * epoch's key is immutable and this cache is never evicted. Sharing a helper
 * would need a generation-guard on/off parameter, which costs more than the
 * ~10 duplicated lines it would save.
 */
export async function getTeamVaultKeyAtVersion(teamId: string, version: number): Promise<number[]> {
  const cacheKey = `${teamId}:${version}`;
  const cached = _teamKeyAtVersionCache.get(cacheKey);
  if (cached) return cached;

  const existing = _teamKeyAtVersionInFlight.get(cacheKey);
  if (existing) return existing;

  const inFlight = _fetchAndUnwrapVaultKeyUrl(`/v1/teams/${teamId}/vault-key/${version}`).then(
    ({ key }) => {
      _teamKeyAtVersionCache.set(cacheKey, key);
      return key;
    },
  );
  _teamKeyAtVersionInFlight.set(cacheKey, inFlight);
  inFlight.finally(() => _teamKeyAtVersionInFlight.delete(cacheKey)).catch(() => {});

  return inFlight;
}

// The "current epoch, or bust out to vault-key/:version" branch below is the
// same three-line shape at every call site that decodes a versioned row
// (this file's own blob path, teamObjectEnvelope.ts, teamVaultSecrets.ts) —
// deliberately NOT extracted into a shared helper here. Their unit tests each
// mock this whole module down to just getCurrentTeamKey/getTeamVaultKeyAtVersion
// so they can exercise the branch as *their own* logic; a helper living in this module would be undefined under that mock,
// which would silently swap "test the branch" for "test that a mock was
// called." See #217 task-2 brief.

/**
 * Initialise the team vault key. Reuses the existing key; mints a fresh one only
 * when the team has no key holder at all. Uploads wrapped copies for self and all provided members.
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
  let keyVersion: number;
  let mintedFreshKey = false;
  try {
    const existing = await getCurrentTeamKey(teamId);
    rawKey = new Uint8Array(existing.key);
    keyVersion = existing.version;
  } catch (err) {
    if (err !== "awaiting_key") throw new Error(i18n.t("common.error.keyFetchFailed", { error: String(err) }));
    // 404 only means no wrap for us yet; minting over a keyed team would orphan its data.
    if ((await teamService.getVaultKeyHolders(teamId)).length > 0) return;
    rawKey = crypto.getRandomValues(new Uint8Array(32));
    // A team's first-ever key is always epoch 1.
    keyVersion = 1;
    mintedFreshKey = true;
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

  const res = await putVaultKeys(serverUrl, teamId, keys, keyVersion);
  if (!res.ok) throw new Error(i18n.t("common.error.failedToUploadVaultKeys", { status: res.status }));

  if (mintedFreshKey) _teamKeyCache.set(teamId, { key: Array.from(rawKey), version: keyVersion });
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

  const serverUrl = await getServerUrl();
  if (!serverUrl) throw new Error(i18n.t("common.error.notConnectedToServer"));

  for (let attempt = 0; ; attempt++) {
    let current: TeamKey;
    try {
      current = await getCurrentTeamKey(teamId);
    } catch {
      return;
    }
    const { key: rawKey, version } = current;
    const wrapped = await wrapSessionKeyForUser(new Uint8Array(rawKey), memberPublicKey);
    const res = await putVaultKeys(serverUrl, teamId, [{ user_id: memberUserId, wrapped_key: wrapped }], version);
    // 409: another member rotated since this key was cached; wrap the new one instead.
    if (res.status === 409 && attempt === 0) {
      deleteTeamKey(teamId);
      continue;
    }
    if (!res.ok) throw new Error(i18n.t("common.error.failedToDistributeVaultKey", { status: res.status }));
    return;
  }
}

function putVaultKeys(
  serverUrl: string,
  teamId: string,
  keys: { user_id: string; wrapped_key: string }[],
  keyVersion: number | undefined,
): Promise<Response> {
  return fetchWithAuth(`${serverUrl}/v1/teams/${teamId}/vault-key`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys, key_version: keyVersion }),
  });
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

// A rotation is the one action that can fix a genuine key_mismatch; if the
// caller lacks COPY_SECRETS the server just 403s it and this is a no-op.
async function _healKeyMismatchOnce(teamId: string, err: unknown): Promise<boolean> {
  if (err !== "key_mismatch") return false;
  if (_keyMismatchHealAttempted.has(teamId)) return false;
  _keyMismatchHealAttempted.add(teamId);

  const { checkAndRotateTeamKey } = await import("@/services/teamKeyRotation");
  await checkAndRotateTeamKey(teamId, { force: true });
  return true;
}

// ─── Data fetch / save ────────────────────────────────────────────────────────

function keyFailureStatus(err: unknown): TeamVaultStatus {
  return isTeamKeyError(err) ? err : "error";
}

/**
 * Every live row failed to decode. The key fetch names the cause when it is the
 * key; otherwise the rows themselves are unreadable, which is never an empty vault.
 */
async function _settleUnreadableVault(teamId: string, failures: DecodeFailureCounts, options: TeamVaultRefreshOptions): Promise<false> {
  if (options.background) return false;
  useTeamVaultStateStore.getState().setUndecryptable(teamId, failures);
  const keyError = await getTeamVaultKey(teamId).then(() => null, (e: unknown) => e);
  const memberView = keyError === "forbidden" ? await _memberViewStatus(teamId) : null;
  const status = keyError === null || keyError === "error" || memberView === "loaded"
    ? "undecryptable"
    : memberView ?? keyFailureStatus(keyError);
  await clearTeamStoresAndSecrets(teamId);
  useTeamVaultStateStore.getState().setStatus(teamId, status);
  return false;
}

/**
 * Fetch the team blob, decrypt it, and populate the in-memory store slices.
 * Sets teamVaultStatus to the appropriate state. Never throws — all errors are
 * surfaced via the store status.
 */
export async function fetchTeamData(teamId: string, options: TeamVaultRefreshOptions = {}): Promise<void> {
  const listed = listedDataVersion(teamId);
  if (await _teamRefreshQueue.run(teamId, options, (merged) => _fetchTeamData(teamId, merged))) noteTeamDataSeen(teamId, listed);
}

const ANSWERED_STATUSES = new Set<TeamVaultStatus>(["loaded", "forbidden", "plan_lapsed", "payment_required"]);

async function _fetchTeamData(teamId: string, options: TeamVaultRefreshOptions): Promise<boolean> {
  const { beginTeamAnswer, closeConnectionsLost } = await import("@/services/revokedConnections");
  const before = beginTeamAnswer(teamId);
  const ok = await _loadTeamData(teamId, options);
  const status = useTeamVaultStateStore.getState().statusByTeamId[teamId];
  if (status && ANSWERED_STATUSES.has(status)) closeConnectionsLost(teamId, before);
  return ok;
}

async function _loadTeamData(teamId: string, options: TeamVaultRefreshOptions): Promise<boolean> {
  const stateStore = useTeamVaultStateStore.getState();
  const blockingLoad = shouldShowBlockingTeamVaultLoad(options);
  if (blockingLoad) stateStore.setStatus(teamId, "loading");

  const serverUrl = await getServerUrl();
  if (!serverUrl) {
    if (options.background) return false;
    await clearTeamStoresAndSecrets(teamId);
    stateStore.setStatus(teamId, "offline");
    return false;
  }

  let objectListFailed = false;
  try {
    const objects = await listTeamObjects(teamId);
    (await import("@/services/revokedConnections")).noteListedConnections(teamId, objects);
    if (objects.length === 0) stateStore.setUndecryptable(teamId, {});
    else {
      const hydration = await _hydrateTeamObjectStores(teamId, objects);
      if (isUnreadable(hydration)) return await _settleUnreadableVault(teamId, hydration.failures, options);
      stateStore.setUndecryptable(teamId, hydration.failures);
      // Background migration of rows predating #229. Never blocks the load, and
      // a failure leaves the remaining rows for the next connect.
      void import("@/services/teamObjectReencrypt")
        .then(({ runReencryptionPass }) => runReencryptionPass(teamId, objects))
        .catch(() => {});
      const { hydrateTeamVaultSecrets } = await import("@/services/teamVaultSecrets");
      // Credentials are what makes a host connectable, so a failure here is not
      // cosmetic: the vault renders fully populated and every host needing a
      // stored secret then fails at authentication. Record it instead of
      // swallowing it (issue #190).
      let credentialsOk: boolean;
      try {
        await hydrateTeamVaultSecrets(teamId);
        credentialsOk = true;
      } catch (err) {
        credentialsOk = await _healKeyMismatchOnce(teamId, err)
          ? await hydrateTeamVaultSecrets(teamId).then(() => true, () => false)
          : false;
      }
      stateStore.setCredentialsUnavailable(teamId, !credentialsOk);
      await settleLoadedTeamSecrets(teamId, options);
      stateStore.setStatus(teamId, "loaded");
      return true;
    }
  } catch (err) {
    if (options.background) {
      if (isAccessRevoked(err)) teamSecretCache.clearTeam(teamId);
      return false;
    }
    const action = classifyTeamObjectListError(err);
    if (action === "fallback") {
      objectListFailed = true;
      // Fall through to legacy key/blob loading. Some clients may hit transient
      // object-route failures immediately after invitation while the legacy blob
      // route already has the vault data available.
    } else {
      await clearTeamStoresAndSecrets(teamId);
      stateStore.setStatus(teamId, action);
      return false;
    }
  }

  let current: TeamKey;
  try {
    current = await getCurrentTeamKey(teamId);
  } catch (err) {
    // A 403 here means one of two very different things: the caller was removed
    // from the team, or their role simply lacks VIEW_SECRETS (connect-only,
    // issue #187). The route cannot tell them apart, but the client can — a
    // revoked member no longer has the team in their own team list. A 403 while
    // the team is still listed is a role restriction, and such a member reads
    // this vault through the object routes only: the empty list they just got
    // IS their view of the vault, so show it rather than a false revocation.
    const memberView = err === "forbidden" ? await _memberViewStatus(teamId) : null;
    if (options.background && !memberView) {
      if (isAccessRevoked(err)) teamSecretCache.clearTeam(teamId);
      return false;
    }
    const status = memberView ?? keyFailureStatus(err);
    // Clear team store slices so stale data doesn't linger
    await clearTeamStoresAndSecrets(teamId);
    stateStore.setStatus(teamId, status);
    return status === "loaded";
  }

  let blobPayload: BlobPayload;
  try {
    const res = await fetchWithAuth(`${serverUrl}/v1/teams/${teamId}/sync-blob`, { method: "GET" });
    // After a successful object list, no readable blob means the empty list is the member's view.
    if (res.status === 404 || (res.status === 403 && !objectListFailed)) {
      await clearTeamStoresAndSecrets(teamId);
      stateStore.setStatus(teamId, objectListFailed ? "error" : "loaded");
      return !objectListFailed;
    }
    if (!res.ok) {
      if (options.background) return false;
      await clearTeamStoresAndSecrets(teamId);
      stateStore.setStatus(teamId, "error");
      return false;
    }
    const { blob: blobB64, key_version: blobVersion } = await res.json() as {
      blob: string; updated_at: string; key_version?: number;
    };
    const blobBytes = base64ToByteArray(blobB64);
    const blobEpoch = blobVersion ?? 1;
    const blobKey = blobEpoch !== current.version
      ? await getTeamVaultKeyAtVersion(teamId, blobEpoch)
      : current.key;
    blobPayload = await invoke<BlobPayload>("backup_decrypt", { encKey: blobKey, blob: blobBytes });
  } catch {
    if (options.background) return false;
    await clearTeamStoresAndSecrets(teamId);
    stateStore.setStatus(teamId, "error");
    return false;
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

  teamSecretCache.replaceTeam(teamId, new Map(Object.entries(blobPayload.secrets ?? {})));
  await settleLoadedTeamSecrets(teamId, options);

  stateStore.setStatus(teamId, "loaded");
  return true;
}

/**
 * Re-encrypts the team's legacy whole-blob (#229 removed the writer for new
 * data, but old teams may still carry one) under the current key epoch, if
 * it exists and is behind. No-op if there is no blob (404) or it's already
 * current. Part of the #217 reencrypt pass alongside objects and secrets —
 * without this, a team with a legacy blob rotates once and then can never
 * rotate again (a stale blob keeps `draining` true forever).
 */
export async function reencryptLegacyBlobIfStale(teamId: string, currentVersion: number, currentKey: number[]): Promise<void> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) return;

  let res: Response;
  try {
    res = await fetchWithAuth(`${serverUrl}/v1/teams/${teamId}/sync-blob`, { method: "GET" });
  } catch {
    return;
  }
  if (res.status === 404 || !res.ok) return;

  const { blob: blobB64, key_version: blobVersion } = await res.json() as {
    blob: string; updated_at: string; key_version: number;
  };
  if (blobVersion >= currentVersion) return; // already current or ahead — nothing to do

  const oldKey = await getTeamVaultKeyAtVersion(teamId, blobVersion);
  const blobPayload = await invoke<BlobPayload>("backup_decrypt", { encKey: oldKey, blob: base64ToByteArray(blobB64) });
  const reencrypted: number[] = await invoke("encrypt_payload", {
    encKey: currentKey,
    files: blobPayload.files,
    secrets: blobPayload.secrets,
  });

  await fetchWithAuth(`${serverUrl}/v1/teams/${teamId}/sync-blob`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blob: bytesToBase64(reencrypted), key_version: currentVersion }),
  });
}

/**
 * Null when the client no longer lists `teamId` among the caller's teams. The
 * server drops revoked teams from that list and `onTeamRemoved` clears the
 * store, so this separates "your role can't do that" from "you were removed".
 */
async function _memberViewStatus(teamId: string): Promise<"loaded" | "plan_lapsed" | null> {
  const { useTeamStore } = await import("@/stores/teamStore");
  const { planLapsedFor } = await import("@/services/permissions");
  const store = useTeamStore.getState();
  const team = store.teams.find((t) => t.id === teamId);
  if (!team) return null;
  if (!store.rolesByTeam[teamId] && !(await store.loadRoles(teamId).then(() => true, () => false))) return "loaded";
  return planLapsedFor(team, useTeamStore.getState().rolesByTeam[teamId] ?? []) ? "plan_lapsed" : "loaded";
}

export interface TeamObjectHydration {
  active: number;
  failures: DecodeFailureCounts;
}

/** Leaves every store untouched when no live row decodes: an unreadable vault must not replace a readable one. */
export async function _hydrateTeamObjectStores(teamId: string, objects: TeamObjectRecord[]): Promise<TeamObjectHydration> {
  const active = objects.filter((o) => !o.deleted_at);

  const { decodeTeamObject, decodeFailureOf, noteTeamRows, acceptsPlaintextRows } = await import("@/services/teamObjectRows");
  noteTeamRows(teamId, active);
  const allowPlaintext = acceptsPlaintextRows(teamId);

  // Rows written before #229 carry plaintext metadata and decode to themselves.
  // A row that will not decrypt is dropped rather than spread: a half-object
  // with no id or host is worse in the stores than an absent one, and it would
  // be written straight back on the next save.
  const failures: DecodeFailureCounts = {};
  const decoded = await Promise.all(
    active.map(async (o) => {
      const metadata = await decodeTeamObject(teamId, o, allowPlaintext).catch((e: unknown) => {
        const reason = decodeFailureOf(e);
        failures[reason] = (failures[reason] ?? 0) + 1;
        logFailure(`teamVaultSync: decode object team=${teamId} object=${o.object_id} reason=${reason}`)(e);
        return null;
      });
      return metadata === null ? null : { ...o, metadata };
    }),
  );

  const usable = decoded.filter((o): o is TeamObjectRecord & { metadata: object } => o !== null);
  const result = { active: active.length, failures };
  if (isUnreadable(result)) return result;

  const { buildAccessEntries } = await import("@/services/teamObjectAccess");
  const { useTeamObjectAccessStore } = await import("@/stores/teamObjectAccessStore");
  const access = buildAccessEntries(objects, new Map(usable.map((o) => [o.object_id, o.metadata])));
  if (access.supported === false) useTeamObjectAccessStore.getState().clearTeam(teamId);
  else useTeamObjectAccessStore.getState().replaceTeam(
    teamId, access.entries, access.supported ?? useTeamObjectAccessStore.getState().supportedByTeam[teamId] ?? false,
  );

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
  return result;
}

const isUnreadable = ({ active, failures }: TeamObjectHydration) => active > 0 && undecryptableTotal(failures) === active;

async function purgeLocalCopies(keys: string[]): Promise<string[]> {
  try {
    await purgeLocalSecrets(keys);
    return [];
  } catch (e) {
    logFailure(`local secret purge of ${keys.length} keys`)(e);
    return keys;
  }
}

async function teamOwnedSecretKeys(teamId: string): Promise<string[]> {
  const { teamObjectSecretKeys } = await import("@/services/teamSecretOwnership");
  return teamObjectSecretKeys(teamId);
}

async function purgeTeamObjectSecrets(
  teamId: string,
  skip: Set<string> = new Set(),
  ownedKeys?: string[],
): Promise<string[]> {
  const keys = (ownedKeys ?? await teamOwnedSecretKeys(teamId)).filter((k) => !skip.has(k));
  const failed = await purgeLocalCopies(keys);
  if (failed.length > 0) {
    const { usePendingSecretWipeStore } = await import("@/stores/pendingSecretWipeStore");
    usePendingSecretWipeStore.getState().enqueue(teamId, failed);
  }
  return failed;
}

/** Retries a failed personal→team upload before the sweep purges its only surviving local copy. */
async function retryPendingTeamSecretUploads(teamId: string, ownedKeys: Set<string>): Promise<Set<string>> {
  const { usePendingTeamSecretUploadStore } = await import("@/stores/pendingTeamSecretUploadStore");
  const { getLocalSecret } = await import("@/services/vault");
  const store = usePendingTeamSecretUploadStore.getState();
  const pending = store.keysByTeamId[teamId] ?? [];
  const stillPending: string[] = [];

  for (const key of pending) {
    if (!ownedKeys.has(key)) continue; // object left the team; resolved below, local copy untouched
    let value: string | null;
    try {
      value = await getLocalSecret(key);
    } catch (e) {
      logFailure(`local read for pending team secret upload ${key}`)(e);
      stillPending.push(key);
      continue;
    }
    if (!value) continue;
    try {
      const { writeSecretAt } = await import("@/services/secretRouting");
      await writeSecretAt(teamId, key, value);
    } catch (e) {
      logFailure(`retry team secret upload ${key}`)(e);
      stillPending.push(key);
    }
  }

  store.resolve(teamId, pending.filter((k) => !stillPending.includes(k)));
  return new Set(stillPending);
}

export async function sweepLocalTeamSecrets(teamId: string): Promise<void> {
  const ownedKeys = await teamOwnedSecretKeys(teamId);
  const stillPending = await retryPendingTeamSecretUploads(teamId, new Set(ownedKeys));
  await purgeTeamObjectSecrets(teamId, stillPending, ownedKeys);
}

async function settleLoadedTeamSecrets(teamId: string, options: TeamVaultRefreshOptions): Promise<void> {
  if (!options.background) await sweepLocalTeamSecrets(teamId);
  const { retryUnsentTeamSecrets } = await import("@/services/secretRouting");
  await retryUnsentTeamSecrets(teamId);
}

/** Retries failed local-store purges, keeping queued any key now owned locally or still waiting to upload. */
export async function drainPendingSecretWipes(): Promise<void> {
  const { usePendingSecretWipeStore } = await import("@/stores/pendingSecretWipeStore");
  const { usePendingTeamSecretUploadStore } = await import("@/stores/pendingTeamSecretUploadStore");
  const { hasLocalOwner } = await import("@/services/teamSecretOwnership");
  const store = usePendingSecretWipeStore.getState();
  const awaitingUpload = new Set(Object.values(usePendingTeamSecretUploadStore.getState().keysByTeamId).flat());

  for (const [teamId, keys] of Object.entries(store.keysByTeamId)) {
    const purgeable = keys.filter((k) => !awaitingUpload.has(k) && !hasLocalOwner(k));
    const failed = new Set(await purgeLocalCopies(purgeable));
    store.resolve(teamId, purgeable.filter((k) => !failed.has(k)));
  }
}

/**
 * Empties the team's store slices and purges its secrets from the local store,
 * except keys still waiting to upload. Returns the keys that survived the purge.
 */
async function teamObjectStores() {
  const { useConnectionStore } = await import("@/stores/connectionStore");
  const { useIdentityStore } = await import("@/stores/identityStore");
  const { useKeyStore } = await import("@/stores/keyStore");
  const { useFolderStore } = await import("@/stores/folderStore");
  const { useSnippetStore } = await import("@/stores/snippetStore");
  const { useSnippetFolderStore } = await import("@/stores/snippetFolderStore");
  const { usePortForwardingStore } = await import("@/stores/portForwardingStore");
  return { useConnectionStore, useIdentityStore, useKeyStore, useFolderStore, useSnippetStore, useSnippetFolderStore, usePortForwardingStore };
}

/** Teams this device still holds a vault key or objects for. */
export async function teamIdsWithLocalData(): Promise<Set<string>> {
  const s = await teamObjectStores();
  const maps: Record<string, unknown[]>[] = [
    s.useConnectionStore.getState().teamConnections,
    s.useIdentityStore.getState().teamIdentities,
    s.useKeyStore.getState().teamKeys,
    s.useFolderStore.getState().teamFolders,
    s.useSnippetStore.getState().teamSnippets,
    s.useSnippetFolderStore.getState().teamSnippetFolders,
    s.usePortForwardingStore.getState().teamRules,
  ];
  const ids = new Set(_teamKeyCache.keys());
  for (const map of maps) {
    for (const [teamId, items] of Object.entries(map)) if (items.length > 0) ids.add(teamId);
  }
  return ids;
}

export async function clearTeamStoresAndSecrets(teamId: string): Promise<string[]> {
  const {
    useConnectionStore, useIdentityStore, useKeyStore, useFolderStore,
    useSnippetStore, useSnippetFolderStore, usePortForwardingStore,
  } = await teamObjectStores();

  const { usePendingTeamSecretUploadStore } = await import("@/stores/pendingTeamSecretUploadStore");
  const pendingUploads = new Set(usePendingTeamSecretUploadStore.getState().keysByTeamId[teamId] ?? []);
  // Purge before clearing the stores: the key names come from the objects still in them.
  const failedKeys = await purgeTeamObjectSecrets(teamId, pendingUploads);
  teamSecretCache.clearTeam(teamId);
  const { useTeamObjectAccessStore } = await import("@/stores/teamObjectAccessStore");
  useTeamObjectAccessStore.getState().clearTeam(teamId);

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
