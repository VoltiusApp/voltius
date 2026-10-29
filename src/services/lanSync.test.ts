// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  handlers: new Map<string, (e: { payload: unknown }) => void>(),
  mutations: new Set<() => void>(),
  serverMode: true,
  vaultKey: [1] as number[] | null,
  blob: [9] as number[] | null,
  merged: false,
  openRemoteBlob: vi.fn(),
  mergeRemotePayload: vi.fn(),
  reloadAllStores: vi.fn(async () => {}),
  exportLocalBlob: vi.fn(async () => [7]),
  intro: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, fn: (e: { payload: unknown }) => void) => {
    h.handlers.set(name, fn);
    return () => { if (h.handlers.get(name) === fn) h.handlers.delete(name); };
  },
}));
vi.mock("@/services/account", () => ({ isServerMode: async () => h.serverMode }));
vi.mock("@/services/vault", () => ({ getVaultKey: () => h.vaultKey }));
vi.mock("@/services/lanSyncIntro", () => ({ ensureLanSyncIntro: h.intro }));
vi.mock("@/services/sync", async () => {
  const { buildDecryptKeyCandidates } = await import("@/services/vaultKeyCandidates");
  const { useVaultKeysStore } = await import("@/stores/vaultKeysStore");
  return {
    ENTITY_FILES: ["connections.json"],
    parseEntities: (json?: string) => JSON.parse(json ?? "[]"),
    getDeviceId: async () => "self",
    onRemotePayloadMerged: () => () => {},
    onLocalMutation: (fn: () => void) => {
      h.mutations.add(fn);
      return () => { h.mutations.delete(fn); };
    },
    sessionBlobKeys: () => {
      const { kek, dek } = useVaultKeysStore.getState();
      return buildDecryptKeyCandidates(h.vaultKey, kek, dek);
    },
    exportLocalBlob: h.exportLocalBlob,
    openRemoteBlob: h.openRemoteBlob,
    mergeRemotePayload: h.mergeRemotePayload,
    reloadAllStores: h.reloadAllStores,
    startRealtimeSync: vi.fn(),
  };
});

import { setLanSyncPaused, startLanSync, stopLanSync } from "./lanSync";
import { useLanSyncStore } from "@/stores/lanSyncStore";
import { useVaultKeysStore } from "@/stores/vaultKeysStore";

const OWN_PAYLOAD = { files: { "connections.json": JSON.stringify([{ id: "c", updated_at: "4" }]) }, secrets: {} };
const peer = (deviceId: string) => ({ deviceId, deviceName: deviceId, platform: "linux", route: "lan", address: "a" });
const calls = (cmd: string) => h.invoke.mock.calls.filter(([c]) => c === cmd);
const broadcasts = () => calls("lan_sync_broadcast").length;
const emit = (name: string, payload: unknown) => h.handlers.get(`lan-sync://${name}`)?.({ payload });
const settle = () => vi.advanceTimersByTimeAsync(1000);

beforeEach(() => {
  vi.useFakeTimers();
  h.invoke.mockReset().mockImplementation(async (cmd: string) => {
    if (cmd === "device_hostname") return "host";
    if (cmd === "lan_sync_take_blob") return h.blob;
    return undefined;
  });
  h.serverMode = true;
  h.vaultKey = [1];
  h.blob = [9];
  h.openRemoteBlob.mockReset().mockResolvedValue(OWN_PAYLOAD);
  h.mergeRemotePayload.mockReset().mockImplementation(async () => h.merged);
  h.merged = false;
  h.reloadAllStores.mockClear();
  h.exportLocalBlob.mockClear();
  useVaultKeysStore.setState({ dek: null, kek: null });
  useLanSyncStore.setState({ paused: false, peers: [], known: {}, syncing: new Set(), status: "stopped", localClocks: {} });
});

afterEach(async () => {
  await stopLanSync();
  await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
});

async function started() {
  await startLanSync();
  await vi.advanceTimersByTimeAsync(0);
  h.invoke.mockClear();
  h.exportLocalBlob.mockClear();
}

