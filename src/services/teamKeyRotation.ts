import { getRotationStatus, rotateVaultKey, listMembers, getMyUserId } from "@/services/teamService";
import { wrapSessionKeyForUser, publishMyPublicKey } from "@/services/multiplayerService";
import {
  getTeamVaultKey, getCachedTeamKeyVersion, getTeamVaultKeyAtVersion, deleteTeamKey,
  reencryptLegacyBlobIfStale,
} from "@/services/teamVaultSync";
import {
  listTeamObjects, reencryptTeamObjects,
  listTeamSecrets, reencryptTeamSecrets,
} from "@/services/teamObjects";
import { isEncryptedEnvelope, encodeObjectMetadata, decodeObjectMetadata } from "@/services/teamObjectEnvelope";
import { buildEditPermissionSnapshot, canEditObjectType } from "@/services/teamObjectEditPermission";
import { invoke } from "@tauri-apps/api/core";
import { bytesToBase64, base64ToBytes } from "@/services/teamVaultSyncCore";
import { logFailure } from "@/lib/logger";

const BATCH_SIZE = 50;

/** A row/envelope not yet on the current epoch. Missing kv/key_version is
 * epoch 1, matching the server's COALESCE(...,1) treatment (see #217 spec). */
function epochOf(kv: number | undefined): number {
  return kv ?? 1;
}

/**
 * Runs `mapFn` over `items` in `batchSize` chunks, settling each chunk rather
 * than aborting it on the first rejection: a single poisoned row (a 404 on a
 * historical key, a malformed payload) would otherwise abort the whole batch,
 * and since this work is recomputed fresh every pass, that same row would
 * fail identically forever, permanently blocking every other row behind it.
 * Failed rows are logged and dropped; `onBatch` only runs when a chunk has at
 * least one surviving item.
 */
async function settleInBatches<T, R>(
  items: T[],
  batchSize: number,
  mapFn: (item: T) => Promise<R>,
  logContext: string,
  onBatch: (settled: R[]) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const slice = items.slice(i, i + batchSize);
    const results = await Promise.allSettled(slice.map(mapFn));
    const settled = results.flatMap((r) => {
      if (r.status === "fulfilled") return [r.value];
      logFailure(logContext)(r.reason);
      return [];
    });
    if (settled.length > 0) await onBatch(settled);
  }
}

/**
 * Opportunistic rotate-and-drain, mirroring runReencryptionPass's shape:
 * recomputed from data each call, executed by whichever connected member
 * holds the right permission, deduplicated per team so a burst of
 * team_members events collapses into one pass.
 *
 * Never rotates and drains in the same call — serialization rule from the
 * spec: a rotation that lands while a previous one is still draining relies
 * on the existing removal flow (member + key rows already deleted) for its
 * own cutoff, not a second epoch.
 */
const _rotationPassInFlight = new Map<string, Promise<void>>();

export function checkAndRotateTeamKey(teamId: string): Promise<void> {
  const existing = _rotationPassInFlight.get(teamId);
  if (existing) return existing;

  const run = _checkAndRotateTeamKey(teamId);
  _rotationPassInFlight.set(teamId, run);
  run.finally(() => _rotationPassInFlight.delete(teamId)).catch(logFailure(`teamKeyRotation: pass team=${teamId}`));
  return run;
}

async function _checkAndRotateTeamKey(teamId: string): Promise<void> {
  let status;
  try {
    status = await getRotationStatus(teamId);
  } catch (e) {
    logFailure(`teamKeyRotation: getRotationStatus team=${teamId}`)(e);
    return; // offline, forbidden (no VIEW_SECRETS/COPY_SECRETS), etc. — try again next event
  }

  if (status.draining) {
    await _drainTeamKeyRotation(teamId).catch(logFailure(`teamKeyRotation: drain team=${teamId}`));
    return;
  }

  if (status.stale) {
    await _rotateTeamKey(teamId).catch(logFailure(`teamKeyRotation: rotate team=${teamId}`));
  }
}

async function _rotateTeamKey(teamId: string): Promise<void> {
  // Fresh DEK per rotation (spec), not a re-wrap of the current one: wrapping
  // only needs each member's public key, never the sender's possession of any
  // prior DEK. Re-wrapping the existing key would leave a removed member's
  // already-cached copy able to decrypt everything forever — the exact thing
  // #217 exists to prevent. Matches initTeamVaultKey's own first-time-key
  // pattern in teamVaultSync.ts.
  const rawKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  // Publish first and wrap for self against that, not against whatever
  // public_key listMembers happens to have cached for the caller — a stale
  // cached key here has repeatedly caused real lockouts (#66, #228). Mirrors
  // initTeamVaultKey's own pattern in teamVaultSync.ts.
  const myPublicKey = await publishMyPublicKey();
  const myUserId = await getMyUserId();
  if (!myUserId) return; // not authenticated — try again next event

  const members = await listMembers(teamId);
  const keys = await Promise.all(
    members
      .filter((m) => m.user_id !== myUserId && !!m.public_key)
      .map(async (m) => ({
        user_id: m.user_id,
        wrapped_key: await wrapSessionKeyForUser(rawKeyBytes, m.public_key),
      })),
  );
  keys.push({ user_id: myUserId, wrapped_key: await wrapSessionKeyForUser(rawKeyBytes, myPublicKey) });

  await rotateVaultKey(teamId, keys);
  await _drainTeamKeyRotation(teamId).catch(logFailure(`teamKeyRotation: drain team=${teamId}`));
}

