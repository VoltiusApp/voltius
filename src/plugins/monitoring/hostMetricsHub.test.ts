import { describe, expect, it, vi } from "vitest";
import type { PluginSession } from "@/plugins/api";
import type { MetricsService } from "./services";
import type { MetricsSnapshot } from "./types";
import { createHostMetricsHub, hostKey } from "./hostMetricsHub";

function session(id: string, connectionId: string, type = "ssh"): PluginSession {
  return { id, connectionId, connectionName: connectionId, status: "connected", type };
}

function snapshot(cpu: number): MetricsSnapshot {
  return {
    ts: 0,
    cpu_percent: cpu,
    mem_used_kb: 1,
    mem_total_kb: 2,
    net_rx_bytes_per_sec: 0,
    net_tx_bytes_per_sec: 0,
    disks: null,
  };
}

function setup(initial: PluginSession[]) {
  let live = initial;
  let nextStream = 0;
  const emitters = new Map<string, (s: MetricsSnapshot) => void>();
  const disconnectCbs = new Set<(s: PluginSession) => void>();
  const service: MetricsService = {
    metricsStart: vi.fn(async () => `stream-${++nextStream}`),
    metricsStop: vi.fn(async () => {}),
    onMetricsSnapshot: vi.fn(async (id: string, cb: (s: MetricsSnapshot) => void) => {
      emitters.set(id, cb);
      return () => emitters.delete(id);
    }),
    getSystemInfo: vi.fn(async () => ({}) as never),
  };
  const sessions = {
    list: () => live,
    onDisconnected: (cb: (s: PluginSession) => void) => {
      disconnectCbs.add(cb);
      return () => disconnectCbs.delete(cb);
    },
  };
  const hub = createHostMetricsHub(service, sessions);
  const disconnect = (s: PluginSession) => {
    live = live.filter((x) => x.id !== s.id);
    disconnectCbs.forEach((cb) => cb(s));
  };
  const emit = (streamId: string, cpu: number) => emitters.get(streamId)?.(snapshot(cpu));
  return { hub, service, disconnect, emit };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("host metrics hub", () => {
  it("keeps one stream and its history across tabs of the same host", async () => {
    const a = session("a", "host-1");
    const b = session("b", "host-1");
    const { hub, service, emit } = setup([a, b]);

    const offA = hub.subscribe(a, () => {});
    await flush();
    emit("stream-1", 10);
    hub.ensureLive(b);
    const offB = hub.subscribe(b, () => {});
    offA();
    await flush();
    emit("stream-1", 20);

    expect(service.metricsStart).toHaveBeenCalledTimes(1);
    expect(service.metricsStop).not.toHaveBeenCalled();
    expect(hub.metrics(hostKey(b)).cpuH).toEqual([10, 20]);
    offB();
  });

  it("moves the stream to a surviving tab when its session closes", async () => {
    const a = session("a", "host-1");
    const b = session("b", "host-1");
    const { hub, service, disconnect, emit } = setup([a, b]);

    const off = hub.subscribe(a, () => {});
    await flush();
    emit("stream-1", 10);
    disconnect(a);
    await flush();
    emit("stream-2", 30);

    expect(service.metricsStop).toHaveBeenCalledWith("stream-1");
    expect(service.metricsStart).toHaveBeenLastCalledWith("b", true);
    expect(hub.metrics(hostKey(b)).cpuH).toEqual([10, 30]);
    off();
  });

  it("restores a host's history after visiting another host", async () => {
    const a = session("a", "host-1");
    const c = session("c", "host-2");
    const { hub, emit } = setup([a, c]);

    const offA = hub.subscribe(a, () => {});
    await flush();
    emit("stream-1", 10);
    offA();
    const offC = hub.subscribe(c, () => {});
    offC();
    const offA2 = hub.subscribe(a, () => {});

    expect(hub.metrics(hostKey(a)).cpuH).toEqual([10]);
    offA2();
  });

  it("forgets a host once its last session disconnects", async () => {
    const a = session("a", "host-1");
    const { hub, disconnect, emit } = setup([a]);

    const off = hub.subscribe(a, () => {});
    await flush();
    emit("stream-1", 10);
    off();
    disconnect(a);

    expect(hub.metrics(hostKey(a)).cpuH).toEqual([]);
  });

  it("fetches system info once per host", async () => {
    const a = session("a", "host-1");
    const b = session("b", "host-1");
    const { hub, service } = setup([a, b]);

    await hub.systemInfo(a);
    await hub.systemInfo(b);

    expect(service.getSystemInfo).toHaveBeenCalledTimes(1);
  });
});
