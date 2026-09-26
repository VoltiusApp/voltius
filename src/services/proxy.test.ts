import { describe, it, expect, vi, beforeEach } from "vitest";

const secrets: Record<string, string> = {};
vi.mock("@/services/vault", () => ({ getSecret: async (k: string) => secrets[k] ?? null }));

import { DEFAULT_PROXY_PORT, resolveFirstHopProxy, resolveProxy } from "./proxy";
import { useConnectivitySettingsStore } from "@/stores/connectivitySettingsStore";
import { useConnectionStore } from "@/stores/connectionStore";
import type { Connection, JumpHost } from "@/types";

const TYPED_PW = ["typed", "pw"].join("-");

const setGlobal = (proxy: object) => useConnectivitySettingsStore.setState({ proxy } as never);

describe("resolveProxy", () => {
  beforeEach(() => {
    for (const k of Object.keys(secrets)) delete secrets[k];
    setGlobal({ mode: "none" });
  });

  it("global none + no override → null (direct, unchanged behaviour)", async () => {
    expect(await resolveProxy({ id: "c" })).toBeNull();
  });

  it("inherits the global socks5 with the global password", async () => {
    setGlobal({ mode: "socks5", host: "g", port: 1080, username: "gu" });
    secrets["proxy_password:__global__"] = "gp";
    expect(await resolveProxy({ id: "c" })).toEqual({ kind: "socks5", host: "g", port: 1080, username: "gu", password: "gp" });
  });

  it("override direct beats global socks5", async () => {
    setGlobal({ mode: "socks5", host: "g", port: 1080 });
    expect(await resolveProxy({ id: "c", proxy: { mode: "direct" } })).toEqual({ kind: "direct" });
  });

  it("per-host http uses the per-host password", async () => {
    secrets["proxy_password:c"] = "hp";
    expect(await resolveProxy({ id: "c", proxy: { mode: "http", host: "h", port: 3128, username: "hu" } }))
      .toEqual({ kind: "http", host: "h", port: 3128, username: "hu", password: "hp" });
  });

  it("system passes through without credentials", async () => {
    setGlobal({ mode: "system" });
    expect(await resolveProxy({ id: "c" })).toEqual({ kind: "system" });
  });

  it("custom mode with no host throws instead of silently connecting direct", async () => {
    await expect(resolveProxy({ id: "c", proxy: { mode: "socks5", port: 1080 } })).rejects.toThrow(/SOCKS5/);
    await expect(resolveProxy({ id: "c", proxy: { mode: "http", host: "  " } })).rejects.toThrow(/HTTP/);
    setGlobal({ mode: "socks5" });
    await expect(resolveProxy({ id: "c" })).rejects.toThrow();
  });

  it.each([
    ["socks5", 1080],
    ["http", 8080],
  ] as const)("%s with an empty port uses the default port", async (mode, port) => {
    expect(await resolveProxy({ id: "c", proxy: { mode, host: "h" } })).toEqual({ kind: mode, host: "h", port });
    expect(DEFAULT_PROXY_PORT[mode]).toBe(port);
  });

  it("form overrides win over the saved values", async () => {
    secrets["proxy_password:c"] = "saved";
    const spec = await resolveProxy(
      { id: "c", proxy: { mode: "direct" } },
      { proxy: { mode: "socks5", host: "typed", port: 9 }, password: TYPED_PW },
    );
    expect(spec).toEqual({ kind: "socks5", host: "typed", port: 9, password: TYPED_PW });
  });
});

describe("resolveFirstHopProxy", () => {
  const conn = (id: string, over: Partial<Connection> = {}) =>
    ({ id, host: `${id}.example`, port: 22, username: "root", auth_type: "password", tags: [], ...over }) as Connection;
  const via = (connection_id: string, over: Partial<JumpHost> = {}): JumpHost => ({ id: `j-${connection_id}`, connection_id, ...over });

  beforeEach(() => {
    for (const k of Object.keys(secrets)) delete secrets[k];
    setGlobal({ mode: "http", host: "global", port: 3128 });
    useConnectionStore.setState({ connections: [], teamConnections: {} });
  });

  it("dials the first bastion through its own override when the target inherits", async () => {
    secrets[["proxy_password", "bastion"].join(":")] = "bp";
    useConnectionStore.setState({
      connections: [conn("bastion", { proxy: { mode: "socks5", host: "bastion-proxy", port: 1080, username: "bu" } })],
    });
    expect(await resolveFirstHopProxy(conn("target", { jump_hosts: [via("bastion")] })))
      .toEqual({ kind: "socks5", host: "bastion-proxy", port: 1080, username: "bu", password: "bp" });
  });

  it("uses the target's override when the bastion inherits", async () => {
    useConnectionStore.setState({ connections: [conn("bastion")] });
    const target = conn("target", { proxy: { mode: "direct" }, jump_hosts: [via("bastion")] });
    expect(await resolveFirstHopProxy(target)).toEqual({ kind: "direct" });
  });

  it("matches resolveProxy when there are no jump hosts", async () => {
    const target = conn("target", { proxy: { mode: "socks5", host: "t", port: 9 } });
    expect(await resolveFirstHopProxy(target)).toEqual(await resolveProxy(target));
    expect(await resolveFirstHopProxy(conn("plain"))).toEqual({ kind: "http", host: "global", port: 3128 });
  });

  it("an inline jump host with no managed connection uses the target's resolution", async () => {
    const target = conn("target", { proxy: { mode: "system" }, jump_hosts: [via("gone", { host: "b", port: 22 })] });
    expect(await resolveFirstHopProxy(target)).toEqual({ kind: "system" });
  });

  it("only the first jump decides the first hop", async () => {
    useConnectionStore.setState({
      connections: [conn("first"), conn("second", { proxy: { mode: "socks5", host: "second-proxy" } })],
    });
    const target = conn("target", { jump_hosts: [via("first"), via("second")] });
    expect(await resolveFirstHopProxy(target)).toEqual({ kind: "http", host: "global", port: 3128 });
  });
});
