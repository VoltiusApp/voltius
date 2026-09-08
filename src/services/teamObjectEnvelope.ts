import { invoke } from "@tauri-apps/api/core";
import { getTeamVaultKey } from "@/services/teamVaultSync";
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
  const blob: number[] = await invoke("encrypt_payload", {
    encKey,
    files: { [METADATA_FILE]: JSON.stringify(item) },
    secrets: {},
  });
  return { v: 2, enc: bytesToBase64(blob) };
}

/**
 * Returns the object. Rows written before #229 are plaintext and pass straight
 * through, which is what lets a client read a team mid-migration.
 */
export async function decodeObjectMetadata(teamId: string, metadata: unknown): Promise<object> {
  if (!isEncryptedEnvelope(metadata)) return (metadata ?? {}) as object;

  const encKey = await getTeamVaultKey(teamId);
  const payload = await invoke<{ files: Record<string, string> }>("backup_decrypt", {
    encKey,
    blob: base64ToBytes(metadata.enc),
  });
  return JSON.parse(payload.files[METADATA_FILE] ?? "{}") as object;
}
