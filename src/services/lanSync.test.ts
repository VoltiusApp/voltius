// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  handlers: new Map<string, (e: { payload: unknown }) => void>(),
  mutations: new Set<() => void>(),
  serverMode: true,
  accountId: "acct-1" as string | null,
  vaultKey: [1] as number[] | null,
  blob: [9] as number[] | null,
  merged: false,
  openRemoteBlob: vi.fn(),
  mergeRemotePayload: vi.fn(),
  reloadAllStores: vi.fn(async () => {}),
  exportLocalBlob: vi.fn(async () => [7]),
  intro: vi.fn(async () => {}),
  failListen: null as string | null,
  onMerged: new Set<(deviceId: string, payload: unknown) => void>(),
  toast: vi.fn(),
  platform: "linux",
  visibility: "visible" as DocumentVisibilityState,
  group: null as unknown,
  farewell: null as { secret: string; reason: "account" | "left"; group?: string; pending?: string[] } | null,
  holds: false,
  entities: 0,
  createGroup: vi.fn(),
  grantFor: vi.fn(),
  joinGroup: vi.fn(),
  forgetMember: vi.fn(),
  leaveGroup: vi.fn(),
  markMoved: vi.fn(),
  markLeft: vi.fn(),
  dropSecrets: vi.fn(),
  replaces: {} as Record<string, string>,
  pairInfo: vi.fn(),
  heldKeys: [] as string[],
  readGate: Promise.resolve() as Promise<void>,
  retireDuplicates: vi.fn(async () => {}),
  startFiles: vi.fn(async () => {}),
  stopFiles: vi.fn(async () => {}),
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
vi.mock("@/services/account", () => ({ isServerMode: async () => h.serverMode, getAccountId: async () => h.accountId }));
vi.mock("@/services/vault", () => ({ getVaultKey: () => h.vaultKey }));
vi.mock("@/services/deviceFiles", () => ({ startDeviceFiles: h.startFiles, stopDeviceFiles: h.stopFiles }));
vi.mock("@/services/lanSyncIntro", () => ({ ensureLanSyncIntro: h.intro }));
vi.mock("@/services/lanGroup", () => ({
  LAN_GROUP_FILE: "lan_group.json",
  readGroup: async () => {
    const group = h.group;
    await h.readGate;
    return group;
  },
  createGroupIfNeeded: h.createGroup,
  grantFor: h.grantFor,
  joinGroup: h.joinGroup,
  forgetMember: h.forgetMember,
  leaveGroup: h.leaveGroup,
  markMoved: h.markMoved,
  markLeft: h.markLeft,
  dropGroupSecrets: h.dropSecrets,
  holdsGroupSecrets: async () => h.holds,
  farewellSent: async (id: string) => {
    if (h.farewell?.pending) h.farewell = { ...h.farewell, pending: h.farewell.pending.filter((p) => p !== id) };
  },
  replacedMember: async (id: string, key: string) => (key === "k-new" ? h.replaces[id] : undefined),
  readFarewell: async () => h.farewell,
  localEntityCount: async () => h.entities,
  pairInfo: h.pairInfo,
  thisDevice: async () => ({ id: "self", name: "host" }),
  keyStillHeld: async (id: string) => h.heldKeys.includes(id),
  retireDuplicateKeys: h.retireDuplicates,
}));
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
    onRemotePayloadMerged: (fn: (deviceId: string, payload: unknown) => void) => {
      h.onMerged.add(fn);
      return () => { h.onMerged.delete(fn); };
    },
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

import {
  cancelPairing,
  closePairing,
  confirmPairing,
  forgetDevice,
  lanScope,
  leaveLanGroup,
  openPairing,
  setLanSyncPaused,
  startLanSync,
  stopLanSync,
} from "./lanSync";
import { resolveLoginSync, setLoginSyncPending } from "./loginSyncGate";
import { useLanSyncStore } from "@/stores/lanSyncStore";
import { useVaultKeysStore } from "@/stores/vaultKeysStore";

const INFO = { mode: "none", group: null, entities: 0, members: 0 };
const SESSION_EVENTS = 6;
const member = (id: string, extra: Record<string, string> = {}) =>
  ({ id, kind: "member", name: id, platform: "linux", device_key: `k-${id}`, joined_at: "1", updated_at: "2", clocks: {}, ...extra });
