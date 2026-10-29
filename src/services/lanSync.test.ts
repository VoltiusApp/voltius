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
  failListen: null as string | null,
  toast: vi.fn(),
  platform: "linux",
  visibility: "visible" as DocumentVisibilityState,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, fn: (e: { payload: unknown }) => void) => {
    if (h.failListen === name) throw new Error("listen failed");
    h.handlers.set(name, fn);
    return () => { if (h.handlers.get(name) === fn) h.handlers.delete(name); };
  },
}));
vi.mock("@/services/appToast", () => ({ appToast: h.toast }));
vi.mock("@/i18n", () => ({ default: { t: (key: string, o: { name: string }) => `${key}|${o.name}` } }));
vi.mock("@/services/account", () => ({ isServerMode: async () => h.serverMode }));
vi.mock("@/services/vault", () => ({ getVaultKey: () => h.vaultKey }));
vi.mock("@/services/lanSyncIntro", () => ({ ensureLanSyncIntro: h.intro }));
vi.mock("@/utils/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/platform")>()),
  getPlatformSync: () => h.platform,
}));
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
import { resolveLoginSync, setLoginSyncPending } from "./loginSyncGate";
import { useLanSyncStore } from "@/stores/lanSyncStore";
import { useVaultKeysStore } from "@/stores/vaultKeysStore";

const OWN_PAYLOAD = { files: { "connections.json": JSON.stringify([{ id: "c", updated_at: "4" }]) }, secrets: {} };
const peer = (deviceId: string) => ({ deviceId, deviceName: deviceId, platform: "linux", route: "lan", address: "a" });
const calls = (cmd: string) => h.invoke.mock.calls.filter(([c]) => c === cmd);
const broadcasts = () => calls("lan_sync_broadcast").length;
const emit = (name: string, payload: unknown) => h.handlers.get(`lan-sync://${name}`)?.({ payload });
const settle = () => vi.advanceTimersByTimeAsync(1000);
const bytes = (b: number[] | null) => new Uint8Array(b ?? []).buffer;
const nearby = (...ids: string[]) =>
  useLanSyncStore.setState({
    peers: ids.map(peer) as never,
    known: Object.fromEntries(ids.map((id) => [id, { name: id, platform: "linux", lastSeen: "1", lastRoute: "lan" }])),
  });
const toBackground = async (state: DocumentVisibilityState) => {
  h.visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
};

Object.defineProperty(document, "visibilityState", { configurable: true, get: () => h.visibility });

