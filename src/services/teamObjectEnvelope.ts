import { invoke } from "@tauri-apps/api/core";
import { getTeamVaultKey, getCachedTeamKeyVersion, getTeamVaultKeyAtVersion } from "@/services/teamVaultSync";
import { bytesToBase64, base64ToBytes } from "@/services/teamVaultSyncCore";

/**
 * Team object metadata used to be stored server-side as raw JSONB, leaving
 * hostnames, usernames, jump hosts, env vars and pre/post commands readable
 * from any backup with no key (#229). Objects are now wrapped in this envelope
 * and encrypted under the team DEK.
 */
export interface EncryptedEnvelope {
  v: 2;
  enc: string;
  /** The key epoch `enc` was encrypted under. Absent on any row written
   * before #217 — those predate epochs entirely and are always epoch 1,
   * matching the server's own COALESCE(..., 1) treatment of the same rows. */
  kv?: number;
}

/** The key under which the object JSON travels inside the encrypted payload. */
const METADATA_FILE = "metadata";

export function isEncryptedEnvelope(metadata: unknown): metadata is EncryptedEnvelope {
  if (typeof metadata !== "object" || metadata === null) return false;
  const m = metadata as Record<string, unknown>;
  return m.v === 2 && typeof m.enc === "string";
}

export async function encodeObjectMetadata(teamId: string, item: object): Promise<EncryptedEnvelope> {
  const encKey = await getTeamVaultKey(teamId);
  const kv = getCachedTeamKeyVersion(teamId) ?? 1;
  const blob: number[] = await invoke("encrypt_payload", {
    encKey,
    files: { [METADATA_FILE]: JSON.stringify(item) },
    secrets: {},
  });
  return { v: 2, enc: bytesToBase64(blob), kv };
}

/**
 * Returns the object. Rows written before #229 are plaintext and pass straight
 * through, which is what lets a client read a team mid-migration. A row's `kv`
 * that is behind the team's current epoch (rotation, #217) is decrypted with
 * the matching historical key instead of the current one.
 */
export async function decodeObjectMetadata(teamId: string, metadata: unknown): Promise<object> {
  if (!isEncryptedEnvelope(metadata)) return (metadata ?? {}) as object;

  const targetVersion = metadata.kv ?? 1;
  const currentVersion = getCachedTeamKeyVersion(teamId);
  const encKey = currentVersion !== undefined && targetVersion !== currentVersion
    ? await getTeamVaultKeyAtVersion(teamId, targetVersion)
    : await getTeamVaultKey(teamId); // also primes the current-version cache for next time
  const payload = await invoke<{ files: Record<string, string> }>("backup_decrypt", {
    encKey,
    blob: base64ToBytes(metadata.enc),
  });
  // No `?? "{}"` fallback: a payload that decrypts successfully but has no
  // `metadata` key must throw (JSON.parse(undefined) throws SyntaxError),
  // not silently resolve to a phantom object with no fields. Callers rely
  // on decode throwing to drop undecryptable/malformed rows instead of
  // spreading a half-object into the stores.
  return JSON.parse(payload.files[METADATA_FILE]) as object;
}
