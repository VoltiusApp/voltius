import type { PluginHistoryEntry } from "../api";

export interface HistoryEntry {
  id: string;
  command: string;
  timestamp: number;
  sessionId: string;
  sessionName: string;
  connectionId: string;
}

export interface HistoryPorts {
  list(): HistoryEntry[];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const project = (h: HistoryEntry): PluginHistoryEntry => ({
  id: h.id,
  command: h.command,
  timestamp: h.timestamp,
  session_id: h.sessionId,
  session_name: h.sessionName,
  connection_id: h.connectionId,
});

export function createHistoryAPI(ports: HistoryPorts) {
  return {
    search(filter: {
      query?: string; connectionId?: string; sessionId?: string; limit?: number;
    }): PluginHistoryEntry[] {
      const q = filter.query?.toLowerCase();
      const limit = Math.min(filter.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
      return ports
        .list()
        .filter((h) =>
          (q === undefined || h.command.toLowerCase().includes(q))
          && (filter.connectionId === undefined || h.connectionId === filter.connectionId)
          && (filter.sessionId === undefined || h.sessionId === filter.sessionId))
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit)
        .map(project);
    },
  };
}

export type HistoryAPI = ReturnType<typeof createHistoryAPI>;
