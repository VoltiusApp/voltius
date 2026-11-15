import { useConnectionStore } from "@/stores/connectionStore";
import { useTeamObjectAccessStore } from "@/stores/teamObjectAccessStore";
import { PERM_BITS } from "@/services/permissions";
import { emitConnectionsRevoked } from "@/services/connectionRevocations";
import type { TeamObjectRecord } from "@/services/teamObjects";

const listedByTeam = new Map<string, Set<string>>();

export function teamConnectionIds(teamId: string): string[] {
  return (useConnectionStore.getState().teamConnections[teamId] ?? []).map((c) => c.id);
}

/** Call before asking the server; pass the result to `closeConnectionsLost` once it answers. */
export function beginTeamAnswer(teamId: string): string[] {
  listedByTeam.delete(teamId);
  return teamConnectionIds(teamId);
}

function canConnectIn(teamId: string, connectionId: string): boolean {
  const mask = useTeamObjectAccessStore.getState().byTeam[teamId]?.[connectionId]?.myPermissions;
  return mask === undefined || (mask & PERM_BITS.CONNECT) !== 0;
}

/** The server's own listing counts, so a row this device fails to decode is not mistaken for a revocation. */
export function noteListedConnections(teamId: string, rows: TeamObjectRecord[]): void {
  const connectable = rows.filter((r) =>
    r.object_type === "connection" && !r.deleted_at
    && (typeof r.my_permissions !== "number" || (r.my_permissions & PERM_BITS.CONNECT) !== 0));
  listedByTeam.set(teamId, new Set(connectable.map((r) => r.object_id)));
}

/** A host moved out of `teamId` into a vault the user still reaches keeps its sessions. */
function stillConnectable(teamId: string, connectionId: string): boolean {
  if (listedByTeam.get(teamId)?.has(connectionId)) return true;
  const { connections, teamConnections } = useConnectionStore.getState();
  if (connections.some((c) => c.id === connectionId && c.vault_id !== teamId)) return true;
  return Object.entries(teamConnections).some(
    ([holder, items]) => items.some((c) => c.id === connectionId) && canConnectIn(holder, connectionId),
  );
}

/** `before`: the team's connection ids prior to a server answer that replaced the team's stores. */
export function closeConnectionsLost(teamId: string, before: string[]): void {
  const revoked = new Set(before.filter((id) => !stillConnectable(teamId, id)));
  listedByTeam.delete(teamId);
  if (revoked.size > 0) emitConnectionsRevoked(revoked);
}
