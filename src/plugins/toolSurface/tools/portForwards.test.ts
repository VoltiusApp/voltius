import { describe, expect, it, vi } from "vitest";
import { buildPortForwardTools, PORT_FORWARD_PERMISSIONS } from "./portForwards";
import type { ToolSurfacePorts } from "../coreTools";

const RULE = {
  id: "r1", name: "Postgres", local_port: 5432, remote_port: 5432, remote_host: "db.internal",
  tunnel_type: "local", bind_host: "127.0.0.1", target_host: "localhost", connection_ids: [],
  vault_id: "personal", folder_id: null,
};
const TUNNEL = {
  id: "t1", tunnel_type: "local", local_port: 5432, remote_port: 5432,
  remote_host: "db.internal", state: "active", bytes_transferred: 0,
};

function makePorts(over: Record<string, unknown> = {}, approve = true) {
  const audit = vi.fn();
  const api = {
    portForwards: {
      list: vi.fn(async () => [RULE]),
      create: vi.fn(async () => ({ ...RULE, id: "r2" })),
      update: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      tunnels: vi.fn(async () => [TUNNEL]),
      start: vi.fn(async () => TUNNEL),
      stop: vi.fn(async () => {}),
      ...over,
    },
  };
  const ports = {
    api,
    approve: async ({ args }: { tool: string; args: Record<string, unknown> }) =>
      ({ approve, scope: "mcp", via: "granted", args }),
    audit,
    owned: new Set<string>(),
  } as unknown as ToolSurfacePorts;
  return { ports, api, audit };
}

const tool = (ports: ToolSurfacePorts, name: string) =>
  buildPortForwardTools(ports).find((t) => t.name === name)!;

describe("port forwarding verbs", () => {
  it("lists saved rules with their placement", async () => {
    const { ports } = makePorts();
    expect(await tool(ports, "port_forward_list").execute({})).toEqual([RULE]);
  });

  it("rejects a port outside the bindable range at the schema", () => {
    const { ports } = makePorts();
    const base = { name: "x", remote_port: 5432, remote_host: "h", tunnel_type: "local" };
    expect(tool(ports, "port_forward_create").schema.safeParse({ ...base, local_port: 0 }).success)
      .toBe(false);
    expect(tool(ports, "port_forward_create").schema.safeParse({ ...base, local_port: 70000 }).success)
      .toBe(false);
    expect(tool(ports, "port_forward_create").schema.safeParse({ ...base, local_port: 5432 }).success)
      .toBe(true);
  });

  it("passes only the fields an update names", async () => {
    const { ports, api } = makePorts();
    await tool(ports, "port_forward_update").execute({ id: "r1", local_port: 15432 });
    expect(api.portForwards.update).toHaveBeenCalledWith("r1", { local_port: 15432 });
  });

  it("lists the tunnels open on a session without an approval", async () => {
    const { ports } = makePorts();
    expect(tool(ports, "port_forward_tunnels").risk).toBe("auto");
    expect(await tool(ports, "port_forward_tunnels").execute({ sessionId: "s1" })).toEqual([TUNNEL]);
  });

  it("opens a tunnel and records it as a run, not an object mutation", async () => {
    const { ports, api, audit } = makePorts();
    const result = await tool(ports, "port_forward_start").execute({ id: "r1", sessionId: "s1" });
    expect(api.portForwards.start).toHaveBeenCalledWith("r1", "s1");
    // The audit vocabulary is a closed set the team ingest whitelists; a tunnel
    // creates no vault object, so it rides on the run action rather than a new
    // name that would be dropped server-side.
    expect(audit).toHaveBeenCalledWith(
      "mcp",
      "agent.command_run",
      { tool: "port_forward_start", approval: "granted", objectType: "port_forward", objectId: "r1" },
      undefined,
    );
    expect(result).toEqual({ ok: true, result: TUNNEL });
  });

  it("stops a tunnel by its own id, leaving the saved rule alone", async () => {
    const { ports, api } = makePorts();
    expect(await tool(ports, "port_forward_stop").execute({ sessionId: "s1", tunnelId: "t1" }))
      .toEqual({ ok: true, result: null });
    expect(api.portForwards.stop).toHaveBeenCalledWith("s1", "t1");
    expect(api.portForwards.delete).not.toHaveBeenCalled();
  });

  it("binds no socket when the approval is denied", async () => {
    const { ports, api } = makePorts({}, false);
    expect(await tool(ports, "port_forward_start").execute({ id: "r1", sessionId: "s1" }))
      .toMatchObject({ refused: true, error: "rejected by user" });
    expect(api.portForwards.start).not.toHaveBeenCalled();
  });

  it("surfaces a closed session as a marked refusal, not a throw", async () => {
    const { ports } = makePorts({
      start: vi.fn(async () => { throw new Error('No open session "ghost"'); }),
    });
    expect(await tool(ports, "port_forward_start").execute({ id: "r1", sessionId: "ghost" }))
      .toMatchObject({ refused: true, error: expect.stringContaining("No open session") });
  });

  it("declares exactly the permissions its verbs reach", () => {
    expect([...PORT_FORWARD_PERMISSIONS].sort()).toEqual([
      "audit", "port_forwarding:read", "port_forwarding:write", "ports:forward", "sessions:read",
    ]);
  });
});