const GROUP = {
  groupId: "grp-1",
  secrets: [{ epoch: 2, secret: [6] }, { epoch: 1, secret: [5] }],
  members: [member("self"), member("A"), member("B"), member("X", { deleted_at: "3" })],
};
const ms = (...ids: string[]) => ids.map((id) => ({ deviceId: id, deviceKey: `k-${id}` }));
const GRANT = { groupId: "grp-1", vaultKey: "aa", secrets: [], hostName: "host" };
const OWN_PAYLOAD = { files: { "connections.json": JSON.stringify([{ id: "c", updated_at: "4" }]) }, secrets: {} };
const peer = (deviceId: string) => ({ deviceId, deviceName: deviceId, platform: "linux", route: "lan", address: "a", deviceKey: "key", files: false });
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
  h.accountId = "acct-1";
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
  h.intro.mockClear();
  h.group = null;
  h.farewell = null;
  h.entities = 0;
  h.createGroup.mockReset().mockImplementation(async () => GROUP);
  h.grantFor.mockReset().mockImplementation(async () => GRANT);
  h.joinGroup.mockReset().mockImplementation(async () => { h.group = GROUP; });
  for (const step of [h.forgetMember, h.leaveGroup, h.markMoved, h.markLeft]) step.mockReset().mockResolvedValue(undefined);
  h.holds = false;
  h.dropSecrets.mockReset().mockImplementation(async () => { h.holds = false; });
  h.replaces = {};
  h.pairInfo.mockReset().mockResolvedValue(INFO);
  h.heldKeys = [];
  h.readGate = Promise.resolve();
  h.retireDuplicates.mockClear();
  h.startFiles.mockClear();
  h.stopFiles.mockClear();
  useVaultKeysStore.setState({ dek: null, kek: null });
  useLanSyncStore.setState({
    paused: false, peers: [], known: {}, knownScope: undefined, syncing: new Set(), status: "stopped", localClocks: {},
    pairing: { state: "idle" }, presence: {}, rejected: {},
  });
});

