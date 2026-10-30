import { describe, test, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@/services/sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/sync")>()),
  getDeviceId: async () => "self",
}));

import { useLanDeviceRows } from "./useLanDeviceRows";
import { useLanSyncStore } from "@/stores/lanSyncStore";

const peer = (deviceId: string) => ({ deviceId, deviceName: deviceId, platform: "linux", route: "lan" as const, address: "10.0.0.2", deviceKey: "key", files: false });
const known = (name: string) => ({ name, platform: "linux", lastSeen: "2026-10-29T08:00:00Z", lastRoute: "lan" });

afterEach(() => {
  cleanup();
  useLanSyncStore.setState({ peers: [], known: {}, peerClocks: {}, localClocks: {}, syncing: new Set() });
});

describe("useLanDeviceRows", () => {
  test("lists nearby and known devices, never self or cloud-only clock entries", async () => {
    useLanSyncStore.setState({
      peers: [peer("self"), peer("a")],
      known: { self: known("me"), b: known("b") },
      peerClocks: { b: { "hosts:1": "2026-10-01" }, cloudOnly: { "hosts:1": "2026-10-01" } },
      localClocks: { "hosts:1": "2026-10-02" },
      syncing: new Set(),
    });
    const { result } = renderHook(() => useLanDeviceRows());
    await waitFor(() => expect(result.current.map((r) => r.deviceId)).toEqual(["a", "b"]));
    expect(result.current[1]).toMatchObject({ nearby: false, dot: "behind", behind: 1 });
  });

  test("returns the same array while the store is unchanged", async () => {
    useLanSyncStore.setState({ peers: [peer("self"), peer("a")] });
    const { result, rerender } = renderHook(() => useLanDeviceRows());
    await waitFor(() => expect(result.current).toHaveLength(1));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
