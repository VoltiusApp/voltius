import { afterEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(async (_cmd: string, _args: { deviceId: string; addrs: string[] }) => {}),
  listener: null as null | ((deviceId: string, payload: unknown) => void),
  forgetMergedRemoteBlobs: vi.fn(),
}));

vi.mock("@/lib/invoke", () => ({ invoke: h.invoke }));
vi.mock("@/services/settledBlobs", () => ({ forgetMergedRemoteBlobs: h.forgetMergedRemoteBlobs }));
vi.mock("@/services/sync", () => ({
  getDeviceId: async () => "dev-me",
  onRemotePayloadMerged: (fn: (deviceId: string, payload: unknown) => void) => {
    h.listener = fn;
    return () => {};
  },
}));

import { addressesFrom, forgetPeerAddresses, ignorePeerAddresses, watchPeerAddresses } from "./lanSyncAddresses";

const FILE = "lan_sync_addresses.json";
const payload = (content?: string) => ({ files: content === undefined ? {} : ({ [FILE]: content } as Record<string, string>), secrets: {} });
const file = (over: object = {}) => JSON.stringify({ v: 1, deviceId: "dev-b", addrs: ["100.101.1.2:47391"], ...over });

const merged = (deviceId: string, content?: string) => h.listener?.(deviceId, payload(content));
const flush = () => new Promise((r) => setTimeout(r));
const learned = (deviceId: string) =>
  h.invoke.mock.calls.filter(([, args]) => args.deviceId === deviceId).map(([, args]) => args.addrs);

afterEach(() => {
  h.invoke.mockClear();
});

describe("addressesFrom", () => {
  test("reads_the_publishers_own_file", () => {
    expect(addressesFrom("dev-b", "dev-me", payload(file()))).toEqual(["100.101.1.2:47391"]);
  });

  test("ignores_foreign_and_own_address_files", () => {
    expect(addressesFrom("dev-c", "dev-me", payload(file()))).toEqual([]);
    expect(addressesFrom("dev-me", "dev-me", payload(file({ deviceId: "dev-me" })))).toEqual([]);
    expect(addressesFrom("dev-b", "dev-me", payload(file({ v: 2 })))).toEqual([]);
    expect(addressesFrom("dev-b", "dev-me", payload("not json"))).toEqual([]);
    expect(addressesFrom("dev-b", "dev-me", payload(file({ addrs: [1, {}] })))).toEqual([]);
    expect(addressesFrom("dev-b", "dev-me", payload(file({ addrs: "x" })))).toEqual([]);
    expect(addressesFrom("dev-b", "dev-me", payload())).toEqual([]);
    const many = Array.from({ length: 40 }, (_, i) => `10.0.0.${i}:47391`);
    expect(addressesFrom("dev-b", "dev-me", payload(file({ addrs: many })))).toEqual(many.slice(0, 16));
  });
});

describe("watchPeerAddresses", () => {
  test("merge_before_watch_is_learned_when_watching_starts", async () => {
    merged("dev-b", file());
    await flush();
    expect(h.invoke).not.toHaveBeenCalled();
    const off = watchPeerAddresses();
    await vi.waitFor(() =>
      expect(h.invoke).toHaveBeenCalledWith("lan_sync_learn", { deviceId: "dev-b", addrs: ["100.101.1.2:47391"] }),
    );
    off();
  });

  test("watch_learns_live_merges_until_off", async () => {
    const off = watchPeerAddresses();
    merged("dev-c", file({ deviceId: "dev-c", addrs: ["100.101.1.3:47391"] }));
    await vi.waitFor(() => expect(learned("dev-c")).toEqual([["100.101.1.3:47391"]]));
    merged("dev-x", file());
    off();
    merged("dev-d", file({ deviceId: "dev-d" }));
    await flush();
    expect(learned("dev-d")).toEqual([]);
    expect(learned("dev-x")).toEqual([]);
  });

  test("replay_sends_only_the_latest_addresses_per_device", async () => {
    merged("dev-e", file({ deviceId: "dev-e", addrs: ["10.0.0.1:1"] }));
    merged("dev-e", file({ deviceId: "dev-e", addrs: ["10.0.0.2:1"] }));
    merged("dev-f", file({ deviceId: "dev-f", addrs: ["10.0.0.3:1"] }));
    merged("dev-f");
    await flush();
    const off = watchPeerAddresses();
    await flush();
    expect(learned("dev-e")).toEqual([["10.0.0.2:1"]]);
    expect(learned("dev-f")).toEqual([]);
    off();
  });

  test("a_merge_during_a_group_session_stays_ignored_when_it_ends_before_the_merge_settles", async () => {
    const release = ignorePeerAddresses();
    merged("dev-g", file({ deviceId: "dev-g" }));
    release();
    await flush();
    const off = watchPeerAddresses();
    await flush();
    expect(learned("dev-g")).toEqual([]);
    off();
  });

  test("forgetting_drops_settled_and_in_flight_addresses", async () => {
    merged("dev-h", file({ deviceId: "dev-h" }));
    await flush();
    merged("dev-i", file({ deviceId: "dev-i" }));
    forgetPeerAddresses();
    await flush();
    const off = watchPeerAddresses();
    await flush();
    expect(learned("dev-h")).toEqual([]);
    expect(learned("dev-i")).toEqual([]);
    off();
  });
});

test("forgetting peer addresses makes the next cloud sync announce every remote blob again", () => {
  h.forgetMergedRemoteBlobs.mockClear();
  forgetPeerAddresses();
  expect(h.forgetMergedRemoteBlobs).toHaveBeenCalledOnce();
});