afterEach(async () => {
  await closePairing();
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
  test("no_account_without_group_starts_nothing", async () => {
    h.serverMode = false;
    await startLanSync();
    expect(calls("lan_sync_start")).toHaveLength(0);
    expect(h.intro).not.toHaveBeenCalled();
    expect(h.handlers.size).toBe(0);
    expect(await lanScope()).toBeNull();
  });

  test("addresses_merged_before_start_are_learned_after_lan_sync_start", async () => {
    const addrs = (deviceId: string) => ({
      files: { "lan_sync_addresses.json": JSON.stringify({ v: 1, deviceId, addrs: ["100.101.1.2:47391"] }) },
      secrets: {},
    });
    const merged = (deviceId: string) => h.onMerged.forEach((fn) => fn(deviceId, addrs(deviceId)));
    merged("dev-b");
    await vi.advanceTimersByTimeAsync(0);
    expect(calls("lan_sync_learn")).toHaveLength(0);
    await startLanSync();
    await vi.advanceTimersByTimeAsync(0);
    const order = (cmd: string) => h.invoke.mock.invocationCallOrder[h.invoke.mock.calls.findIndex(([c]) => c === cmd)];
    expect(calls("lan_sync_learn")).toEqual([["lan_sync_learn", { deviceId: "dev-b", addrs: ["100.101.1.2:47391"] }]]);
    expect(order("lan_sync_learn")).toBeGreaterThan(order("lan_sync_start"));
    await stopLanSync();
    merged("dev-c");
    await vi.advanceTimersByTimeAsync(0);
    expect(calls("lan_sync_learn")).toHaveLength(1);
  });

  test("start passes the account id as scope", async () => {
    await startLanSync();
    expect(calls("lan_sync_start")[0][1].scope).toBe("acct-1");
    await stopLanSync();
    h.invoke.mockClear();
    h.accountId = null;
    await startLanSync();
    expect(calls("lan_sync_start")).toHaveLength(0);
  });

  test("starts with every distinct vault key candidate", async () => {
    useVaultKeysStore.setState({ kek: [2], dek: [3] });
    await startLanSync();
    expect(calls("lan_sync_start")[0][1]).toStrictEqual({ deviceId: "self", deviceName: "host", authKeys: [[1], [2], [3]], scope: "acct-1" });
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
    expect(h.handlers.size).toBe(SESSION_EVENTS);
    expect(h.mutations.size).toBe(1);
    await stopLanSync();
    await startLanSync();
    expect(h.handlers.size).toBe(SESSION_EVENTS);
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
    expect(h.handlers.size).toBe(SESSION_EVENTS);
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
    expect(h.handlers.size).toBe(SESSION_EVENTS);
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

const pairing = () => useLanSyncStore.getState().pairing;
const pair = async (payload: unknown) => {
  emit("pair", payload);
  await vi.advanceTimersByTimeAsync(0);
};
const CODE = { state: "code", sas: 123456, peerId: "P", peerKey: "k-P", peerName: "Desk", peerPlatform: "linux", peerEntities: 4 };
const mergeFrom = async (deviceId: string) => {
  h.merged = true;
  emit("blob-ready", { deviceId });
  await settle();
};
const withMembers = (...members: ReturnType<typeof member>[]) => ({ ...GROUP, members });
const LEFT = { secret: "ff".repeat(32), reason: "left" as const, group: "grp-1", pending: ["A", "B"] };
const SAYS_FAREWELL = { deviceId: "self", deviceName: "host", scope: "grp-1", authKeys: [], members: [], farewell: "ff".repeat(32), farewellLeft: true };

describe("no-account groups", () => {
  beforeEach(() => {
    h.serverMode = false;
  });

  test("grouped_no_account_starts_with_group_scope_and_secrets_only", async () => {
    h.group = GROUP;
    h.farewell = { secret: "ff".repeat(32), reason: "left", group: "grp-0" };
    useVaultKeysStore.setState({ kek: [2], dek: [3] });
    await startLanSync();
    const [[, args]] = calls("lan_sync_start");
    expect(args).toStrictEqual({
      deviceId: "self",
      deviceName: "host",
      scope: "grp-1",
      authKeys: [[6], [5]],
      members: ms("self", "A", "B"),
    });
    for (const vaultKey of [[1], [2], [3]]) expect(args.authKeys).not.toContainEqual(vaultKey);
    expect(await lanScope()).toStrictEqual({ scope: "grp-1", authKeys: [[6], [5]], members: ms("self", "A", "B") });
  });

  test("group_change_restarts_with_new_keys", async () => {
    h.group = GROUP;
    await started();
    h.group = { ...GROUP, secrets: [{ epoch: 3, secret: [7] }, ...GROUP.secrets] };
    await mergeFrom("A");
    expect(calls("lan_sync_start").map(([, a]) => a.authKeys)).toEqual([[[7], [6], [5]]]);
    expect(h.handlers.size).toBe(SESSION_EVENTS);
  });

  test("a members-only change updates the manager without restarting it", async () => {
    h.group = GROUP;
    await started();
    h.group = withMembers(...GROUP.members, member("C"));
    await mergeFrom("A");
    expect(calls("lan_sync_start")).toHaveLength(0);
    expect(calls("lan_sync_set_members").map(([, a]) => a)).toEqual([{ members: ms("self", "A", "B", "C") }]);
  });

  test("a third member re-pins a member once it merges the entry that vouches its new key", async () => {
    h.group = GROUP;
    await started();
    h.group = withMembers(member("self"), member("A", { device_key: "k-A2" }), member("B"), GROUP.members[3]);
    await mergeFrom("B");
    expect(calls("lan_sync_set_members").map(([, a]) => a)).toEqual([
      { members: [...ms("self"), { deviceId: "A", deviceKey: "k-A2" }, ...ms("B")] },
    ]);
  });

  test("a revived member is vouched again, and duplicate keys are retired after every group merge", async () => {
    h.group = withMembers(member("self"), member("A"), member("B", { deleted_at: "3" }));
    await started();
    h.group = GROUP;
    await mergeFrom("A");
    expect(h.retireDuplicates).toHaveBeenCalled();
    expect(calls("lan_sync_set_members").map(([, a]) => a)).toEqual([{ members: ms("self", "A", "B") }]);
  });

  test("a forget waits for a start that already read the group, so no later member list vouches the device", async () => {
    h.group = GROUP;
    await started();
    let release!: () => void;
    h.readGate = new Promise<void>((r) => { release = r; });
    h.group = withMembers(...GROUP.members, member("C"));
    await mergeFrom("A");
    h.readGate = Promise.resolve();
    h.forgetMember.mockImplementation(async () => {
      h.group = withMembers(member("self"), member("A"), member("B", { deleted_at: "3" }), member("C"));
    });

    const forgetting = forgetDevice("B");
    await vi.advanceTimersByTimeAsync(0);
    release();
    await forgetting;

    const order = h.invoke.mock.calls;
    const forgotAt = order.findIndex(([c]) => c === "lan_sync_forget");
    expect(forgotAt).toBeGreaterThan(-1);
    const listedAfter = order
      .slice(forgotAt)
      .filter(([c]) => c === "lan_sync_set_members" || c === "lan_sync_start")
      .flatMap(([, a]) => (a.members as { deviceId: string }[]).map((m) => m.deviceId));
    expect(listedAfter).not.toContain("B");
    expect(listedAfter).toContain("C");
  });

  test("forgetting a stale duplicate never blocks the key its live twin still holds", async () => {
    h.group = GROUP;
    await started();
    nearby("A", "B");
    h.heldKeys = ["B"];
    await forgetDevice("B");
    expect(h.forgetMember).toHaveBeenCalledWith("B");
    expect(calls("lan_sync_forget")).toHaveLength(0);
    expect(useLanSyncStore.getState().known.B).toBeUndefined();
  });

  test("a new scope drops the rows of the previous one", async () => {
    h.group = GROUP;
    nearby("A");
    useLanSyncStore.setState({ knownScope: "grp-1", peerClocks: { A: { c: "1" } } });
    await startLanSync();
    expect(useLanSyncStore.getState().known.A).toBeDefined();
    await stopLanSync();
    h.group = null;
    h.serverMode = true;
    await startLanSync();
    expect(useLanSyncStore.getState()).toMatchObject({ known: {}, peerClocks: {}, knownScope: "acct-1" });
  });

  test("a merge that leaves the group as it was changes nothing in rust", async () => {
    h.group = GROUP;
    await started();
    await mergeFrom("A");
    expect(calls("lan_sync_start")).toHaveLength(0);
    expect(calls("lan_sync_set_members")).toHaveLength(0);
  });

  test("tombstoned_member_is_forgotten_in_rust", async () => {
    h.group = GROUP;
    await started();
    nearby("A", "B");
    h.group = withMembers(member("self"), member("A"), member("B", { deleted_at: "3" }), GROUP.members[3]);
    await mergeFrom("A");
    expect(calls("lan_sync_forget").map(([, a]) => a)).toEqual([{ deviceId: "B", scope: "grp-1", group: true }]);
    expect(useLanSyncStore.getState().known.B).toBeUndefined();
    expect(useLanSyncStore.getState().known.A).toBeDefined();
    expect(calls("lan_sync_set_members").map(([, a]) => a)).toEqual([{ members: ms("self", "A") }]);
  });

  test("a rust forget that fails still lets the new keys in", async () => {
    h.group = GROUP;
    await started();
    h.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "lan_sync_forget") throw new Error("io");
      return cmd === "lan_sync_take_blob" ? bytes(h.blob) : undefined;
    });
    h.group = { ...withMembers(member("self"), member("A"), member("B", { deleted_at: "3" })), secrets: [{ epoch: 3, secret: [7] }] };
    await mergeFrom("A");
    expect(calls("lan_sync_start").map(([, a]) => a.authKeys)).toEqual([[[7]]]);
  });

  test("a device the group forgot stops lan sync", async () => {
    h.group = GROUP;
    await started();
    h.group = null;
    await mergeFrom("A");
    expect(calls("lan_sync_stop")).toHaveLength(1);
    expect(calls("lan_sync_forget")).toHaveLength(0);
    expect(h.handlers.size).toBe(0);
  });

  test("forgetting a group member rotates the group, forgets it in rust once and restarts", async () => {
    h.group = GROUP;
    await started();
    nearby("A", "B");
    h.forgetMember.mockImplementation(async () => {
      h.group = { ...withMembers(member("self"), member("A"), member("B", { deleted_at: "3" })), secrets: [{ epoch: 3, secret: [7] }] };
    });
    await forgetDevice("B");
    expect(h.forgetMember).toHaveBeenCalledWith("B");
    expect(calls("lan_sync_forget").map(([, a]) => a)).toEqual([{ deviceId: "B", scope: "grp-1", group: true }]);
    expect(calls("lan_sync_start").map(([, a]) => [a.authKeys, a.members])).toEqual([[[[7]], ms("self", "A")]]);
    expect(useLanSyncStore.getState().known.B).toBeUndefined();
  });

  test("forgetting while lan sync is stopped still reaches the group and rust", async () => {
    h.group = GROUP;
    await forgetDevice("B");
    expect(h.forgetMember).toHaveBeenCalledWith("B");
    expect(calls("lan_sync_forget").map(([, a]) => a)).toEqual([{ deviceId: "B", scope: "grp-1", group: true }]);
    expect(calls("lan_sync_start")).toHaveLength(0);
  });

  test("presence_and_rejected_reach_store", async () => {
    h.group = GROUP;
    await started();
    emit("presence", { deviceId: "A", state: "paused" });
    emit("rejected", { deviceId: "B", reason: "keyChanged" });
    expect(useLanSyncStore.getState().presence).toEqual({ A: "paused" });
    expect(useLanSyncStore.getState().rejected).toEqual({ B: "keyChanged" });
    emit("presence", { deviceId: "A", state: "moved" });
    emit("presence", { deviceId: "X", state: "moved" });
    await settle();
    expect(useLanSyncStore.getState().presence).toEqual({ A: "moved", X: "moved" });
    expect(h.markMoved.mock.calls).toEqual([["A"]]);
  });

  test("leaving for an account marks this device moved and pushes it at once", async () => {
    h.group = GROUP;
    await started();
    h.leaveGroup.mockImplementation(async () => { h.group = null; });
    await leaveLanGroup();
    expect(h.leaveGroup).toHaveBeenCalledWith("account", true);
    expect(broadcasts()).toBe(1);
  });

  test("leaving without a group does nothing", async () => {
    await leaveLanGroup();
    expect(h.leaveGroup).not.toHaveBeenCalled();
  });

  const leave = async () => {
    const leaving = leaveLanGroup("left");
    await vi.advanceTimersByTimeAsync(2000);
    await leaving;
  };
  const leaving = (farewell: typeof LEFT) =>
    h.leaveGroup.mockImplementation(async () => {
      h.group = null;
      h.holds = true;
      h.farewell = farewell;
    });

  test("leaving while linked pushes the leave, then stops, drops its secrets, clears the scope and owes no farewell", async () => {
    h.group = GROUP;
    await started();
    leaving({ ...LEFT, pending: [] });

    await leave();

    expect(h.leaveGroup).toHaveBeenCalledWith("left", true);
    const steps = ["lan_sync_broadcast", "lan_sync_stop", "lan_sync_clear_scope"];
    expect(h.invoke.mock.calls.map(([c]) => c).filter((c) => [...steps, "lan_sync_start"].includes(c))).toEqual(steps);
    const at = (cmd: string) => h.invoke.mock.invocationCallOrder[h.invoke.mock.calls.findIndex(([c]) => c === cmd)];
    expect(h.dropSecrets.mock.invocationCallOrder[0]).toBeGreaterThan(at("lan_sync_stop"));
    expect(h.dropSecrets.mock.invocationCallOrder[0]).toBeLessThan(at("lan_sync_clear_scope"));
    expect(calls("lan_sync_clear_scope").map(([, a]) => a)).toEqual([{ scope: "grp-1" }]);
    expect(useLanSyncStore.getState().known).toEqual({});
  });

  test.each([
    ["this device is paused", () => useLanSyncStore.setState({ paused: true })],
    ["every linked member is paused", () => useLanSyncStore.setState({ presence: { N: "paused" } })],
  ])("a leave that cannot push because %s still owes the farewell", async (_case, pause) => {
    h.group = GROUP;
    await started();
    pause();
    leaving(LEFT);

    await leave();

    expect(h.leaveGroup).toHaveBeenCalledWith("left", false);
  });

  test("leaving unlinked says farewell from a hidden manager, quietly, until every member heard it", async () => {
    h.group = GROUP;
    await startLanSync();
    h.invoke.mockClear();
    leaving(LEFT);

    await leave();

    expect(h.leaveGroup).toHaveBeenCalledWith("left", false);
    expect(calls("lan_sync_start").map(([, a]) => a)).toEqual([SAYS_FAREWELL]);
    emit("status", "running");
    expect(useLanSyncStore.getState().status).toBe("stopped");
    emit("farewell-sent", { deviceId: "A" });
    await settle();
    expect(calls("lan_sync_stop")).toHaveLength(1);
    emit("farewell-sent", { deviceId: "B" });
    await settle();
    expect(calls("lan_sync_stop")).toHaveLength(2);
    expect(h.handlers.size).toBe(0);
  });

  test("pairing replaces a farewell manager, which resumes once the window closes", async () => {
    h.farewell = LEFT;
    await startLanSync();
    expect(calls("lan_sync_start").map(([, a]) => a)).toEqual([SAYS_FAREWELL]);
    h.invoke.mockClear();

    await openPairing();
    const order = h.invoke.mock.calls.map(([c]) => c).filter((c) => c.startsWith("lan_sync_"));
    expect(order.slice(0, 2)).toEqual(["lan_sync_stop", "lan_sync_pair_open"]);
    await startLanSync();
    expect(calls("lan_sync_start")).toHaveLength(0);

    await closePairing();
    expect(calls("lan_sync_start").map(([, a]) => a)).toEqual([SAYS_FAREWELL]);
  });

  test("a leave whose drop failed finishes on the next try and on the next start", async () => {
    h.group = GROUP;
    await started();
    leaving({ ...LEFT, pending: [] });
    h.dropSecrets.mockRejectedValueOnce(new Error("io"));

    const attempt = leaveLanGroup("left").catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await attempt).toBe("io");
    expect(calls("lan_sync_clear_scope")).toHaveLength(0);
    expect(h.holds).toBe(true);

    await leaveLanGroup("left");
    expect(h.dropSecrets).toHaveBeenCalledTimes(2);
    expect(h.holds).toBe(false);
    expect(calls("lan_sync_clear_scope").map(([, a]) => a)).toEqual([{ scope: "grp-1" }]);

    await stopLanSync();
    h.invoke.mockClear();
    h.holds = true;
    await startLanSync();
    expect(h.dropSecrets).toHaveBeenCalledTimes(3);
    expect(h.holds).toBe(false);
    expect(calls("lan_sync_clear_scope").map(([, a]) => a)).toEqual([{ scope: "grp-1" }]);
  });

  test("a device that left says farewell when it starts again; one with nothing owed or that moved starts nothing", async () => {
    h.farewell = LEFT;
    await startLanSync();
    expect(calls("lan_sync_start").map(([, a]) => a)).toEqual([SAYS_FAREWELL]);
    for (const farewell of [{ ...LEFT, pending: [] }, { ...LEFT, reason: "account" as const }]) {
      await stopLanSync();
      h.invoke.mockClear();
      h.farewell = farewell;
      await startLanSync();
      expect(calls("lan_sync_start")).toHaveLength(0);
    }
  });

  test("a member that hears a device left retires it, forgets it in rust and shows nothing for it", async () => {
    h.group = GROUP;
    await started();
    nearby("A", "B");
    h.markLeft.mockImplementation(async () => {
      h.group = withMembers(member("self"), member("A", { deleted_at: "3" }), member("B"), GROUP.members[3]);
    });

    emit("presence", { deviceId: "A", state: "left" });
    emit("presence", { deviceId: "X", state: "left" });
    await settle();

    expect(h.markLeft.mock.calls).toEqual([["A"]]);
    expect(calls("lan_sync_forget").map(([, a]) => a)).toEqual([{ deviceId: "A", scope: "grp-1", group: true }]);
    expect(calls("lan_sync_set_members").map(([, a]) => a)).toEqual([{ members: ms("self", "B") }]);
    expect(useLanSyncStore.getState().known.A).toBeUndefined();
    expect(useLanSyncStore.getState().presence).toEqual({});
  });
});