describe("lanSync", () => {
  test("does not start for no-account installs", async () => {
    h.serverMode = false;
    await startLanSync();
    expect(calls("lan_sync_start")).toHaveLength(0);
    expect(h.handlers.size).toBe(0);
  });

  test("starts with every distinct vault key candidate", async () => {
    useVaultKeysStore.setState({ kek: [2], dek: [3] });
    await startLanSync();
    expect(calls("lan_sync_start")[0][1]).toEqual({ deviceId: "self", deviceName: "host", authKeys: [[1], [2], [3]] });
    await stopLanSync();
    useVaultKeysStore.setState({ kek: [1], dek: [3] });
    await startLanSync();
    expect(calls("lan_sync_start")[1][1].authKeys).toEqual([[1], [3]]);
  });

  test("applies the persisted paused flag before starting", async () => {
    useLanSyncStore.setState({ paused: true });
    await startLanSync();
    const order = h.invoke.mock.calls.map(([c]) => c);
    expect(h.invoke).toHaveBeenCalledWith("lan_sync_set_paused", { paused: true });
    expect(order.indexOf("lan_sync_set_paused")).toBeLessThan(order.indexOf("lan_sync_start"));
  });

  test("new peer gets our blob once", async () => {
    await started();
    emit("peers", [peer("A")]);
    emit("peers", [peer("A")]);
    await settle();
    expect(broadcasts()).toBe(1);
    expect(useLanSyncStore.getState().known.A).toBeDefined();
  });

  test("received blob that changes state reloads and rebroadcasts", async () => {
    await started();
    h.merged = true;
    emit("blob-ready", { deviceId: "A" });
    await settle();
    expect(h.mergeRemotePayload).toHaveBeenCalledWith("A", OWN_PAYLOAD);
    expect(h.reloadAllStores).toHaveBeenCalled();
    expect(broadcasts()).toBe(1);
  });

  test("received blob with no change does not rebroadcast", async () => {
    await started();
    emit("blob-ready", { deviceId: "A" });
    await settle();
    expect(h.mergeRemotePayload).toHaveBeenCalled();
    expect(h.reloadAllStores).not.toHaveBeenCalled();
    expect(broadcasts()).toBe(0);
  });

  test("local mutation broadcasts after 1 s debounce", async () => {
    await started();
    h.mutations.forEach((fn) => fn());
    await vi.advanceTimersByTimeAsync(500);
    h.mutations.forEach((fn) => fn());
    h.mutations.forEach((fn) => fn());
    await vi.advanceTimersByTimeAsync(999);
    expect(broadcasts()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(broadcasts()).toBe(1);
  });

  test("paused: no broadcast on mutation", async () => {
    await started();
    await setLanSyncPaused(true);
    h.mutations.forEach((fn) => fn());
    await settle();
    expect(broadcasts()).toBe(0);
  });

  test("lock or logout stops lan sync and clears trust", async () => {
    await started();
    emit("peers", [peer("A")]);
    await stopLanSync();
    expect(calls("lan_sync_stop")).toHaveLength(1);
    expect(useLanSyncStore.getState().peers).toEqual([]);
    expect(useLanSyncStore.getState().status).toBe("stopped");
    expect(h.handlers.size).toBe(0);
    expect(h.mutations.size).toBe(0);
  });

  test("undecryptable blob is dropped without throwing", async () => {
    await started();
    h.openRemoteBlob.mockRejectedValueOnce(new Error("Decryption failed"));
    emit("blob-ready", { deviceId: "A" });
    await settle();
    expect(h.mergeRemotePayload).not.toHaveBeenCalled();
    expect(useLanSyncStore.getState().syncing.size).toBe(0);
  });

  test("repeated start and stop never double-subscribes", async () => {
    for (let i = 0; i < 3; i++) await startLanSync();
    expect(h.handlers.size).toBe(3);
    expect(h.mutations.size).toBe(1);
    await stopLanSync();
    await startLanSync();
    expect(h.handlers.size).toBe(3);
    expect(h.mutations.size).toBe(1);
  });

  test("a merge that also fires a local mutation exports and broadcasts once", async () => {
    await started();
    h.merged = true;
    h.reloadAllStores.mockImplementationOnce(async () => h.mutations.forEach((fn) => fn()));
    emit("blob-ready", { deviceId: "A" });
    await settle();
    await settle();
    expect(h.exportLocalBlob).toHaveBeenCalledTimes(1);
    expect(broadcasts()).toBe(1);
  });

  test("requests during a running broadcast cause exactly one follow-up", async () => {
    await started();
    let release!: () => void;
    h.exportLocalBlob.mockImplementationOnce(() => new Promise((r) => { release = () => r([7]); }));
    h.mutations.forEach((fn) => fn());
    await settle();
    for (let i = 0; i < 3; i++) {
      h.mutations.forEach((fn) => fn());
      await settle();
    }
    expect(h.exportLocalBlob).toHaveBeenCalledTimes(1);
    release();
    await settle();
    expect(h.exportLocalBlob).toHaveBeenCalledTimes(2);
    expect(broadcasts()).toBe(2);
  });

  test("local clocks come from our own outgoing payload", async () => {
    await startLanSync();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.openRemoteBlob).toHaveBeenCalledWith([[1]], [7]);
    expect(useLanSyncStore.getState().localClocks).toEqual({ "connections.json:c": "4" });
  });

  test("restarts when a new vault key arrives, not when keys are only dropped", async () => {
    useVaultKeysStore.setState({ kek: [2] });
    await started();
    useVaultKeysStore.setState({ kek: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls("lan_sync_start")).toHaveLength(0);
    useVaultKeysStore.setState({ dek: [5] });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls("lan_sync_start").map(([, a]) => a.authKeys)).toEqual([[[1], [5]]]);
    expect(h.handlers.size).toBe(3);
  });

  test("stopping during the intro prompt keeps it from starting", async () => {
    let confirm!: () => void;
    h.intro.mockImplementationOnce(() => new Promise<void>((r) => { confirm = r; }));
    const run = startLanSync();
    await vi.advanceTimersByTimeAsync(0);
    await stopLanSync();
    confirm();
    await run;
    expect(calls("lan_sync_start")).toHaveLength(0);
  });

  test("stopped status and departed peers clear peers and syncing marks", async () => {
    await started();
    emit("peers", [peer("A"), peer("B"), peer("self")]);
    await settle();
    expect(useLanSyncStore.getState().peers.map((p) => p.deviceId)).toEqual(["A", "B"]);
    useLanSyncStore.getState().markSyncing("B", true);
    emit("peers", [peer("A")]);
    expect(useLanSyncStore.getState().syncing.has("B")).toBe(false);
    emit("status", "stopped");
    expect(useLanSyncStore.getState().peers).toEqual([]);
    emit("peers", [peer("A")]);
    await settle();
    expect(broadcasts()).toBe(2);
  });
});
