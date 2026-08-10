import { describe, expect, it, vi } from "vitest";
import { buildFolderTools, FOLDER_PERMISSIONS } from "./folders";
import type { ToolSurfacePorts } from "../coreTools";

function makePorts(overrides: Record<string, unknown> = {}) {
  const audit = vi.fn();
  const api = {
    folders: {
      list: vi.fn(() => [
        { id: "f-1", name: "Prod", kind: "connection", vaultId: "personal", parentFolderId: null, team: false },
      ]),
      create: vi.fn(async () => ({
        id: "f-2", name: "Lab", kind: "keychain", vaultId: "personal", parentFolderId: null, team: false,
      })),
      rename: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      ...overrides,
    },
  };
  const ports = {
    api,
    approve: async ({ args }: { args: Record<string, unknown> }) => ({ approve: true, scope: "mcp", via: "granted", args }),
    audit,
    owned: new Set<string>(),
  } as unknown as ToolSurfacePorts;
  return { ports, api, audit };
}

const tool = (ports: ToolSurfacePorts, name: string) =>
  buildFolderTools(ports).find((t) => t.name === name)!;

describe("folder verbs", () => {
  it("declares every permission its verbs reach", () => {
    expect([...FOLDER_PERMISSIONS]).toEqual(["folders:read", "folders:write", "audit"]);
  });

  it("lists every kind when kind is omitted", async () => {
    const { ports, api } = makePorts();
    await tool(ports, "folder_list").execute({});
    expect(api.folders.list).toHaveBeenCalledWith(undefined);
  });

  it("filters by kind", async () => {
    const { ports, api } = makePorts();
    await tool(ports, "folder_list").execute({ kind: "snippet" });
    expect(api.folders.list).toHaveBeenCalledWith("snippet");
  });

  it("rejects a kind outside the four trees before reaching the store", () => {
    const { ports, api } = makePorts();
    expect(() => tool(ports, "folder_list").schema.parse({ kind: "keys" })).toThrow();
    expect(api.folders.list).not.toHaveBeenCalled();
  });

  it("creates a folder and records no name in the audit row", async () => {
    const { ports, api, audit } = makePorts();
    await tool(ports, "folder_create").execute({ kind: "keychain", name: "Lab", vaultId: "v-1" });
    expect(api.folders.create).toHaveBeenCalledWith({
      kind: "keychain", name: "Lab", vaultId: "v-1", parentFolderId: undefined,
    });
    const [, action, meta] = audit.mock.calls[0];
    expect(action).toBe("agent.object_created");
    expect(meta).toEqual({ tool: "folder_create", approval: "granted", objectType: "folder" });
    expect(JSON.stringify(meta)).not.toContain("Lab");
  });

  it("renames a folder", async () => {
    const { ports, api, audit } = makePorts();
    await tool(ports, "folder_rename").execute({ id: "f-1", name: "Staging" });
    expect(api.folders.rename).toHaveBeenCalledWith("f-1", "Staging");
    expect(audit.mock.calls[0][1]).toBe("agent.object_updated");
  });

  it("deletes with cascade on by default, matching the app", async () => {
    const { ports, api } = makePorts();
    await tool(ports, "folder_delete").execute({ id: "f-1" });
    expect(api.folders.delete).toHaveBeenCalledWith("f-1", { cascade: true });
  });

  it("honours cascade false", async () => {
    const { ports, api } = makePorts();
    await tool(ports, "folder_delete").execute({ id: "f-1", cascade: false });
    expect(api.folders.delete).toHaveBeenCalledWith("f-1", { cascade: false });
  });

  it("surfaces a team refusal as an error", async () => {
    const { ports } = makePorts({
      delete: vi.fn(async () => { throw new Error('Folder is in team vault "t-1" and cannot be deleted from here'); }),
    });
    expect(await tool(ports, "folder_delete").execute({ id: "f-team" })).toMatchObject({
      error: expect.stringContaining("team vault"),
    });
  });
});
