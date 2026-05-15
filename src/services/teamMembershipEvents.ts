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
  await deps.loadTeams();
  const nextTeamIds = deps.getTeamIds();
  const delta = getTeamMembershipDelta(prevTeamIds, nextTeamIds);

  await Promise.all([
    ...delta.added.map((teamId) => deps.onTeamAdded?.(teamId)),
    ...delta.removed.map((teamId) => deps.onTeamRemoved?.(teamId)),
  ]);
}
