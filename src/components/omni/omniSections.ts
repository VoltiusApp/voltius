export interface SectionBoundaries {
  joinCodeStart: number; joinCodeCount: number;
  quickConnectStart: number; quickConnectCount: number;
  activeStart: number; activeCount: number;
  teamSessionStart: number; teamSessionCount: number;
  recentStart: number; recentCount: number;
  hostStart: number; hostCount: number;
  localStart: number; localCount: number;
  keyStart: number; keyCount: number;
  identityStart: number; identityCount: number;
  snippetStart: number; snippetCount: number;
  actionStart: number; actionCount: number;
  toggleStart: number; toggleCount: number;
  settingsStart: number; settingsCount: number;
}

export function computeSectionBoundaries(
  items: { kind: string; id?: string }[],
  recentCount: number,
): SectionBoundaries {
  const count = (kind: string) => items.filter((i) => i.kind === kind).length;
  let idx = 0;
  const take = (n: number) => { const start = idx; idx += n; return start; };

  const joinCodeCount = count("join-code");
  const joinCodeStart = take(joinCodeCount);
  const quickConnectCount = count("quick-connect");
  const quickConnectStart = take(quickConnectCount);
  const activeCount = count("session");
  const activeStart = take(activeCount);
  const teamSessionCount = count("team-session");
  const teamSessionStart = take(teamSessionCount);
  const recentStart = take(recentCount);
  const hostCount = count("host") - recentCount;
  const hostStart = take(hostCount);
  const localCount = count("local-shell");
  const localStart = take(localCount);
  const keyCount = count("key");
  const keyStart = take(keyCount);
  const identityCount = count("identity");
  const identityStart = take(identityCount);
  const snippetCount = count("snippet");
  const snippetStart = take(snippetCount);
  const settingsCount = items.filter((i) => i.kind === "action" && (i.id ?? "").startsWith("open-settings:")).length;
  const actionCount = items.filter((i) => i.kind === "action" && !(i.id ?? "").startsWith("open-settings:")).length;
  const toggleCount = count("toggle");
  const actionStart = take(actionCount);
  const toggleStart = take(toggleCount);
  const settingsStart = idx;

  return {
    joinCodeStart, joinCodeCount, quickConnectStart, quickConnectCount, activeStart, activeCount,
    teamSessionStart, teamSessionCount, recentStart, recentCount, hostStart, hostCount,
    localStart, localCount, keyStart, keyCount, identityStart, identityCount,
    snippetStart, snippetCount, actionStart, actionCount, toggleStart, toggleCount,
    settingsStart, settingsCount,
  };
}
