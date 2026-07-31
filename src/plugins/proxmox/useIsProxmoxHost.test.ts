import { describe, test, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { useIsProxmoxHost } from "./useIsProxmoxHost";
import type { PluginAPI, PluginConnection, PluginSession } from "@/plugins/api";

afterEach(cleanup);

function fakeApi(distro: string | undefined): PluginAPI {
  return {
    connections: {
      get: vi.fn(async (id: string) => ({ id, distro }) as PluginConnection),
    },
  } as unknown as PluginAPI;
}

function session(connectionId: string): PluginSession {
  return { id: "s1", connectionId, connectionName: "c", status: "connected", type: "ssh" };
}

describe("useIsProxmoxHost", () => {
  // The regression this guards: ProxmoxPanel used to default to `false` while the
  // async api.connections.get lookup was in flight, so it rendered the "not a
  // Proxmox host" placeholder on every mount/session-change before flipping to the
  // real panel. `null` lets a caller distinguish "still checking" from "checked,
  // and it's not one" — collapsing that distinction is exactly what caused the flash.
  test("starts null (not false) while the lookup is in flight", () => {
    const { result } = renderHook(() => useIsProxmoxHost(fakeApi("proxmox"), session("c1")));
    expect(result.current).toBeNull();
  });

  test("resolves true for a proxmox host", async () => {
    const { result } = renderHook(() => useIsProxmoxHost(fakeApi("proxmox"), session("c1")));
    await waitFor(() => expect(result.current).toBe(true));
  });

  test("resolves false for a non-proxmox host", async () => {
    const { result } = renderHook(() => useIsProxmoxHost(fakeApi("debian"), session("c1")));
    await waitFor(() => expect(result.current).toBe(false));
  });

  test("resets to null (not false) when the session changes, then re-resolves", async () => {
    const api = fakeApi("proxmox");
    const { result, rerender } = renderHook(({ s }) => useIsProxmoxHost(api, s), {
      initialProps: { s: session("c1") },
    });
    await waitFor(() => expect(result.current).toBe(true));

    rerender({ s: session("c2") });
    expect(result.current).toBeNull();

    await waitFor(() => expect(result.current).toBe(true));
  });

  test("null session resolves to null, not false", () => {
    const { result } = renderHook(() => useIsProxmoxHost(fakeApi("proxmox"), null));
    expect(result.current).toBeNull();
  });
});
