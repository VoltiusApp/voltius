import { useTeamStore } from "@/stores/teamStore";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";

const MIN_GAP_MS = 60_000;

const _seen = new Map<string, number>();
let _lastRun = -Infinity;
let _trailing: ReturnType<typeof setTimeout> | null = null;
let _refetchUnversioned = false;

export function listedDataVersion(teamId: string): number | undefined {
  return useTeamStore.getState().teams.find((t) => t.id === teamId)?.data_version;
}

export function noteTeamDataSeen(teamId: string, version: number | undefined): void {
  if (version !== undefined && version > (_seen.get(teamId) ?? -1)) _seen.set(teamId, version);
}

export function forgetTeamDataSeen(): void {
  _seen.clear();
}

async function refetchChangedVaults(): Promise<void> {
  const refetchUnversioned = _refetchUnversioned;
  _trailing = null;
  _refetchUnversioned = false;
  _lastRun = Date.now();
  await useTeamStore.getState().loadTeams();
  const { fetchTeamData } = await import("@/services/teamVaultSync");
  const { statusByTeamId } = useTeamVaultStateStore.getState();
  for (const { id, data_version } of useTeamStore.getState().teams) {
    if (statusByTeamId[id] !== "loaded") continue;
    const changed = data_version === undefined ? refetchUnversioned : data_version > (_seen.get(id) ?? -1);
    if (changed) await fetchTeamData(id, { background: true });
  }
}

/**
 * Team vaults only refresh on their own events: refetch the loaded ones whose listed version moved.
 * `refetchUnversioned` also refetches teams from a server that lists no version.
 */
export function catchUpTeamVaults({ refetchUnversioned }: { refetchUnversioned: boolean }): void {
  _refetchUnversioned ||= refetchUnversioned;
  if (_trailing) return;
  const wait = _lastRun + MIN_GAP_MS - Date.now();
  if (wait > 0) _trailing = setTimeout(() => void refetchChangedVaults(), wait);
  else void refetchChangedVaults();
}

export function cancelTeamVaultCatchUp(): void {
  if (_trailing) clearTimeout(_trailing);
  _trailing = null;
  _refetchUnversioned = false;
}
