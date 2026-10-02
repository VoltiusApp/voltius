import { useMemo } from "react";
import type { Connection } from "@/types";
import { useConnectionPresenceStore } from "@/stores/connectionPresenceStore";
import { useTeamStore } from "@/stores/teamStore";
import { resolvePeerName } from "@/services/peerName";

export interface ConnectionPresence {
  primary: { id: string; name: string };
  overflow: number;
  /** All non-self handles in usage order (primary first). Useful for tooltips. */
  allHandles: string[];
}

/**
 * Returns presence info for a single host card. Renders nothing when:
 *   - the connection is not in a team vault, or
 *   - no teammates are currently broadcasting usage for it.
 *
 * The first non-self user becomes the visible avatar; remaining users
 * collapse into an "+N" overflow chip.
 */
export function useConnectionPresence(connection: Connection): ConnectionPresence | null {
  const vaultId = connection.vault_id;
  const userIds = useConnectionPresenceStore((s) => s.usageByConnection[connection.id]);
  const myUserId = useConnectionPresenceStore((s) => s.myUserId);
  const membersByTeam = useTeamStore((s) => s.membersByTeam);

  return useMemo(() => {
    if (!vaultId || vaultId === "personal") return null;
    if (!userIds || userIds.length === 0) return null;

    const others = myUserId ? userIds.filter((id) => id !== myUserId) : userIds.slice();
    if (others.length === 0) return null;

    const resolved = others.map((id) => ({ id, name: resolvePeerName(membersByTeam, id, { teamId: vaultId }).primary }));
    return {
      primary: resolved[0],
      overflow: resolved.length - 1,
      allHandles: resolved.map((r) => r.name),
    };
  }, [vaultId, connection.id, userIds, myUserId, membersByTeam]);
}
