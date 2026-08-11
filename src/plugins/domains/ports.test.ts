import { describe, test, expect, vi } from "vitest";
import { remoteHostFor, resolvePort, type ReachDeps } from "./ports";
import type { ActiveTunnel } from "@/types";

function tunnel(over: Partial<ActiveTunnel>): ActiveTunnel {
  return {
    id: "t1",
    tunnel_type: "local",
    local_port: 8080,
    remote_port: 8080,
    remote_host: "127.0.0.1",
    origin: { type: "ad_hoc" },
    state: "active",
    bytes_transferred: 0,
    ...over,
  } as ActiveTunnel;
}

function deps(over: Partial<ReachDeps> = {}): ReachDeps {
  return {
    getState: vi.fn(async () => ({ tunnels: [] })),
    openTunnel: vi.fn(async () => tunnel({})),
    ...over,
  };
}

describe("remoteHostFor", () => {
  test("wildcard and empty binds collapse to loopback", () => {
    expect(remoteHostFor("0.0.0.0")).toBe("127.0.0.1");
    expect(remoteHostFor("::")).toBe("127.0.0.1");
    expect(remoteHostFor(null)).toBe("127.0.0.1");
    expect(remoteHostFor("")).toBe("127.0.0.1");
  });

  test("a specific bind address is preserved", () => {
    expect(remoteHostFor("127.0.0.1")).toBe("127.0.0.1");
    expect(remoteHostFor("10.0.0.5")).toBe("10.0.0.5");
  });
});

describe("resolvePort", () => {
  test("a local docker target opens no tunnel", async () => {
    const d = deps();
    const r = await resolvePort(d, { sessionId: "s1", isRemote: false, hostPort: 8080, action: "browser" });
    expect(r).toEqual({ address: "http://localhost:8080", localPort: 8080, tunneled: false });
    expect(d.openTunnel).not.toHaveBeenCalled();
    expect(d.getState).not.toHaveBeenCalled();
  });

  test("a remote target opens an ad-hoc local tunnel", async () => {
    const d = deps({ openTunnel: vi.fn(async () => tunnel({ local_port: 8080 })) });
    const r = await resolvePort(d, { sessionId: "s1", isRemote: true, hostPort: 8080, hostIp: "0.0.0.0", action: "browser" });
    expect(d.openTunnel).toHaveBeenCalledWith({
      sessionId: "s1", localPort: 8080, remotePort: 8080, remoteHost: "127.0.0.1", tunnelType: "local",
    });
    expect(r).toEqual({ address: "http://localhost:8080", localPort: 8080, tunneled: true });
  });

  test("the address uses the port actually bound, not the port requested", async () => {
    const d = deps({ openTunnel: vi.fn(async () => tunnel({ local_port: 18080 })) });
    const r = await resolvePort(d, { sessionId: "s1", isRemote: true, hostPort: 8080, action: "browser" });
    expect(r).toEqual({ address: "http://localhost:18080", localPort: 18080, tunneled: true });
  });

  test("a live tunnel for the same remote port is reused, not stacked", async () => {
    const d = deps({
      getState: vi.fn(async () => ({ tunnels: [tunnel({ local_port: 19000, remote_port: 8080 })] })),
    });
    const r = await resolvePort(d, { sessionId: "s1", isRemote: true, hostPort: 8080, action: "browser" });
    expect(d.openTunnel).not.toHaveBeenCalled();
    expect(r).toEqual({ address: "http://localhost:19000", localPort: 19000, tunneled: false });
  });

  test("a tunnel for a different port, a non-local type, or a dead state is not reused", async () => {
    const d = deps({
      getState: vi.fn(async () => ({
        tunnels: [
          tunnel({ id: "a", remote_port: 9999, local_port: 9999 }),
          tunnel({ id: "b", remote_port: 8080, local_port: 1, tunnel_type: "remote" }),
          tunnel({ id: "c", remote_port: 8080, local_port: 2, state: { error: "closed" } }),
        ],
      })),
      openTunnel: vi.fn(async () => tunnel({ local_port: 8080 })),
    });
    const r = await resolvePort(d, { sessionId: "s1", isRemote: true, hostPort: 8080, action: "browser" });
    expect(d.openTunnel).toHaveBeenCalled();
    expect(r.localPort).toBe(8080);
  });

  test("the copy action returns a bare host:port with no scheme", async () => {
    const d = deps({ openTunnel: vi.fn(async () => tunnel({ local_port: 5432, remote_port: 5432 })) });
    const r = await resolvePort(d, { sessionId: "s1", isRemote: true, hostPort: 5432, action: "copy" });
    expect(r.address).toBe("localhost:5432");
  });

  test("the https scheme is honoured for browser actions", async () => {
    const r = await resolvePort(deps(), { sessionId: "s1", isRemote: false, hostPort: 8443, scheme: "https", action: "browser" });
    expect(r.address).toBe("https://localhost:8443");
  });
});
