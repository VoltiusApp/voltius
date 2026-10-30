// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const merged = vi.hoisted(() => ({ listener: (_id: string, _p: unknown) => {} }));
vi.mock("@/services/sync", () => ({
  ENTITY_FILES: ["connections.json"],
  parseEntities: (json?: string) => JSON.parse(json ?? "[]"),
  getDeviceId: async () => "self",
  onRemotePayloadMerged: (fn: (id: string, p: unknown) => void) => { merged.listener = fn; return () => {}; },
}));

import { LAN_SYNC_CLOCKS_KEY, LAN_SYNC_DEVICES_KEY, useLanSyncStore } from "./lanSyncStore";
import { buildDeviceRows } from "@/services/lanSyncDevices";
import {
  ACCOUNT_SCOPED_RESET_KEYS,
  ACCOUNT_SCOPED_STORAGE_KEYS,
  DEVICE_SCOPED_STORAGE_KEYS,
  clearPersistedAccountUiState,
  parkAccountUiState,
  restoreAccountUiState,
} from "./persistedAccountUiState";

const peer = { deviceId: "d1", deviceName: "One", platform: "linux", route: "lan" as const, address: "a", deviceKey: "key", files: false };
const payload = { files: { "connections.json": JSON.stringify([{ id: "c", updated_at: "1" }]) }, secrets: {} };

