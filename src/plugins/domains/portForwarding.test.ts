import { describe, expect, it, vi } from "vitest";
import type { ActiveTunnel, PortForwardingRule } from "@/types";
import { createPortForwardsAPI, type PortForwardPorts } from "./portForwarding";

const rule = (over: Partial<PortForwardingRule> = {}): PortForwardingRule => ({
  id: "r1",
  name: "Postgres",
  local_port: 5432,
  remote_port: 5432,
  remote_host: "db.internal",
  tunnel_type: "local",
  bind_host: "127.0.0.1",
  target_host: "localhost",
  connection_ids: [],
  created_at: "", updated_at: "", vault_id: "personal", clocks: {},
  ...over,
} as PortForwardingRule);

const tunnel: ActiveTunnel = {
  id: "t1", tunnel_type: "local", local_port: 5432, remote_port: 5432,
  remote_host: "db.internal", origin: { type: "rule", rule_id: "r1", rule_name: "Postgres" },
  state: "active", bytes_transferred: 0,
};

function makePorts(over: Partial<PortForwardPorts> = {}, items: PortForwardingRule[] = [rule()]) {
  const ports: PortForwardPorts = {
    hydrate: vi.fn(async () => {}),
    list: () => items,
    create: vi.fn(async (data) => rule({ id: "r2", name: data.name })),
    update: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    isTeamVault: (id) => id === "team-1",
    sessionExists: (id) => id === "sess-1",
    tunnels: vi.fn(async () => [tunnel]),
    open: vi.fn(async () => tunnel),
    close: vi.fn(async () => {}),
    ...over,
  };
  return { ports, api: createPortForwardsAPI(ports) };
}

describe("port forwarding domain", () => {
  it("projects placement so a moved rule can be found again", async () => {
    const { api } = makePorts({}, [rule({ vault_id: "v1", folder_id: "f1" })]);
    expect(await api.list()).toMatchObject([{ vault_id: "v1", folder_id: "f1" }]);
  });

  it("keeps the fields an update does not name", async () => {
    const update = vi.fn(async () => {});
    const { api } = makePorts({ update });
    await api.update("r1", { name: "PG" });
    expect(update).toHaveBeenCalledWith("r1", expect.objectContaining({
      name: "PG", local_port: 5432, remote_host: "db.internal", tunnel_type: "local",
    }));
  });

  it("refuses a port that cannot bind, naming the field", async () => {
    const { api } = makePorts();
    await expect(api.update("r1", { local_port: 70000 }))
      .rejects.toThrow(/local_port must be a port between 1 and 65535/);
  });

  it("refuses to change or delete a rule in a team vault", async () => {
    const { api, ports } = makePorts({}, [rule({ vault_id: "team-1" })]);
    await expect(api.update("r1", { name: "x" })).rejects.toThrow(/team vault/);
    await expect(api.delete("r1")).rejects.toThrow(/team vault/);
    expect(ports.update).not.toHaveBeenCalled();
    expect(ports.remove).not.toHaveBeenCalled();
  });

  it("starts a tunnel from the rule's own shape, not from caller-supplied ports", async () => {
    const open = vi.fn(async () => tunnel);
    const { api } = makePorts({ open });
    await api.start("r1", "sess-1");
    expect(open).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "sess-1", localPort: 5432, remoteHost: "db.internal",
      tunnelType: "local", ruleId: "r1", ruleName: "Postgres",
    }));
  });

  it("starts a team-vault rule: opening a tunnel writes nothing", async () => {
    const open = vi.fn(async () => tunnel);
    const { api } = makePorts({ open }, [rule({ vault_id: "team-1" })]);
    await expect(api.start("r1", "sess-1")).resolves.toMatchObject({ id: "t1" });
    expect(open).toHaveBeenCalled();
  });

  it("refuses a session that is not open rather than binding nothing", async () => {
    const open = vi.fn(async () => tunnel);
    const { api } = makePorts({ open });
    await expect(api.start("r1", "ghost")).rejects.toThrow(/No open session "ghost"/);
    await expect(api.tunnels("ghost")).rejects.toThrow(/No open session/);
    await expect(api.stop("ghost", "t1")).rejects.toThrow(/No open session/);
    expect(open).not.toHaveBeenCalled();
  });

  it("drops a tunnel's origin, which only echoes the rule the caller named", async () => {
    const { api } = makePorts();
    const [out] = await api.tunnels("sess-1");
    expect(out).not.toHaveProperty("origin");
    expect(out).toMatchObject({ id: "t1", state: "active", local_port: 5432 });
  });
});
