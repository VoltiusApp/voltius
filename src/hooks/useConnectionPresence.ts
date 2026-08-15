import { useMemo } from "react";
import type { Connection } from "@/types";
import { useConnectionPresenceStore } from "@/stores/connectionPresenceStore";
import { useTeamStore } from "@/stores/teamStore";

export interface ConnectionPresence {
  primary: { id: string; handle: string };
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

    // Build a flat lookup across all loaded teams (a user appears once per team).
    const handleById = new Map<string, string>();
    for (const members of Object.values(membersByTeam)) {
      for (const m of members) {
        if (!handleById.has(m.user_id)) handleById.set(m.user_id, m.handle);
      }
    }

    const resolved = others.map((id) => ({ id, handle: handleById.get(id) ?? "Member" }));
    return {
      primary: resolved[0],
      overflow: resolved.length - 1,
      allHandles: resolved.map((r) => r.handle),
    };
  }, [vaultId, connection.id, userIds, myUserId, membersByTeam]);
}
