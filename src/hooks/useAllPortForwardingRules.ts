import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import { useTeamStore } from "@/stores/teamStore";
import type { PortForwardingRule } from "@/types";

function isAlive(rule: PortForwardingRule): boolean {
  return !rule.deleted_at || rule.updated_at > rule.deleted_at;
}

export function useAllPortForwardingRules(): PortForwardingRule[] {
  const personal = usePortForwardingStore((s) => s.rules);
  const teamMap = usePortForwardingStore((s) => s.teamRules);
  const teamIds = useTeamStore(useShallow((s) => s.teams.map((t) => t.id)));

  return useMemo(() => {
    const map = new Map<string, PortForwardingRule>();
    for (const rule of personal) if (isAlive(rule)) map.set(rule.id, rule);
    for (const teamId of teamIds) {
      for (const rule of teamMap[teamId] ?? []) {
        if (isAlive(rule)) map.set(rule.id, rule);
      }
    }
    return [...map.values()];
  }, [personal, teamMap, teamIds]);
}