describe("dial paths and file access by scope", () => {
  const addressesOf = (deviceId: string) => ({
    files: { "lan_sync_addresses.json": JSON.stringify({ v: 1, deviceId, addrs: ["100.101.1.2:47391"] }) },
    secrets: {},
  });
  const merged = async (deviceId: string) => {
    h.onMerged.forEach((fn) => fn(deviceId, addressesOf(deviceId)));
    await vi.advanceTimersByTimeAsync(0);
  };

  test("an account session serves files and learns peer addresses", async () => {
    await started();
    await merged("A");
    expect(h.startFiles).toHaveBeenCalledTimes(1);
    expect(calls("lan_sync_learn").map(([, a]) => a.deviceId)).toEqual(["A"]);
  });

  test.each([
    ["a group", () => { h.group = GROUP; }],
    ["a farewell-only", () => { h.farewell = LEFT; }],
  ])("%s session serves no files and learns no account addresses", async (_kind, enter) => {
    h.serverMode = false;
    enter();
    await merged("A");
    await startLanSync();
    await merged("B");
    expect(calls("lan_sync_start")).toHaveLength(1);
    expect(h.startFiles).not.toHaveBeenCalled();
    expect(h.stopFiles).toHaveBeenCalled();
    expect(calls("lan_sync_learn")).toHaveLength(0);
  });
});

