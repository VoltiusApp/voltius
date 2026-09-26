import { decodeObjectMetadata, isEncryptedEnvelope } from "@/services/teamObjectEnvelope";
import type { TeamObjectRecord } from "@/services/teamObjects";

// What a team object row may be trusted for, beyond "it decrypts". The v2
// envelope (#229) authenticates its payload but binds it to nothing, and rows
// written before it are plaintext, so the server alone decides both which
// ciphertext sits under which object id and whether a row is plaintext at all.
// Binding the ciphertext to its row needs a wire-format change (the object id
// as AAD); until then these are the checks the current format allows.

type Row = Pick<TeamObjectRecord, "object_id" | "metadata">;

const ENCRYPTED_ONLY_KEY = "voltius.team_objects_encrypted_only";

function encryptedOnlyTeams(): string[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(ENCRYPTED_ONLY_KEY) ?? "[]");
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Whether plaintext rows are still accepted for `teamId`. They are, until this
 * device has once loaded the team with every live row encrypted: plaintext
 * rows written before #229 are legitimate and a team migrates only as its
 * privileged members reconnect (see teamObjectReencrypt). After that, a
 * plaintext row can only be one the server made up, so it is refused — and
 * never re-encrypted, which would launder it into a genuine envelope.
 */
export function acceptsPlaintextRows(teamId: string): boolean {
  return !encryptedOnlyTeams().includes(teamId);
}

/** Record a load of `teamId`'s live rows; closes the plaintext allowance once none is plaintext. */
export function noteTeamRows(teamId: string, liveRows: Row[]): void {
  if (!acceptsPlaintextRows(teamId) || !liveRows.every((r) => isEncryptedEnvelope(r.metadata))) return;
  try {
    localStorage.setItem(ENCRYPTED_ONLY_KEY, JSON.stringify([...encryptedOnlyTeams(), teamId]));
  } catch {
    // Storage unavailable: the allowance just stays open, as it was.
  }
}

/**
 * True when `object` — a row's decoded metadata — is the object the row names.
 * Every writer stores an object under its own id, so a mismatch is an
 * envelope moved onto another row: a connection's host swapped in under
 * another connection whose credentials would then be sent to it.
 */
export function isBoundToRow(row: Row, object: unknown): boolean {
  return (object as { id?: unknown } | null)?.id === row.object_id;
}

/**
 * The object a team row carries, or a throw when it can't be trusted: a
 * plaintext row the team no longer allows, an envelope that won't decrypt, or
 * metadata belonging to another object.
 */
export async function decodeTeamObject(teamId: string, row: Row): Promise<object> {
  if (!isEncryptedEnvelope(row.metadata) && !acceptsPlaintextRows(teamId)) {
    throw new Error(`plaintext row ${row.object_id} in team ${teamId}, whose objects are all encrypted`);
  }
  const object = await decodeObjectMetadata(teamId, row.metadata);
  if (!isBoundToRow(row, object)) {
    throw new Error(`row ${row.object_id} carries the metadata of another object`);
  }
  return object;
}
