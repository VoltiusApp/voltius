import { useTeamStore } from "@/stores/teamStore";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";

const MIN_GAP_MS = 60_000;

let _lastRun = -Infinity;
let _trailing: ReturnType<typeof setTimeout> | null = null;

async function refetchLoadedVaults(): Promise<void> {
  _trailing = null;
  _lastRun = Date.now();
  const { fetchTeamData } = await import("@/services/teamVaultSync");
  const { statusByTeamId } = useTeamVaultStateStore.getState();
  for (const { id } of useTeamStore.getState().teams) {
    if (statusByTeamId[id] === "loaded") await fetchTeamData(id, { background: true });
  }
}

/** Team vaults only refresh on their own events: refetch the loaded ones after events may have been missed. */
export function catchUpTeamVaults(): void {
  if (_trailing) return;
  const wait = _lastRun + MIN_GAP_MS - Date.now();
  if (wait > 0) _trailing = setTimeout(() => void refetchLoadedVaults(), wait);
  else void refetchLoadedVaults();
}

export function cancelTeamVaultCatchUp(): void {
  if (_trailing) clearTimeout(_trailing);
  _trailing = null;
}