describe("account scope", () => {
  test("a signed-in device that left a group offers its farewell key", async () => {
    h.farewell = { secret: "ff".repeat(32), reason: "account", group: "grp-1" };
    await startLanSync();
    expect(calls("lan_sync_start")[0][1]).toMatchObject({ scope: "acct-1", authKeys: [[1]], farewell: "ff".repeat(32) });
    expect(calls("lan_sync_start")[0][1].members).toBeUndefined();
    expect(calls("lan_sync_start")[0][1].farewellLeft).toBeUndefined();
  });

  test("a signed-in device that had left its group says it left, not moved", async () => {
    h.farewell = LEFT;
    await startLanSync();
    expect(calls("lan_sync_start")[0][1]).toMatchObject({ scope: "acct-1", farewell: "ff".repeat(32), farewellLeft: true });
    await stopLanSync();
    h.invoke.mockClear();
    h.farewell = { ...LEFT, pending: [] };
    await startLanSync();
    expect(calls("lan_sync_start")[0][1].farewell).toBeUndefined();
  });

  test("forgetting an account device only forgets it in rust", async () => {
    await started();
    nearby("A", "B");
    useLanSyncStore.getState().markRejected("B", "keyChanged");
    await forgetDevice("B");
    expect(h.forgetMember).not.toHaveBeenCalled();
    expect(calls("lan_sync_forget").map(([, a]) => a)).toEqual([{ deviceId: "B", scope: "acct-1", group: false }]);
    expect(calls("lan_sync_start")).toHaveLength(0);
    expect(useLanSyncStore.getState().known.B).toBeUndefined();
    expect(useLanSyncStore.getState().rejected).toEqual({});
  });
});

