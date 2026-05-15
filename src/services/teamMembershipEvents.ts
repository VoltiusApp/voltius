export interface TeamMembershipEventDeps {
  getTeamIds: () => string[];
  loadTeams: () => Promise<void>;
  onTeamAdded?: (teamId: string) => Promise<void> | void;
  onTeamRemoved?: (teamId: string) => Promise<void> | void;
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

  // loadTeams() swallows its own errors — if listTeams() had a transient failure,
  // the returned list equals prevTeamIds and the delta is zero. Retry with backoff
  // so a brief network hiccup doesn't leave the user staring at a vault they were
  // just kicked from (or missing a vault they just joined).
  let nextTeamIds = prevTeamIds;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise<void>((r) => setTimeout(r, 1000 * attempt));
    await deps.loadTeams();
    nextTeamIds = deps.getTeamIds();
    const { added, removed } = getTeamMembershipDelta(prevTeamIds, nextTeamIds);
    if (added.length > 0 || removed.length > 0) break;
  }

  const delta = getTeamMembershipDelta(prevTeamIds, nextTeamIds);

  await Promise.all([
    ...delta.added.map((teamId) => deps.onTeamAdded?.(teamId)),
    ...delta.removed.map((teamId) => deps.onTeamRemoved?.(teamId)),
  ]);
}
