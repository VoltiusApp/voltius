import { describe, expect, it, vi } from "vitest";
import { buildVaultTools, VAULT_PERMISSIONS } from "./vaults";
import type { ToolSurfacePorts } from "../coreTools";

function makePorts(overrides: Record<string, unknown> = {}, approve = true) {
  const audit = vi.fn();
  const api = {
    vaults: {
      list: vi.fn(() => [
        { id: "personal", name: "Personal", team: false },
        { id: "v-1", name: "Homelab", team: false },
      ]),
      create: vi.fn(() => ({ id: "v-2", name: "Fresh", team: false })),
      rename: vi.fn(),
      delete: vi.fn(async () => undefined),
      ...overrides,
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
  buildVaultTools(ports).find((t) => t.name === name)!;

describe("vault verbs", () => {
  it("declares every permission its verbs reach", () => {
    expect([...VAULT_PERMISSIONS]).toEqual(["vaults:read", "vaults:write", "audit"]);
  });

  it("lists vaults without an approval prompt", async () => {
    const { ports, audit } = makePorts();
    expect(tool(ports, "vault_list").risk).toBe("auto");
    expect(await tool(ports, "vault_list").execute({})).toEqual([
      { id: "personal", name: "Personal", team: false },
      { id: "v-1", name: "Homelab", team: false },
    ]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("creates a vault and records the object type without its name", async () => {
    const { ports, api, audit } = makePorts();
    const result = await tool(ports, "vault_create").execute({ name: "Fresh" });
    expect(api.vaults.create).toHaveBeenCalledWith("Fresh");
    expect(result).toEqual({ ok: true, result: { id: "v-2", name: "Fresh", team: false } });
    const [, action, meta] = audit.mock.calls[0];
    expect(action).toBe("agent.object_created");
    expect(meta).toEqual({ tool: "vault_create", approval: "granted", objectType: "vault" });
    expect(JSON.stringify(meta)).not.toContain("Fresh");
  });

  it("renames a vault", async () => {
    const { ports, api, audit } = makePorts();
    await tool(ports, "vault_rename").execute({ id: "v-1", name: "Lab" });
    expect(api.vaults.rename).toHaveBeenCalledWith("v-1", "Lab");
    expect(audit.mock.calls[0][1]).toBe("agent.object_updated");
  });

  it("deletes without cascade by default", async () => {
    const { ports, api } = makePorts();
    await tool(ports, "vault_delete").execute({ id: "v-1" });
    expect(api.vaults.delete).toHaveBeenCalledWith("v-1", { cascade: false });
  });

  it("passes cascade through only when explicitly true", async () => {
    const { ports, api } = makePorts();
    await tool(ports, "vault_delete").execute({ id: "v-1", cascade: true });
    expect(api.vaults.delete).toHaveBeenCalledWith("v-1", { cascade: true });
  });

  it("surfaces a refusal as an error instead of throwing", async () => {
    const { ports } = makePorts({
      delete: vi.fn(async () => { throw new Error('Vault "Homelab" still holds 2 connections'); }),
    });
    expect(await tool(ports, "vault_delete").execute({ id: "v-1" })).toEqual({
      error: 'Vault "Homelab" still holds 2 connections',
    });
  });

  it("a rejected approval never reaches the store", async () => {
    const { ports, api, audit } = makePorts({}, false);
    const result = await tool(ports, "vault_delete").execute({ id: "v-1" });
    expect(result).toMatchObject({ error: "rejected by user" });
    expect(api.vaults.delete).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});