describe("pairing", () => {
  beforeEach(() => {
    h.serverMode = false;
  });

  test("pairing_flow_host_sends_grant", async () => {
    await openPairing();
    expect(calls("lan_sync_pair_open").map(([, a]) => a)).toEqual([{ deviceId: "self", deviceName: "host", info: INFO }]);
    expect(pairing()).toEqual({ state: "searching" });
    await pair({ ...CODE, role: "host" });
    expect(pairing()).toEqual({ state: "code", sas: 123456, role: "host", peerName: "Desk", peerHasData: false });
    expect(h.createGroup).not.toHaveBeenCalled();
    expect(h.grantFor).not.toHaveBeenCalled();
    await confirmPairing();
    expect(h.grantFor).toHaveBeenCalledWith(GROUP, "host");
    expect(calls("lan_sync_pair_confirm").map(([, a]) => a)).toEqual([{ grant: GRANT }]);
    expect(pairing().state).toBe("joining");
    await pair({ state: "peerConfirmed" });
    expect(pairing().state).toBe("joining");
    h.group = GROUP;
    await pair({ state: "done" });
    expect(pairing()).toMatchObject({ state: "done", peerName: "Desk" });
    expect(calls("lan_sync_start").map(([, a]) => a.scope)).toEqual(["grp-1"]);
  });

  test("pairing_flow_joiner_with_data_waits_for_choice", async () => {
    h.entities = 3;
    await openPairing();
    await pair({ ...CODE, role: "joiner" });
    expect(pairing()).toMatchObject({ state: "code", role: "joiner", peerHasData: true });
    await pair({ state: "peerConfirmed" });
    expect(pairing().state).toBe("peerConfirmed");
    expect(calls("lan_sync_pair_confirm")).toHaveLength(0);
    await confirmPairing("replace");
    expect(calls("lan_sync_pair_confirm").map(([, a]) => a)).toEqual([{}]);
    expect(h.createGroup).not.toHaveBeenCalled();
    await pair({ state: "granted", grant: GRANT });
    expect(h.joinGroup).toHaveBeenCalledWith(GRANT, "replace");
    expect(pairing().state).toBe("done");
    expect(calls("lan_sync_start").map(([, a]) => a.scope)).toEqual(["grp-1"]);
  });

  test("the intro comes before the pairing window, and the first sync after pairing does not wait on it", async () => {
    const real = await vi.importActual<typeof import("./lanSyncIntro")>("./lanSyncIntro");
    h.intro.mockImplementation(real.ensureLanSyncIntro);
    h.invoke.mockImplementation(async (cmd: string) => (cmd === "get_platform" ? "macos" : cmd === "device_hostname" ? "host" : undefined));
    useLanSyncStore.setState({ introShown: false });
    try {
      const opening = openPairing();
      await vi.advanceTimersByTimeAsync(0);
      expect(real.useLanSyncIntroStore.getState().open).toBe(true);
      expect(calls("lan_sync_pair_open")).toHaveLength(0);
      real.confirmLanSyncIntro();
      await opening;
      expect(calls("lan_sync_pair_open")).toHaveLength(1);

      await pair({ ...CODE, role: "joiner" });
      await confirmPairing();
      await pair({ state: "granted", grant: GRANT });

      expect(real.useLanSyncIntroStore.getState().open).toBe(false);
      expect(calls("lan_sync_start").map(([, a]) => a.scope)).toEqual(["grp-1"]);
    } finally {
      h.intro.mockImplementation(async () => {});
    }
  });

  test("an intro that fails ends the pairing as failed", async () => {
    h.intro.mockRejectedValueOnce(new Error("no platform"));
    await openPairing();
    expect(pairing()).toEqual({ state: "ended", reason: "failed", closed: true });
    expect(calls("lan_sync_pair_open")).toHaveLength(0);
  });

  test("re-verifying within the same group never offers to replace this device's data", async () => {
    h.entities = 3;
    await openPairing();
    await pair({ ...CODE, role: "joiner", reverify: true });
    expect(pairing()).toMatchObject({ state: "code", peerHasData: false });
    await confirmPairing("replace");
    await pair({ state: "granted", grant: GRANT });
    expect(h.joinGroup).toHaveBeenCalledWith(GRANT, "combine");
  });

  test.each(["host", "joiner"])("the %s's code names the member a new key for that device would replace", async (role) => {
    h.replaces = { P: "Old laptop" };
    await openPairing();
    await pair({ ...CODE, role });
    expect(pairing().replaces).toBeUndefined();
    await pair({ ...CODE, role, peerKey: "k-new" });
    expect(pairing()).toMatchObject({ state: "code", peerName: "Desk", replaces: "Old laptop" });
  });

  test("a joiner with data combines by default", async () => {
    h.entities = 3;
    await openPairing();
    await pair({ ...CODE, role: "joiner" });
    await confirmPairing();
    await pair({ state: "granted", grant: GRANT });
    expect(h.joinGroup).toHaveBeenCalledWith(GRANT, "combine");
  });

  test("empty_joiner_joins_silently", async () => {
    await openPairing();
    await pair({ ...CODE, role: "joiner" });
    expect(pairing()).toMatchObject({ state: "code", peerHasData: false });
    await confirmPairing("replace");
    await pair({ state: "granted", grant: GRANT });
    expect(h.joinGroup).toHaveBeenCalledWith(GRANT, "combine");
  });

  test("a session that ends keeps the window open; only closed ends it", async () => {
    await openPairing();
    for (const reason of ["accountDevice", "bothGrouped", "alreadyPaired", "busy", "cancelled", "timedOut"]) {
      await pair({ state: "ended", reason });
      expect(pairing()).toEqual({ state: "ended", reason });
    }
    expect(calls("lan_sync_pair_close")).toHaveLength(0);
    await pair({ ...CODE, role: "host" });
    expect(pairing().state).toBe("code");
    await pair({ state: "closed", reason: "tooManyAttempts" });
    expect(pairing()).toEqual({ state: "ended", reason: "tooManyAttempts", closed: true });
  });

  test("a new code after an ended session can be confirmed again", async () => {
    await openPairing();
    await pair({ ...CODE, role: "host" });
    await confirmPairing();
    await pair({ state: "ended", reason: "cancelled" });
    await pair({ ...CODE, sas: 654321, role: "host" });
    await confirmPairing();
    expect(calls("lan_sync_pair_confirm")).toHaveLength(2);
  });

  test("confirm outside a code does nothing", async () => {
    await confirmPairing();
    await openPairing();
    await confirmPairing();
    expect(calls("lan_sync_pair_confirm")).toHaveLength(0);
  });

  test("cancel ends the session", async () => {
    await openPairing();
    await pair({ ...CODE, role: "host" });
    await cancelPairing();
    expect(calls("lan_sync_pair_cancel")).toHaveLength(1);
    expect(pairing()).toEqual({ state: "ended", reason: "cancelled" });
  });

  test("a failed host confirm cancels the session instead of hanging", async () => {
    h.createGroup.mockRejectedValueOnce(new Error("vault locked"));
    await openPairing();
    await pair({ ...CODE, role: "host" });
    await confirmPairing();
    expect(calls("lan_sync_pair_confirm")).toHaveLength(0);
    expect(calls("lan_sync_pair_cancel")).toHaveLength(1);
    expect(pairing()).toEqual({ state: "ended", reason: "failed" });
  });

  test("a failed join ends pairing and starts nothing", async () => {
    h.joinGroup.mockRejectedValueOnce(new Error("rekey failed"));
    await openPairing();
    await pair({ ...CODE, role: "joiner" });
    await confirmPairing();
    await pair({ state: "granted", grant: GRANT });
    expect(pairing()).toEqual({ state: "ended", reason: "failed", closed: true });
    expect(calls("lan_sync_start")).toHaveLength(0);
  });

  test("closing the sheet always closes the window and drops later events", async () => {
    await closePairing();
    expect(calls("lan_sync_pair_close")).toHaveLength(1);
    h.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "lan_sync_pair_open") throw new Error("bind failed");
      return undefined;
    });
    await openPairing();
    expect(pairing()).toEqual({ state: "ended", reason: "failed", closed: true });
    await closePairing();
    expect(calls("lan_sync_pair_close")).toHaveLength(2);
    expect(pairing()).toEqual({ state: "idle" });
    expect(h.handlers.size).toBe(0);
  });

  test("a join still finishes and starts lan sync after the sheet closed", async () => {
    let finish!: () => void;
    h.joinGroup.mockImplementationOnce(() => new Promise<void>((r) => { finish = () => { h.group = GROUP; r(); }; }));
    await openPairing();
    await pair({ ...CODE, role: "joiner" });
    await confirmPairing();
    await pair({ state: "granted", grant: GRANT });
    await closePairing();
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(pairing()).toEqual({ state: "idle" });
    expect(calls("lan_sync_start").map(([, a]) => a.scope)).toEqual(["grp-1"]);
  });

  test("reopening replaces the previous listener", async () => {
    await openPairing();
    await openPairing();
    expect(h.handlers.size).toBe(1);
    expect(calls("lan_sync_pair_open")).toHaveLength(2);
  });

  test("closing while the window is still opening never opens it and leaves no listener", async () => {
    let answer!: (info: typeof INFO) => void;
    h.pairInfo.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    const opening = openPairing();
    await vi.advanceTimersByTimeAsync(0);
    const closing = closePairing();
    answer(INFO);
    await Promise.all([opening, closing]);
    expect(calls("lan_sync_pair_open")).toHaveLength(0);
    expect(calls("lan_sync_pair_close")).toHaveLength(1);
    expect(h.handlers.size).toBe(0);
    expect(pairing()).toEqual({ state: "idle" });
  });

  test("a close sent while the window opens reaches rust after the open", async () => {
    let opened!: () => void;
    h.invoke.mockImplementation((cmd: string) =>
      cmd === "lan_sync_pair_open" ? new Promise<void>((r) => { opened = r; }) : Promise.resolve(undefined),
    );
    const opening = openPairing();
    await vi.advanceTimersByTimeAsync(0);
    const closing = closePairing();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls("lan_sync_pair_close")).toHaveLength(0);
    opened();
    await Promise.all([opening, closing]);
    expect(h.invoke.mock.calls.map(([c]) => c).filter((c) => c.startsWith("lan_sync_pair"))).toEqual([
      "lan_sync_pair_open",
      "lan_sync_pair_close",
    ]);
    expect(h.handlers.size).toBe(0);
  });

  test("android backgrounding keeps an open pairing window, and closing it in the background halts", async () => {
    h.platform = "android";
    await startLanSync();
    await openPairing();
    await pair({ ...CODE, role: "joiner" });
    await toBackground("hidden");
    expect(calls("lan_sync_stop")).toHaveLength(0);
    expect(pairing().state).toBe("code");
    await closePairing();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls("lan_sync_stop")).toHaveLength(1);
  });

  test("a manager restart during pairing ends the sheet as closed", async () => {
    h.group = GROUP;
    await started();
    await openPairing();
    await pair({ ...CODE, role: "host" });
    h.group = { ...GROUP, secrets: [{ epoch: 3, secret: [7] }, ...GROUP.secrets] };
    await mergeFrom("A");
    expect(calls("lan_sync_start")).toHaveLength(1);
    expect(pairing()).toEqual({ state: "ended", reason: "stopped", closed: true });
  });

  test("stopping lan sync during pairing ends the sheet as closed", async () => {
    h.group = GROUP;
    await started();
    await openPairing();
    await stopLanSync();
    expect(pairing()).toEqual({ state: "ended", reason: "stopped", closed: true });
  });

  test("starting lan sync after pairing finished keeps the done state", async () => {
    await openPairing();
    await pair({ ...CODE, role: "joiner" });
    await confirmPairing();
    await pair({ state: "granted", grant: GRANT });
    expect(calls("lan_sync_start")).toHaveLength(1);
    expect(pairing()).toMatchObject({ state: "done", peerName: "Desk" });
  });
});
