import { describe, expect, it, vi } from "vitest";
import { buildKnownHostTools, KNOWN_HOST_PERMISSIONS } from "./knownHosts";
import type { ToolSurfacePorts } from "../coreTools";

function makePorts(overrides: Record<string, unknown> = {}, approve = true) {
  const audit = vi.fn();
  const api = {
    knownHosts: {
      list: vi.fn(async () => [
        { id: "kh-1", host: "h1", port: 22, fingerprint: "SHA256:aaa", vault_id: "personal", created_at: "2026-01-01T00:00:00Z" },
      ]),
      delete: vi.fn(async () => undefined),
      trust: vi.fn(async () => ({
        entry: { id: "kh-2", host: "h1", port: 22, fingerprint: "SHA256:new", vault_id: "personal", created_at: "2026-01-02T00:00:00Z" },
        superseded: [],
        replaced: false,
      })),
      ...overrides,
    },
  };
  const ports = {
    api,
    approve: async ({ args }: { args: Record<string, unknown> }) =>
      approve ? { approve: true, scope: "mcp", via: "granted", args } : { approve: false, reason: "denied" },
    audit,
    owned: new Set<string>(),
  } as unknown as ToolSurfacePorts;
  return { ports, api, audit };
}

const tool = (ports: ToolSurfacePorts, name: string) =>
  buildKnownHostTools(ports).find((t) => t.name === name)!;

describe("known host verbs", () => {
  it("declares every permission its verbs reach", () => {
    expect([...KNOWN_HOST_PERMISSIONS]).toEqual(["known_hosts:read", "known_hosts:write", "audit"]);
  });

  it("lists without an approval prompt", async () => {
    const { ports, audit } = makePorts();
    expect(tool(ports, "known_host_list").risk).toBe("auto");
    expect(await tool(ports, "known_host_list").execute({})).toHaveLength(1);
    expect(audit).not.toHaveBeenCalled();
  });

  it("passes the host and port filter through", async () => {
    const { ports, api } = makePorts();
    await tool(ports, "known_host_list").execute({ host: "h1", port: 22 });
    expect(api.knownHosts.list).toHaveBeenCalledWith({ host: "h1", port: 22 });
  });

  it("deletes and audits as an object deletion", async () => {
    const { ports, api, audit } = makePorts();
    const res = await tool(ports, "known_host_delete").execute({ id: "kh-1" });
    expect(api.knownHosts.delete).toHaveBeenCalledWith("kh-1");
    expect(res).toEqual({ ok: true, result: null });
    const [, action, meta] = audit.mock.calls[0];
    expect(action).toBe("agent.object_deleted");
    expect(meta).toEqual({
      tool: "known_host_delete", approval: "granted", objectType: "known_host", objectId: "kh-1",
    });
  });

  it("audits a trust by host:port, without the fingerprint", async () => {
    const { ports, audit } = makePorts();
    await tool(ports, "known_host_trust").execute({
      host: "h1", port: 22, fingerprint: "SHA256:new", replace: true,
    });
    const [, action, meta] = audit.mock.calls[0];
    expect(action).toBe("agent.object_created");
    expect(meta).toEqual({
      tool: "known_host_trust", approval: "granted", objectType: "known_host",
      objectId: "h1:22", replace: true,
    });
  });

  it("reports what a replace superseded", async () => {
    const { ports } = makePorts({
      trust: vi.fn(async () => ({
        entry: { id: "kh-3", host: "h1", port: 22, fingerprint: "SHA256:new", vault_id: "personal", created_at: "2026-01-03T00:00:00Z" },
        superseded: [{ id: "kh-1", host: "h1", port: 22, fingerprint: "SHA256:old", vault_id: "personal", created_at: "2026-01-01T00:00:00Z" }],
        replaced: true,
      })),
    });
    const res = await tool(ports, "known_host_trust").execute({
      host: "h1", port: 22, fingerprint: "SHA256:new", replace: true,
    }) as { ok: true; result: { replaced: boolean; superseded: unknown[] } };
    expect(res.result.replaced).toBe(true);
    expect(res.result.superseded).toHaveLength(1);
  });

  it("refuses a trust the user rejected, without calling the api", async () => {
    const { ports, api } = makePorts({}, false);
    const res = await tool(ports, "known_host_trust").execute({ host: "h1", port: 22, fingerprint: "x" });
    expect(res).toMatchObject({ refused: true });
    expect(api.knownHosts.trust).not.toHaveBeenCalled();
  });
});
