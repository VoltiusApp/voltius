// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { buildMyDevices } from "./myDevices";
import type { KnownDevice, PeerInfo } from "./lanSyncDevices";

const peer = (deviceId: string, o: Partial<PeerInfo> = {}): PeerInfo => ({
  deviceId,
  deviceName: deviceId,
  platform: "linux",
  route: "lan",
  address: "10.0.0.2:1",
  deviceKey: `key-${deviceId}`,
  files: true,
  ...o,
});
const known = (name: string, lastSeen: string, o: Partial<KnownDevice> = {}): KnownDevice => ({
  name,
  platform: "windows",
  lastSeen,
  lastRoute: "lan",
  ...o,
});
const build = (peers: PeerInfo[], k: Record<string, KnownDevice> = {}) =>
  buildMyDevices({ selfId: "self", peers, known: k });

describe("buildMyDevices", () => {
  test("peer with files is ready", () => {
    expect(build([peer("a")])).toEqual([
      { deviceId: "a", deviceKey: "key-a", name: "a", platform: "linux", state: "ready", route: "lan", lastSeen: null },
    ]);
  });

  test("peer without files is off", () => {
    expect(build([peer("a", { files: false })])[0].state).toBe("off");
  });

  test("known device not in peers is offline", () => {
    expect(build([], { a: known("A", "2026-01-01T00:00:00Z", { deviceKey: "k" }) })).toEqual([
      { deviceId: "a", deviceKey: "k", name: "A", platform: "windows", state: "offline", route: null, lastSeen: "2026-01-01T00:00:00Z" },
    ]);
    expect(build([], { a: known("A", "2026-01-01T00:00:00Z") })[0].deviceKey).toBeNull();
  });

  test("android_devices_hidden_everywhere", () => {
    const rows = build([peer("p", { platform: "android" })], { k: known("K", "2026-01-01T00:00:00Z", { platform: "android" }) });
    expect(rows).toEqual([]);
  });

  test("self_excluded", () => {
    expect(build([peer("self")], { self: known("Me", "2026-01-01T00:00:00Z") })).toEqual([]);
  });

  test("ordering", () => {
    const rows = build(
      [peer("z", { deviceName: "Zed" }), peer("o", { deviceName: "Off", files: false }), peer("a", { deviceName: "Alpha" })],
      { old: known("Old", "2026-01-01T00:00:00Z"), recent: known("Recent", "2026-02-01T00:00:00Z") },
    );
    expect(rows.map((r) => r.name)).toEqual(["Alpha", "Zed", "Off", "Recent", "Old"]);
  });

  test("no_devices_gives_empty_list", () => {
    expect(build([])).toEqual([]);
  });
});
