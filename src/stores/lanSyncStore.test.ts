// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const merged = vi.hoisted(() => ({ listener: (_id: string, _p: unknown) => {} }));
vi.mock("@/services/sync", () => ({
  ENTITY_FILES: ["connections.json"],
  parseEntities: (json?: string) => JSON.parse(json ?? "[]"),
  getDeviceId: async () => "self",
  onRemotePayloadMerged: (fn: (id: string, p: unknown) => void) => { merged.listener = fn; return () => {}; },
}));

import { useLanSyncStore } from "./lanSyncStore";

const peer = { deviceId: "d1", deviceName: "One", platform: "linux", route: "lan" as const, address: "a" };
const payload = { files: { "connections.json": JSON.stringify([{ id: "c", updated_at: "1" }]) }, secrets: {} };

describe("lanSyncStore", () => {
  beforeEach(() => useLanSyncStore.setState({ known: {}, peerClocks: {}, peers: [], syncing: new Set() }));

  it("rememberDevice is true only for a new id and refreshes details", () => {
    const { rememberDevice } = useLanSyncStore.getState();
    expect(rememberDevice(peer)).toBe(true);
    expect(rememberDevice({ ...peer, deviceName: "Renamed" })).toBe(false);
    expect(useLanSyncStore.getState().known.d1.name).toBe("Renamed");
  });

  it("records merged payload clocks but ignores this device", async () => {
    merged.listener("d1", payload);
    merged.listener("self", payload);
    await vi.waitFor(() => expect(useLanSyncStore.getState().peerClocks.d1).toEqual({ "connections.json:c": "1" }));
    expect(useLanSyncStore.getState().peerClocks.self).toBeUndefined();
  });

  it("persists only paused, known, peerClocks and introShown", () => {
    useLanSyncStore.setState({ status: "running", syncing: new Set(["d1"]), localClocks: { k: "1" }, peers: [peer] });
    const persisted = JSON.parse(localStorage.getItem("voltius-lan-sync") ?? "{}").state;
    expect(Object.keys(persisted).sort()).toEqual(["introShown", "known", "paused", "peerClocks"]);
  });

  it("drops syncing marks for peers that left", () => {
    const { setPeers, markSyncing } = useLanSyncStore.getState();
    setPeers([peer, { ...peer, deviceId: "d2" }]);
    markSyncing("d1", true);
    markSyncing("d2", true);
    setPeers([peer]);
    expect([...useLanSyncStore.getState().syncing]).toEqual(["d1"]);
  });

  it("keeps clocks of known devices and caps the rest, oldest first", () => {
    const { rememberDevice, recordPeerPayload } = useLanSyncStore.getState();
    rememberDevice(peer);
    recordPeerPayload("d1", payload);
    for (let i = 0; i < 20; i++) recordPeerPayload(`cloud${i}`, payload);
    const ids = Object.keys(useLanSyncStore.getState().peerClocks);
    expect(ids).toContain("d1");
    expect(ids.filter((id) => id.startsWith("cloud"))).toEqual(Array.from({ length: 16 }, (_, i) => `cloud${i + 4}`));
    recordPeerPayload("cloud4", payload);
    expect(Object.keys(useLanSyncStore.getState().peerClocks).pop()).toBe("cloud4");
    recordPeerPayload("d1", payload);
    expect(Object.keys(useLanSyncStore.getState().peerClocks).filter((id) => id.startsWith("cloud"))).toHaveLength(16);
  });
});
