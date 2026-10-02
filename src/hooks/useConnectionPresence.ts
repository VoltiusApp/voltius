import { useMemo } from "react";
import type { Connection } from "@/types";
import { useConnectionPresenceStore } from "@/stores/connectionPresenceStore";
import { useTeamStore } from "@/stores/teamStore";
import { avatarLabel, resolvePeerName } from "@/services/peerName";

export interface ConnectionPresence {
  primary: { id: string; name: string; avatar: string };
  overflow: number;
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

    const resolved = others.map((id) => {
      const peer = resolvePeerName(membersByTeam, id, { teamId: vaultId });
      return { id, name: peer.primary, avatar: avatarLabel(peer) };
    });
    return {
      primary: resolved[0],
      overflow: resolved.length - 1,
    };
  }, [vaultId, connection.id, userIds, myUserId, membersByTeam]);
}