async function _drainTeamKeyRotation(teamId: string): Promise<void> {
  // The cache is not trustworthy as "current epoch" on its own: it can be
  // stale right after this client's own rotation (until evicted) or when a
  // different client rotated and this one is draining only because
  // rotation-status said draining:true. Force a fresh fetch so "current"
  // always means the server's current, never this client's last-known.
  deleteTeamKey(teamId);
  const currentKey = await getTeamVaultKey(teamId); // forces a fresh network fetch, primes both caches
  const currentVersion = getCachedTeamKeyVersion(teamId);
  if (currentVersion === undefined) return; // couldn't fetch (offline/forbidden) — try again next event

  // Step 4 of the spec's reencrypt pass: the legacy whole-blob some older
  // teams still carry. Independent of the object/secret loops below, so its
  // failure doesn't block them (or vice versa).
  await reencryptLegacyBlobIfStale(teamId, currentVersion, currentKey)
    .catch(logFailure(`teamKeyRotation: reencrypt legacy blob team=${teamId}`));

  const [objects, secrets] = await Promise.all([listTeamObjects(teamId), listTeamSecrets(teamId)]);
  const snapshot = await buildEditPermissionSnapshot();

  const objectTypeById = new Map(objects.map((o) => [o.object_id, o.object_type] as const));

  // Strictly behind current, never equal-or-ahead: a row already on or ahead
  // of this client's freshly-resolved "current" must never be rewritten
  // backward onto an older key.
  const staleObjects = objects.filter((o) => {
    if (o.deleted_at) return false;
    if (!isEncryptedEnvelope(o.metadata)) return false; // #229's own migration pass handles these
    const kv = (o.metadata as { kv?: number }).kv;
    return epochOf(kv) < currentVersion && canEditObjectType(snapshot, teamId, o.object_type);
  });

  const staleSecrets = secrets.filter((s) => {
    if (epochOf(s.key_version) >= currentVersion) return false;
    const objectType = objectTypeById.get(s.object_id);
    return objectType !== undefined && canEditObjectType(snapshot, teamId, objectType);
  });

  await settleInBatches(
    staleObjects,
    BATCH_SIZE,
    async (o) => ({
      object_id: o.object_id,
      // Must decode under the OLD (per-row) key before re-encoding under the
      // current one — encodeObjectMetadata just JSON.stringifies whatever
      // it's given, so skipping this step would encrypt the ciphertext
      // envelope itself, not the underlying fields.
      metadata: await encodeObjectMetadata(teamId, await decodeObjectMetadata(teamId, o.metadata)),
    }),
    `teamKeyRotation: skip poisoned object row team=${teamId}`,
    (items) => reencryptTeamObjects(teamId, items),
  );

  // Secrets carry opaque ciphertext, not a JSON object to re-derive the way
  // objects' metadata does — the *value* doesn't change on rotation, only
  // which key wraps it, so this needs the plaintext momentarily. Routes
  // through the same encrypt_payload/backup_decrypt pair
  // saveTeamVaultSecret/hydrateTeamVaultSecrets already use, rather than a
  // third bespoke pairing.
  await settleInBatches(
    staleSecrets,
    BATCH_SIZE,
    async (s) => {
      const oldKey = await getTeamVaultKeyAtVersion(teamId, s.key_version);
      const decrypted = await invoke<{ secrets: Record<string, string> }>("backup_decrypt", {
        encKey: oldKey,
        blob: base64ToBytes(s.ciphertext),
      });
      // The secret's own localKey namespacing (password:<id>, key:<id>:private,
      // etc.) round-trips through the same encrypt_payload "secrets" map the
      // ciphertext was written with (saveTeamVaultSecret) — there is exactly
      // one entry, whatever its key name, so re-wrap it under the same name.
      const [localKey, value] = Object.entries(decrypted.secrets)[0] ?? [];
      if (!localKey) throw new Error(`empty secret payload for ${s.secret_id}`);
      const reencrypted: number[] = await invoke("encrypt_payload", {
        encKey: currentKey,
        files: {},
        secrets: { [localKey]: value },
      });
      return {
        secret_id: s.secret_id,
        ciphertext: bytesToBase64(reencrypted),
        key_version: currentVersion,
      };
    },
    `teamKeyRotation: skip poisoned secret row team=${teamId}`,
    (items) => reencryptTeamSecrets(teamId, items),
  );
}

export { _drainTeamKeyRotation as __testOnly_drainTeamKeyRotation };
