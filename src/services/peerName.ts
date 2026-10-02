import { useCallback } from "react";
import i18n from "@/i18n";
import type { TeamMember } from "@/services/teamService";
import { useTeamStore } from "@/stores/teamStore";
import type { PeerContext, PeerName } from "@/services/memberLabel";

export { memberLabel, memberSortKey, avatarLabel, memberNamingSupported } from "@/services/memberLabel";
export type { PeerContext, PeerName } from "@/services/memberLabel";

export function resolvePeerName(
  membersByTeam: Record<string, TeamMember[]>,
  userId: string,
  ctx: PeerContext = {},
): PeerName {
  const teamIds = ctx.teamId ? [ctx.teamId] : Object.keys(membersByTeam).sort();
  const rows = teamIds
    .map((id) => membersByTeam[id]?.find((m) => m.user_id === userId))
    .filter((m): m is TeamMember => !!m);
  const name = rows.find((m) => m.member_name)?.member_name ?? null;
  const handle = rows.find((m) => m.handle)?.handle ?? ctx.fallbackHandle ?? null;
  const primary = name ?? (handle ? `@${handle}` : i18n.t("common.memberFallback"));
  return { name, handle, primary };
}

export function usePeerResolver(): (userId: string, ctx?: PeerContext) => PeerName {
  const membersByTeam = useTeamStore((s) => s.membersByTeam);
  return useCallback((userId, ctx) => resolvePeerName(membersByTeam, userId, ctx), [membersByTeam]);
}
