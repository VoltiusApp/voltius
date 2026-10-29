// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const listeners = vi.hoisted(() => [] as Array<(id: string, p: unknown) => void>);
vi.mock("@/services/sync", () => ({
  ENTITY_FILES: ["connections.json"],
  getDeviceId: async () => "self",
  onRemotePayloadMerged: (fn: (id: string, p: unknown) => void) => { listeners.push(fn); return () => {}; },
}));

import { useLanSyncStore } from "./lanSyncStore";

const peer = { deviceId: "d1", deviceName: "One", platform: "linux", route: "lan" as const, address: "a" };
const payload = { files: { "connections.json": JSON.stringify([{ id: "c", updated_at: "1" }]) }, secrets: {} };

describe("lanSyncStore", () => {
  beforeEach(() => useLanSyncStore.setState({ known: {}, peerClocks: {} }));

  it("rememberDevice is true only for a new id and refreshes details", () => {
    const { rememberDevice } = useLanSyncStore.getState();
    expect(rememberDevice(peer)).toBe(true);
    expect(rememberDevice({ ...peer, deviceName: "Renamed" })).toBe(false);
    expect(useLanSyncStore.getState().known.d1.name).toBe("Renamed");
  });

  it("records merged payload clocks but ignores this device", async () => {
    listeners[0]("d1", payload);
    listeners[0]("self", payload);
    await vi.waitFor(() => expect(useLanSyncStore.getState().peerClocks.d1).toEqual({ "connections.json:c": "1" }));
    expect(useLanSyncStore.getState().peerClocks.self).toBeUndefined();
  });
});