describe("lanSyncStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useLanSyncStore.setState({
      known: {}, knownScope: undefined, peerClocks: {}, peers: [], syncing: new Set(), paused: false, introShown: false, presence: {}, rejected: {},
    });
  });

  it("a device that connects again is no longer shown as unverifiable", () => {
    const { markRejected, setPeers } = useLanSyncStore.getState();
    markRejected("d1", "keyChanged");
    markRejected("d2", "keyChanged");

    setPeers([peer]);

    expect(useLanSyncStore.getState().rejected).toEqual({ d2: "keyChanged" });
  });

  it("adoptScope keeps rows of the same scope, drops another scope's, and adopts unscoped rows", async () => {
    const { rememberDevice, recordPeerPayload, adoptScope } = useLanSyncStore.getState();
    rememberDevice(peer);
    adoptScope("grp-1");
    expect(useLanSyncStore.getState().known.d1).toBeDefined();
    recordPeerPayload("d1", { files: {}, secrets: {}, secret_clocks: {} });
    adoptScope("grp-1");
    expect(useLanSyncStore.getState().known.d1).toBeDefined();
    adoptScope("acct-1");
    expect(useLanSyncStore.getState()).toMatchObject({ known: {}, peerClocks: {}, knownScope: "acct-1" });
    await useLanSyncStore.persist.rehydrate();
    expect(useLanSyncStore.getState().knownScope).toBe("acct-1");
  });

  it("rememberDevice is true only for a new id and refreshes details", () => {
    const { rememberDevice } = useLanSyncStore.getState();
    expect(rememberDevice(peer)).toBe(true);
    expect(rememberDevice({ ...peer, deviceName: "Renamed" })).toBe(false);
    expect(useLanSyncStore.getState().known.d1.name).toBe("Renamed");
  });

  it("records merged payload clocks but ignores this device", async () => {
    useLanSyncStore.getState().rememberDevice(peer);
    merged.listener("d1", payload);
    merged.listener("self", payload);
    await vi.waitFor(() => expect(useLanSyncStore.getState().peerClocks.d1).toEqual({ "connections.json:c": "1" }));
    expect(useLanSyncStore.getState().peerClocks.self).toBeUndefined();
  });

  it("persists device settings, known devices and peer clocks under separate keys", () => {
    const { rememberDevice, recordPeerPayload } = useLanSyncStore.getState();
    rememberDevice(peer);
    recordPeerPayload("d1", payload);
    useLanSyncStore.setState({ paused: true, status: "running", syncing: new Set(["d1"]), localClocks: { k: "1" }, peers: [peer] });
    const stored = (key: string) => JSON.parse(localStorage.getItem(key) ?? "{}").state;
    expect(stored("voltius-lan-sync")).toEqual({ paused: true, introShown: false });
    expect(Object.keys(stored(LAN_SYNC_DEVICES_KEY))).toEqual(["known"]);
    expect(Object.keys(stored(LAN_SYNC_CLOCKS_KEY))).toEqual(["peerClocks"]);
  });

  it("classifies its keys: settings follow the device, devices are parked, clocks are reset", () => {
    expect(DEVICE_SCOPED_STORAGE_KEYS).toContain("voltius-lan-sync");
    expect(ACCOUNT_SCOPED_STORAGE_KEYS).toContain(LAN_SYNC_DEVICES_KEY);
    expect(ACCOUNT_SCOPED_RESET_KEYS).toContain(LAN_SYNC_CLOCKS_KEY);
  });

  it("an account switch shows the next account none of the previous one's devices", async () => {
    const { rememberDevice, recordPeerPayload, setPeers } = useLanSyncStore.getState();
    rememberDevice(peer);
    recordPeerPayload("d1", payload);
    setPeers([peer]);
    const rows = () => {
      const { peers, known, peerClocks, localClocks, syncing } = useLanSyncStore.getState();
      return buildDeviceRows({ selfId: "self", peers, known, peerClocks, localClocks, syncing });
    };

    parkAccountUiState("acct-a");
    useLanSyncStore.getState().forgetAccount();
    clearPersistedAccountUiState();
    restoreAccountUiState("acct-b");
    useLanSyncStore.getState().setPeers([]);
    useLanSyncStore.getState().setStatus("running");
    await useLanSyncStore.persist.rehydrate();
    expect(rows()).toEqual([]);

    parkAccountUiState("acct-b");
    useLanSyncStore.getState().forgetAccount();
    clearPersistedAccountUiState();
    restoreAccountUiState("acct-a");
    await useLanSyncStore.persist.rehydrate();
    expect(rows().map((r) => r.deviceId)).toEqual(["d1"]);
    expect(useLanSyncStore.getState().peerClocks).toEqual({});
  });

  it("drops syncing marks for peers that left", () => {
    const { setPeers, markSyncing } = useLanSyncStore.getState();
    setPeers([peer, { ...peer, deviceId: "d2" }]);
    markSyncing("d1", true);
    markSyncing("d2", true);
    setPeers([peer]);
    expect([...useLanSyncStore.getState().syncing]).toEqual(["d1"]);
  });

  it("stamps lastSeen when a known peer leaves, not when it arrived", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-29T10:00:00Z"));
      const { rememberDevice, setPeers } = useLanSyncStore.getState();
      rememberDevice(peer);
      setPeers([peer]);
      vi.setSystemTime(new Date("2026-10-29T10:05:00Z"));
      setPeers([]);
      expect(useLanSyncStore.getState().known.d1.lastSeen).toBe("2026-10-29T10:05:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("records clocks only for known devices", () => {
    const { rememberDevice, recordPeerPayload } = useLanSyncStore.getState();
    recordPeerPayload("cloud-only", payload);
    expect(useLanSyncStore.getState().peerClocks).toEqual({});
    rememberDevice(peer);
    recordPeerPayload("d1", payload);
    expect(Object.keys(useLanSyncStore.getState().peerClocks)).toEqual(["d1"]);
  });

  it("dropDevice removes one device everywhere and keeps the others", () => {
    const { rememberDevice, recordPeerPayload, setPresence, markRejected, dropDevice } = useLanSyncStore.getState();
    for (const deviceId of ["d1", "d2"]) {
      rememberDevice({ ...peer, deviceId });
      recordPeerPayload(deviceId, payload);
      setPresence(deviceId, "paused");
      markRejected(deviceId, "keyChanged");
    }
    dropDevice("d1");
    const { known, peerClocks, presence, rejected } = useLanSyncStore.getState();
    expect([known, peerClocks, presence, rejected].map(Object.keys)).toEqual([["d2"], ["d2"], ["d2"], ["d2"]]);
  });

  it("presence, rejections and pairing stay in memory and leave with the account", () => {
    const { setPresence, markRejected, setPairing, forgetAccount } = useLanSyncStore.getState();
    setPresence("d1", "moved");
    markRejected("d2", "keyChanged");
    setPairing({ state: "code", sas: 1, role: "host" });
    const persisted = [localStorage.getItem("voltius-lan-sync"), localStorage.getItem(LAN_SYNC_DEVICES_KEY)].join();
    expect(persisted).not.toMatch(/moved|keyChanged|pairing/);
    forgetAccount();
    expect(useLanSyncStore.getState().presence).toEqual({});
    expect(useLanSyncStore.getState().rejected).toEqual({});
  });
});
