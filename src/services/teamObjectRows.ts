import { decodeObjectMetadata, isEncryptedEnvelope } from "@/services/teamObjectEnvelope";
import type { TeamObjectRecord } from "@/services/teamObjects";

// The envelope authenticates its payload but binds it to no row, and the server alone decides which
// rows are plaintext; these are the checks the current wire format allows.

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

/** False once this device has loaded `teamId` with every live row encrypted. */
export function acceptsPlaintextRows(teamId: string): boolean {
  return !encryptedOnlyTeams().includes(teamId);
}

export function noteTeamRows(teamId: string, liveRows: Row[]): void {
  if (liveRows.length === 0 || !liveRows.every((r) => isEncryptedEnvelope(r.metadata))) return;
  const teams = encryptedOnlyTeams();
  if (teams.includes(teamId)) return;
  try {
    localStorage.setItem(ENCRYPTED_ONLY_KEY, JSON.stringify([...teams, teamId]));
  } catch {
    // Storage unavailable: the allowance just stays open, as it was.
  }
}

// Every writer stores an object under its own id, so a mismatch is an envelope moved onto another row.
function isBoundToRow(row: Row, object: unknown): boolean {
  return (object as { id?: unknown } | null)?.id === row.object_id;
}

/** A plaintext row hydration shows; encrypting any other would vouch for what the server made up. */
export function isTrustedPlaintextRow(row: Row, allowPlaintext: boolean): boolean {
  return allowPlaintext && !isEncryptedEnvelope(row.metadata) && isBoundToRow(row, row.metadata);
}

export async function decodeTeamObject(
  teamId: string,
  row: Row,
  allowPlaintext?: boolean,
): Promise<object> {
  if (!isEncryptedEnvelope(row.metadata)) {
    if (!isTrustedPlaintextRow(row, allowPlaintext ?? acceptsPlaintextRows(teamId))) {
      throw new Error(`untrusted plaintext row ${row.object_id} in team ${teamId}`);
    }
    return row.metadata as object;
  }
  const object = await decodeObjectMetadata(teamId, row.metadata);
  if (!isBoundToRow(row, object)) {
    throw new Error(`row ${row.object_id} carries the metadata of another object`);
  }
  return object;
}
