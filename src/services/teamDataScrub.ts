import { useConnectionStore } from "@/stores/connectionStore";
import { useCommandHistoryStore } from "@/stores/commandHistoryStore";
import { useHostCommandVarsStore } from "@/stores/hostCommandVarsStore";
import { isTeamConnection } from "@/services/teamConnectionIds";

export function scrubTeamDataFromDisk(): void {
  const history = useCommandHistoryStore.getState().entries;
  if (history.some((e) => !e.team && isTeamConnection(e.connectionId))) {
    useCommandHistoryStore.setState({
      entries: history.map((e) => (!e.team && isTeamConnection(e.connectionId) ? { ...e, team: true as const } : e)),
    });
  }
  const { values, teamKeys } = useHostCommandVarsStore.getState();
  const found = Object.keys(values).filter((k) => !teamKeys[k] && isTeamConnection(k.split(" ")[0]));
  if (found.length > 0) {
    useHostCommandVarsStore.setState({ teamKeys: { ...teamKeys, ...Object.fromEntries(found.map((k) => [k, true as const])) } });
  }
}

export function startTeamDataScrub(): () => void {
  scrubTeamDataFromDisk();
  return useConnectionStore.subscribe((s, prev) => {
    if (s.teamConnections !== prev.teamConnections) scrubTeamDataFromDisk();
  });
}
