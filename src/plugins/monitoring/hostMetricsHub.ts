import type { PluginAPI, PluginSession } from "@/plugins/api";
import type { MetricsService } from "./services";
import type { DiskInfo, MetricsSnapshot, SystemInfo } from "./types";

const MAX_HISTORY = 60;

export interface HostMetrics {
  snap: MetricsSnapshot | null;
  disks: DiskInfo[];
  disksLoading: boolean;
  cpuH: number[];
  memH: number[];
  rxH: number[];
  txH: number[];
}

export const EMPTY_HOST_METRICS: HostMetrics = {
  snap: null,
  disks: [],
  disksLoading: false,
  cpuH: [],
  memH: [],
  rxH: [],
  txH: [],
};

interface HostEntry {
  metrics: HostMetrics;
  listeners: Set<() => void>;
  stream?: { sessionId: string; stop: () => void };
  info?: Promise<SystemInfo>;
}

export type HostMetricsHub = ReturnType<typeof createHostMetricsHub>;

export function hostKey(session: Pick<PluginSession, "type" | "connectionId">): string {
  return `${session.type}:${session.connectionId}`;
}

/** Serial info is synthetic and ephemeral serial ports share one connectionId. */
export function systemInfoKey(session: PluginSession): string {
  return session.type === "serial" ? `serial:${session.id}` : hostKey(session);
}

function pushHistory(arr: number[], val: number): number[] {
  const next = [...arr, val];
  if (next.length > MAX_HISTORY) next.shift();
  return next;
}

function applySnapshot(m: HostMetrics, s: MetricsSnapshot): HostMetrics {
  return {
    snap: s,
    cpuH: pushHistory(m.cpuH, s.cpu_percent),
    memH: pushHistory(m.memH, s.mem_total_kb > 0 ? (s.mem_used_kb / s.mem_total_kb) * 100 : 0),
    rxH: pushHistory(m.rxH, s.net_rx_bytes_per_sec),
    txH: pushHistory(m.txH, s.net_tx_bytes_per_sec),
    disks: s.disks ?? m.disks,
    disksLoading: s.disks ? false : m.disksLoading,
  };
}

/** One metrics stream per host, shared by every tab of that host; history outlives the stream
 *  until the host's last session disconnects. */
export function createHostMetricsHub(
  service: MetricsService,
  sessions: Pick<PluginAPI["sessions"], "list" | "onDisconnected">,
) {
  const entries = new Map<string, HostEntry>();

  function entryFor(key: string): HostEntry {
    let entry = entries.get(key);
    if (!entry) {
      entry = { metrics: EMPTY_HOST_METRICS, listeners: new Set() };
      entries.set(key, entry);
    }
    return entry;
  }

  function setMetrics(entry: HostEntry, metrics: HostMetrics) {
    entry.metrics = metrics;
    entry.listeners.forEach((l) => l());
  }

  function stopStream(entry: HostEntry) {
    entry.stream?.stop();
    entry.stream = undefined;
  }

  function startStream(entry: HostEntry, session: PluginSession) {
    let cancelled = false;
    let streamId: string | null = null;
    let unlisten: (() => void) | null = null;
    entry.stream = {
      sessionId: session.id,
      stop: () => {
        cancelled = true;
        unlisten?.();
        if (streamId) service.metricsStop(streamId).catch(() => {});
      },
    };
    if (entry.metrics.disks.length === 0) setMetrics(entry, { ...entry.metrics, disksLoading: true });

    (async () => {
      try {
        const id = await service.metricsStart(session.id, session.type === "ssh");
        if (cancelled) {
          service.metricsStop(id).catch(() => {});
          return;
        }
        streamId = id;
        const off = await service.onMetricsSnapshot(id, (s) => {
          if (!cancelled) setMetrics(entry, applySnapshot(entry.metrics, s));
        });
        if (cancelled) off();
        else unlisten = off;
      } catch (e) {
        console.error("[monitoring] metrics_start failed:", e);
        if (!cancelled) setMetrics(entry, { ...entry.metrics, disksLoading: false });
      }
    })();
  }

  function liveSessionOf(key: string, exceptId?: string): PluginSession | undefined {
    return sessions
      .list()
      .find((s) => s.id !== exceptId && s.status === "connected" && hostKey(s) === key);
  }

  const offDisconnected = sessions.onDisconnected((gone) => {
    const key = hostKey(gone);
    const entry = entries.get(key);
    if (!entry) return;
    const survivor = liveSessionOf(key, gone.id);
    if (!survivor) {
      stopStream(entry);
      entries.delete(key);
    } else if (entry.stream?.sessionId === gone.id) {
      stopStream(entry);
      startStream(entry, survivor);
    }
  });

  return {
    metrics(key: string): HostMetrics {
      return entries.get(key)?.metrics ?? EMPTY_HOST_METRICS;
    },

    subscribe(session: PluginSession, listener: () => void): () => void {
      const entry = entryFor(hostKey(session));
      entry.listeners.add(listener);
      if (!entry.stream) startStream(entry, session);
      return () => {
        entry.listeners.delete(listener);
        if (entry.listeners.size === 0) stopStream(entry);
      };
    },

    ensureLive(session: PluginSession) {
      const entry = entries.get(hostKey(session));
      if (!entry?.stream) return;
      const riding = entry.stream.sessionId;
      if (sessions.list().some((s) => s.id === riding && s.status === "connected")) return;
      stopStream(entry);
      startStream(entry, session);
    },

    systemInfo(session: PluginSession): Promise<SystemInfo> {
      const fetch = () => service.getSystemInfo(session.id, session.type, session.connectionName);
      if (session.type === "serial") return fetch();
      const entry = entryFor(hostKey(session));
      entry.info ??= fetch().catch((e) => {
        entry.info = undefined;
        throw e;
      });
      return entry.info;
    },

    dispose() {
      offDisconnected();
      entries.forEach(stopStream);
      entries.clear();
    },
  };
}
