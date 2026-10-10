import { describe, expect, it } from "vitest";
import type { ActiveTunnel } from "@/types";
import { formatActiveTunnelLabel, getLocalTunnelHttpUrl } from "./tunnelFormat";

const tunnel = (over: Partial<ActiveTunnel>): ActiveTunnel => ({
  id: "t", tunnel_type: "local", local_port: 8080, remote_port: 80, remote_host: "db", origin: "ad_hoc", state: "active", ...over,
} as ActiveTunnel);

describe("formatActiveTunnelLabel", () => {
  it("leaves the listener address out while it is loopback", () => {
    expect(formatActiveTunnelLabel(tunnel({}))).toBe("8080 → db:80");
    expect(formatActiveTunnelLabel(tunnel({ bind_host: "127.0.0.1" }))).toBe("8080 → db:80");
    expect(formatActiveTunnelLabel(tunnel({ tunnel_type: "dynamic", local_port: 1080 }))).toBe(":1080 (SOCKS5)");
  });

  it("names the listener address once other devices can reach it", () => {
    expect(formatActiveTunnelLabel(tunnel({ bind_host: "0.0.0.0" }))).toBe("0.0.0.0:8080 → db:80");
    expect(formatActiveTunnelLabel(tunnel({ tunnel_type: "dynamic", local_port: 1080, bind_host: "192.168.1.2" }))).toBe("192.168.1.2:1080 (SOCKS5)");
  });
});

describe("getLocalTunnelHttpUrl", () => {
  it("opens localhost for a loopback or wildcard listener", () => {
    expect(getLocalTunnelHttpUrl("local", 80, 8080)).toBe("http://localhost:8080");
    expect(getLocalTunnelHttpUrl("local", 443, 8443, "0.0.0.0")).toBe("https://localhost:8443");
  });

  it("opens the bound address when the listener is on one interface only", () => {
    expect(getLocalTunnelHttpUrl("local", 80, 8080, "192.168.1.2")).toBe("http://192.168.1.2:8080");
    expect(getLocalTunnelHttpUrl("local", 80, 8080, "[fe80::1]")).toBe("http://[fe80::1]:8080");
  });

  it("has nothing to open for other tunnel types", () => {
    expect(getLocalTunnelHttpUrl("dynamic", 80, 1080, "0.0.0.0")).toBeNull();
  });
});
