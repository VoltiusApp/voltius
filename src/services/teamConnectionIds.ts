import { useConnectionStore } from "@/stores/connectionStore";

export function isTeamConnection(connectionId: string): boolean {
  return Object.values(useConnectionStore.getState().teamConnections).some((list) => list.some((c) => c.id === connectionId));
}
