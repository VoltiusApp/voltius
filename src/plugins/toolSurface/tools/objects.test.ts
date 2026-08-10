import { describe, expect, it, vi } from "vitest";
import { buildObjectTools, OBJECT_PERMISSIONS } from "./objects";
import type { ToolSurfacePorts } from "../coreTools";

function makePorts(move = vi.fn(async () => ({ moved: 1, created: 0, skipped: 0 })), approve = true) {
  const audit = vi.fn();
  const api = {
    objects: {
      move,
      copy: vi.fn(async () => ({ moved: 0, created: 1, skipped: 0 })),
    },
  };
  const ports = {
    api,
    approve: async ({ args }: { args: Record<string, unknown> }) =>
      approve
        ? { approve: true, scope: "mcp", via: "granted", args }
        : { approve: false, reason: "denied" },
    audit,
    owned: new Set<string>(),
  } as unknown as ToolSurfacePorts;
  return { ports, api, audit };
}

const tool = (ports: ToolSurfacePorts, name: string) =>
  buildObjectTools(ports).find((t) => t.name === name)!;

describe("object tools", () => {
  it("exposes exactly object_move and object_copy", () => {
    expect(buildObjectTools(makePorts().ports).map((t) => t.name)).toEqual(["object_move", "object_copy"]);
  });

  it("declares the per-kind write permissions and folders:write", () => {
    expect([...OBJECT_PERMISSIONS]).toEqual([
      "connections:write", "keys:write", "identities:write",
      "snippets:write", "port_forwarding:write", "folders:write", "audit",
    ]);
  });

  it("passes ids, folder, vault and the flag through", async () => {
    const move = vi.fn(async () => ({ moved: 2, created: 0, skipped: 0 }));
    const { ports } = makePorts(move);
    await tool(ports, "object_move").execute({
      ids: ["a", "b"], folder_id: "f1", vault_id: "v1", allow_cross_vault: true,
    });
    expect(move).toHaveBeenCalledWith({
      ids: ["a", "b"], folderId: "f1", vaultId: "v1", allowCrossVault: true,
    });
  });

  it("treats a missing folder_id as the root", async () => {
    const move = vi.fn(async () => ({ moved: 1, created: 0, skipped: 0 }));
    const { ports } = makePorts(move);
    await tool(ports, "object_move").execute({ ids: ["a"], vault_id: "v1" });
    expect(move).toHaveBeenCalledWith(expect.objectContaining({ folderId: null }));
  });

  it("reports a refusal as an error result, not a success", async () => {
    const move = vi.fn(async () => { throw new Error("Refused: allowCrossVault"); });
    const { ports } = makePorts(move);
    const result = await tool(ports, "object_move").execute({ ids: ["a"], vault_id: "v1" });
    expect(result).toEqual({ error: expect.stringContaining("allowCrossVault") });
  });

  it("audits the first object id but names no destination the caller passed", async () => {
    const { ports, audit } = makePorts();
    await tool(ports, "object_move").execute({ ids: ["a", "b"], folder_id: "f1", vault_id: "v1" });
    const [, action, meta] = audit.mock.calls[0];
    expect(action).toBe("agent.object_updated");
    expect(meta).toMatchObject({ objectType: "object", tool: "object_move", objectId: "a" });
    expect(JSON.stringify(meta)).not.toContain("f1");
    expect(JSON.stringify(meta)).not.toContain("v1");
  });

  it("object_copy calls copy and audits agent.object_created", async () => {
    const { ports, api, audit } = makePorts();
    await tool(ports, "object_copy").execute({ ids: ["a"], vault_id: "v1" });
    expect(api.objects.copy).toHaveBeenCalledWith({
      ids: ["a"], folderId: null, vaultId: "v1", allowCrossVault: undefined,
    });
    expect(audit.mock.calls[0][1]).toBe("agent.object_created");
    expect(audit.mock.calls[0][2]).toMatchObject({ objectId: "a" });
  });

  it("rejects when the caller's approval is denied", async () => {
    const move = vi.fn(async () => ({ moved: 1, created: 0, skipped: 0 }));
    const { ports } = makePorts(move, false);
    const result = await tool(ports, "object_move").execute({ ids: ["a"], vault_id: "v1" });
    expect(move).not.toHaveBeenCalled();
    expect(result).toMatchObject({ error: "rejected by user" });
  });
});
