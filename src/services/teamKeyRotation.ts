import { getRotationStatus, rotateVaultKey, listMembers } from "@/services/teamService";
import { wrapSessionKeyForUser } from "@/services/multiplayerService";
import { getTeamVaultKey, getCachedTeamKeyVersion, getTeamVaultKeyAtVersion } from "@/services/teamVaultSync";
import {
  listTeamObjects, reencryptTeamObjects,
  listTeamSecrets, reencryptTeamSecrets,
} from "@/services/teamObjects";
import { isEncryptedEnvelope, encodeObjectMetadata } from "@/services/teamObjectEnvelope";
import { buildEditPermissionSnapshot, canEditObjectType } from "@/services/teamObjectEditPermission";
import { invoke } from "@tauri-apps/api/core";
import { bytesToBase64, base64ToBytes } from "@/services/teamVaultSyncCore";

const BATCH_SIZE = 50;

/** A row/envelope not yet on the current epoch. Missing kv/key_version is
 * epoch 1, matching the server's COALESCE(...,1) treatment (see #217 spec). */
function epochOf(kv: number | undefined): number {
  return kv ?? 1;
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
  run.finally(() => _rotationPassInFlight.delete(teamId)).catch(() => {});
  return run;
}

async function _checkAndRotateTeamKey(teamId: string): Promise<void> {
  let status;
  try {
    status = await getRotationStatus(teamId);
  } catch {
    return; // offline, forbidden (no VIEW_SECRETS/COPY_SECRETS), etc. — try again next event
  }

  if (status.draining) {
    await _drainTeamKeyRotation(teamId).catch(() => {});
    return;
  }

  if (status.stale) {
    await _rotateTeamKey(teamId).catch(() => {});
  }
}

async function _rotateTeamKey(teamId: string): Promise<void> {
  const rawKeyBytes = new Uint8Array(await getTeamVaultKey(teamId));
  const members = await listMembers(teamId);

  // getTeamVaultKey(teamId) above already required this caller to hold the
  // key themselves, so `me` (if present) in `members` with a public key gets
  // wrapped for like anyone else — no special-casing needed.
  const keys = await Promise.all(
    members
      .filter((m) => !!m.public_key)
      .map(async (m) => ({
        user_id: m.user_id,
        wrapped_key: await wrapSessionKeyForUser(rawKeyBytes, m.public_key),
      })),
  );

  await rotateVaultKey(teamId, keys);
  await _drainTeamKeyRotation(teamId).catch(() => {});
}

async function _drainTeamKeyRotation(teamId: string): Promise<void> {
  const currentVersion = getCachedTeamKeyVersion(teamId);
  if (currentVersion === undefined) return; // ensure a key fetch has happened first

  const [objects, secrets] = await Promise.all([listTeamObjects(teamId), listTeamSecrets(teamId)]);
  const snapshot = await buildEditPermissionSnapshot();

  const objectTypeById = new Map(objects.map((o) => [o.object_id, o.object_type] as const));

  const staleObjects = objects.filter((o) => {
    if (o.deleted_at) return false;
    if (!isEncryptedEnvelope(o.metadata)) return false; // #229's own migration pass handles these
    const kv = (o.metadata as { kv?: number }).kv;
    return epochOf(kv) !== currentVersion && canEditObjectType(snapshot, teamId, o.object_type);
  });

  const staleSecrets = secrets.filter((s) => {
    if (s.key_version === currentVersion) return false;
    const objectType = objectTypeById.get(s.object_id);
    return objectType !== undefined && canEditObjectType(snapshot, teamId, objectType);
  });

  for (let i = 0; i < staleObjects.length; i += BATCH_SIZE) {
    const slice = staleObjects.slice(i, i + BATCH_SIZE);
    const items = await Promise.all(
      slice.map(async (o) => ({
        object_id: o.object_id,
        metadata: await encodeObjectMetadata(teamId, o.metadata as object),
      })),
    );
    await reencryptTeamObjects(teamId, items);
  }

  // Secrets carry opaque ciphertext, not a JSON object to re-derive the way
  // objects' metadata does — the *value* doesn't change on rotation, only
  // which key wraps it, so this needs the plaintext momentarily. Routes
  // through the same encrypt_payload/backup_decrypt pair
  // saveTeamVaultSecret/hydrateTeamVaultSecrets already use, rather than a
  // third bespoke pairing.
  for (let i = 0; i < staleSecrets.length; i += BATCH_SIZE) {
    const slice = staleSecrets.slice(i, i + BATCH_SIZE);
    const items = await Promise.all(slice.map(async (s) => {
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
      const newKey = await getTeamVaultKey(teamId);
      const reencrypted: number[] = await invoke("encrypt_payload", {
        encKey: newKey,
        files: {},
        secrets: { [localKey]: value },
      });
      return {
        secret_id: s.secret_id,
        ciphertext: bytesToBase64(reencrypted),
        key_version: currentVersion,
      };
    }));
    await reencryptTeamSecrets(teamId, items);
  }
}

export { _drainTeamKeyRotation as __testOnly_drainTeamKeyRotation };
