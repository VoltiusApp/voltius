// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildDeviceRows, countBehind, entityClocks, type KnownDevice, type PeerInfo } from "./lanSyncDevices";

const peer = (deviceId: string, deviceName: string): PeerInfo => ({ deviceId, deviceName, platform: "linux", route: "lan", address: "10.0.0.2:1" });
const known = (name: string, lastSeen: string): KnownDevice => ({ name, platform: "mac", lastSeen, lastRoute: "lan" });
const base = { selfId: "self", peers: [], known: {}, cloudDevices: [], localClocks: {}, syncing: new Set<string>() };

describe("entityClocks / countBehind", () => {
  it("keys entities, tombstones and secrets", () => {
    const clocks = entityClocks({
      files: {
        "connections.json": JSON.stringify([{ id: "a", updated_at: "2" }, { id: "t", updated_at: "3", deleted_at: "3" }]),
        "snippets.json": "not json",
      },
      secrets: {},
      secret_clocks: { s: "5" },
    });
    expect(clocks).toEqual({ "connections.json:a": "2", "connections.json:t": "3", "secret:s": "5" });
  });

  it("counts missing and older keys", () => {
    expect(countBehind({ a: "2", b: "1" }, { a: "1" })).toBe(2);
    expect(countBehind({ a: "2" }, { a: "2", z: "9" })).toBe(0);
  });
});

describe("buildDeviceRows", () => {
  it("dot states", () => {
    const rows = buildDeviceRows({
      ...base,
      peers: [peer("p1", "A"), peer("p2", "B")],
      known: { off1: known("Off1", "2"), off2: known("Off2", "1") },
      localClocks: { k: "2" },
      peerClocks: { off1: { k: "1" }, off2: { k: "2" } },
      syncing: new Set(["p2"]),
    });
    const dot = Object.fromEntries(rows.map((r) => [r.deviceId, r.dot]));
    expect(dot).toEqual({ p1: "live", p2: "syncing", off1: "behind", off2: "offline-ok" });
    expect(rows.find((r) => r.deviceId === "off1")?.behind).toBe(1);
  });

  it("treats unknown peer clocks as zero behind", () => {
    const [row] = buildDeviceRows({ ...base, known: { x: known("X", "1") }, localClocks: { k: "2" } });
    expect(row.behind).toBe(0);
    expect(row.dot).toBe("offline-ok");
  });

  it("falls back through names", () => {
    const rows = buildDeviceRows({
      ...base,
      peers: [peer("peer1", "Peer")],
      known: { peer1: known("Old", "1"), kn: known("Known", "5") },
      cloudDevices: [
        { device_id: "kn", metadata: { device_name: "Cloud" }, updated_at: "9" },
        { device_id: "cl", metadata: { device_name: "CloudOnly" }, updated_at: "3" },
        { device_id: "abcdef123", metadata: {}, updated_at: "2" },
      ],
    });
    expect(rows.map((r) => r.name)).toEqual(["Peer", "Known", "CloudOnly", "Device abcdef"]);
    expect(rows.find((r) => r.deviceId === "cl")?.lastSeen).toBe("3");
    expect(rows.find((r) => r.deviceId === "kn")?.lastSeen).toBe("5");
  });

  it("sorts nearby by name then id, offline by lastSeen desc then id, excludes self", () => {
    const rows = buildDeviceRows({
      ...base,
      peers: [peer("z", "B"), peer("y", "B"), peer("x", "A"), peer("self", "Me")],
      known: { o1: known("O", "1"), o2: known("O", "2"), o3: known("O", "2") },
    });
    expect(rows.map((r) => r.deviceId)).toEqual(["x", "y", "z", "o2", "o3", "o1"]);
  });
});
