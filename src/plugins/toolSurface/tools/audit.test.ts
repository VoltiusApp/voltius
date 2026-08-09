import { describe, it, expect, vi } from "vitest";
import { buildAuditTools, AUDIT_PERMISSIONS } from "./audit";
import type { ToolSurfacePorts } from "../coreTools";

const portsWith = (query: ReturnType<typeof vi.fn>) =>
  ({
    api: { audit: { query } },
    approve: async () => ({ approve: true, scope: "mcp", via: "granted" }),
    audit: vi.fn(),
    owned: new Set<string>(),
  }) as unknown as ToolSurfacePorts;

describe("audit_query", () => {
  it("declares exactly the permission it reaches", () => {
    expect([...AUDIT_PERMISSIONS]).toEqual(["audit:read"]);
  });

  it("passes filters through and returns the rows", async () => {
    const query = vi.fn().mockResolvedValue({ logs: [{ action: "agent.command_run" }], total: 1 });
    const tool = buildAuditTools(portsWith(query)).find((t) => t.name === "audit_query")!;
    const res = await tool.execute({ limit: 5, action: "agent.command_run" });
    expect(query).toHaveBeenCalledWith({
      actions: ["agent.command_run"],
      from: undefined,
      to: undefined,
      page: 1,
      perPage: 5,
    });
    expect(res).toEqual({ logs: [{ action: "agent.command_run" }], total: 1 });
  });

  it("writes no audit row of its own", async () => {
    const audit = vi.fn();
    const ports = { ...portsWith(vi.fn().mockResolvedValue({ logs: [], total: 0 })), audit };
    const tool = buildAuditTools(ports as ToolSurfacePorts).find((t) => t.name === "audit_query")!;
    await tool.execute({});
    expect(audit).not.toHaveBeenCalled();
  });
});
