import { log } from "@/lib/logger";

export interface TeamMembershipEventDeps {
  getTeamIds: () => string[];
  loadTeams: () => Promise<void>;
  onTeamAdded?: (teamId: string) => Promise<void> | void;
  onTeamRemoved?: (teamId: string) => Promise<void> | void;
}

export interface MembershipChangedEvent {
  kind: "added" | "removed";
  teamId: string;
}

/** Parses `membership_changed:added:{team_id}` / `membership_changed:removed:{team_id}`. */
export function parseMembershipChangedEvent(eventData: string): MembershipChangedEvent | null {
  const prefix = "membership_changed:";
  if (!eventData.startsWith(prefix)) return null;
  const rest = eventData.slice(prefix.length);
  const sep = rest.indexOf(":");
  if (sep === -1) return null;
  const kind = rest.slice(0, sep);
  const teamId = rest.slice(sep + 1);
  if ((kind !== "added" && kind !== "removed") || !teamId) return null;
  return { kind, teamId };
}

export function getTeamMembershipDelta(prevTeamIds: string[], nextTeamIds: string[]) {
  const prev = new Set(prevTeamIds);
  const next = new Set(nextTeamIds);
  return {
    added: nextTeamIds.filter((teamId) => !prev.has(teamId)),
    removed: prevTeamIds.filter((teamId) => !next.has(teamId)),
  };
}

export async function handleMembershipChangedEvent(deps: TeamMembershipEventDeps): Promise<void> {
  const prevTeamIds = deps.getTeamIds();

  // loadTeams() reports its own failures but still resolves — if listTeams() had
  // a transient failure, the returned list equals prevTeamIds and the delta is
  // zero. Retry with backoff so a brief network hiccup doesn't leave the user
  // staring at a vault they were just kicked from (or missing a vault they just
  // joined).
  let nextTeamIds = prevTeamIds;
  let sawDelta = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise<void>((r) => setTimeout(r, 1000 * attempt));
    await deps.loadTeams();
    nextTeamIds = deps.getTeamIds();
    const { added, removed } = getTeamMembershipDelta(prevTeamIds, nextTeamIds);
    sawDelta = added.length > 0 || removed.length > 0;
    if (sawDelta) break;
  }
  // Expected on a key-wrap notification, which every member of the team also
  // receives; only interesting when chasing a removal that never applied (#233).
  if (!sawDelta) log.debug("membership_changed: no membership delta after 3 attempts");

  const delta = getTeamMembershipDelta(prevTeamIds, nextTeamIds);

  await Promise.all([
    ...delta.added.map((teamId) => deps.onTeamAdded?.(teamId)),
    ...delta.removed.map((teamId) => deps.onTeamRemoved?.(teamId)),
  ]);
}