beforeEach(() => {
  vi.useFakeTimers();
  h.invoke.mockReset().mockImplementation(async (cmd: string) => {
    if (cmd === "device_hostname") return "host";
    if (cmd === "lan_sync_take_blob") return bytes(h.blob);
    return undefined;
  });
  h.serverMode = true;
  h.vaultKey = [1];
  h.blob = [9];
  h.openRemoteBlob.mockReset().mockResolvedValue(OWN_PAYLOAD);
  h.mergeRemotePayload.mockReset().mockImplementation(async () => h.merged);
  h.merged = false;
  h.failListen = null;
  h.platform = "linux";
  h.visibility = "visible";
  h.toast.mockClear();
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
  nearby("N");
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

  test("a peers event repeating a listed peer rebroadcasts, debounced", async () => {
    await started();
    emit("peers", [peer("A")]);
    await settle();
    emit("peers", [peer("A")]);
    emit("peers", [peer("A")]);
    await settle();
    expect(broadcasts()).toBe(2);
  });

  test("a peers event listing nobody does not broadcast", async () => {
    await started();
    emit("peers", []);
    await settle();
    expect(broadcasts()).toBe(0);
  });

  test("with no known devices a mutation neither exports nor broadcasts", async () => {
    await started();
    useLanSyncStore.setState({ peers: [], known: {} });
    h.openRemoteBlob.mockClear();
    h.mutations.forEach((fn) => fn());
    await settle();
    expect(h.exportLocalBlob).not.toHaveBeenCalled();
    expect(h.openRemoteBlob).not.toHaveBeenCalled();
    expect(broadcasts()).toBe(0);
  });

  test("known devices but none nearby: clocks refresh, nothing is broadcast", async () => {
    await started();
    useLanSyncStore.setState({ peers: [], localClocks: {} });
    h.mutations.forEach((fn) => fn());
    await settle();
    expect(useLanSyncStore.getState().localClocks).toEqual({ "connections.json:c": "4" });
    expect(broadcasts()).toBe(0);
  });

  test("blobs cross IPC as raw bytes", async () => {
    await started();
    h.mutations.forEach((fn) => fn());
    await settle();
    const [, sent] = calls("lan_sync_broadcast")[0];
    expect(sent).toBeInstanceOf(Uint8Array);
    expect([...(sent as Uint8Array)]).toEqual([7]);
    emit("blob-ready", { deviceId: "A" });
    await settle();
    expect(h.openRemoteBlob).toHaveBeenLastCalledWith([[1]], [9]);
  });

  test("an empty take means the blob is gone", async () => {
    await started();
    h.blob = null;
    emit("blob-ready", { deviceId: "A" });
    await settle();
    expect(h.mergeRemotePayload).not.toHaveBeenCalled();
  });

  test("on Android the background stops LAN sync and the foreground restarts it, still paused", async () => {
    h.platform = "android";
    useLanSyncStore.setState({ paused: true });
    await started();
    await toBackground("hidden");
    expect(calls("lan_sync_stop")).toHaveLength(1);
    expect(useLanSyncStore.getState().status).toBe("stopped");
    await toBackground("visible");
    const order = h.invoke.mock.calls.map(([c]) => c);
    expect(calls("lan_sync_start")).toHaveLength(1);
    expect(h.invoke).toHaveBeenCalledWith("lan_sync_set_paused", { paused: true });
    expect(order.lastIndexOf("lan_sync_set_paused")).toBeLessThan(order.indexOf("lan_sync_start"));
  });

  test("the foreground does not restart LAN sync stopped by a lock", async () => {
    h.platform = "android";
    await started();
    await stopLanSync();
    await toBackground("hidden");
    await toBackground("visible");
    expect(calls("lan_sync_start")).toHaveLength(0);
  });

  test("the foreground waits for a pending login sync", async () => {
    h.platform = "android";
    await started();
    await toBackground("hidden");
    setLoginSyncPending();
    await toBackground("visible");
    expect(calls("lan_sync_start")).toHaveLength(0);
    resolveLoginSync();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls("lan_sync_start")).toHaveLength(1);
  });

  test("desktop keeps LAN sync running in the background", async () => {
    await started();
    await toBackground("hidden");
    expect(calls("lan_sync_stop")).toHaveLength(0);
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
    expect(h.exportLocalBlob).not.toHaveBeenCalled();
    await setLanSyncPaused(false);
    await settle();
    expect(broadcasts()).toBe(1);
  });

  test("stop clears peers, listeners and the running manager", async () => {
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
    nearby("N");
    await startLanSync();
    await vi.advanceTimersByTimeAsync(0);
    expect(broadcasts()).toBe(1);
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

  test("waits for the login sync and the first sync before starting", async () => {
    setLoginSyncPending();
    let firstSyncDone!: () => void;
    const run = startLanSync(new Promise<void>((r) => { firstSyncDone = r; }));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls("lan_sync_start")).toHaveLength(0);
    resolveLoginSync();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls("lan_sync_start")).toHaveLength(0);
    firstSyncDone();
    await run;
    expect(calls("lan_sync_start")).toHaveLength(1);
  });

  test("starting again with the same keys keeps the running manager", async () => {
    await startLanSync();
    await startLanSync();
    expect(calls("lan_sync_start")).toHaveLength(1);
  });

  test("a failed start detaches every listener", async () => {
    h.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "lan_sync_start") throw new Error("bind failed");
      return cmd === "device_hostname" ? "host" : undefined;
    });
    await expect(startLanSync()).rejects.toThrow("bind failed");
    expect(h.handlers.size).toBe(0);
    expect(h.mutations.size).toBe(0);
  });

  test("a failed listen detaches, and the next start with the same keys recovers", async () => {
    h.failListen = "lan-sync://status";
    await expect(startLanSync()).rejects.toThrow("listen failed");
    expect(h.handlers.size).toBe(0);
    expect(h.mutations.size).toBe(0);
    h.failListen = null;
    await startLanSync();
    expect(calls("lan_sync_start")).toHaveLength(1);
    expect(h.handlers.size).toBe(3);
  });

  test("a new device toasts once with its route, reconnects and our own id do not", async () => {
    await started();
    emit("peers", [peer("A"), peer("self")]);
    emit("peers", []);
    emit("peers", [peer("A"), { ...peer("B"), route: "tailscale" }]);
    expect(h.toast.mock.calls).toEqual([
      ["info", "layout.sync.local.toast.lan|A"],
      ["info", "layout.sync.local.toast.tailscale|B"],
    ]);
  });

  test("stop returns within its bound while lan_sync_start hangs, then stops once it settles", async () => {
    let finishStart!: () => void;
    h.invoke.mockImplementation((cmd: string) =>
      cmd === "lan_sync_start" ? new Promise<void>((r) => { finishStart = r; }) : Promise.resolve(cmd === "device_hostname" ? "host" : undefined),
    );
    void startLanSync();
    await vi.advanceTimersByTimeAsync(0);
    let stopped = false;
    void stopLanSync().then(() => { stopped = true; });
    await vi.advanceTimersByTimeAsync(2000);
    expect(stopped).toBe(true);
    expect(calls("lan_sync_stop")).toHaveLength(0);
    finishStart();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls("lan_sync_stop")).toHaveLength(1);
  });

  test("a failed export does not wedge later broadcasts", async () => {
    await started();
    h.exportLocalBlob.mockRejectedValueOnce(new Error("vault locked"));
    h.mutations.forEach((fn) => fn());
    await settle();
    expect(broadcasts()).toBe(0);
    h.mutations.forEach((fn) => fn());
    await settle();
    expect(broadcasts()).toBe(1);
  });

  test("blobs queued behind a running merge are dropped once stopped", async () => {
    await started();
    let finishMerge!: () => void;
    h.mergeRemotePayload.mockImplementationOnce(() => new Promise<boolean>((r) => { finishMerge = () => r(false); }));
    emit("blob-ready", { deviceId: "A" });
    emit("blob-ready", { deviceId: "B" });
    await vi.advanceTimersByTimeAsync(0);
    const stopping = stopLanSync();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls("lan_sync_stop")).toHaveLength(0);
    finishMerge();
    await stopping;
    expect(calls("lan_sync_stop")).toHaveLength(1);
    expect(calls("lan_sync_take_blob").map(([, a]) => a.deviceId)).toEqual(["A"]);
  });
});
