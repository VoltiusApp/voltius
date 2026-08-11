import { describe, expect, it, vi } from "vitest";
import { buildSnippetTools, SNIPPET_PERMISSIONS } from "./snippets";
import type { ToolSurfacePorts } from "../coreTools";

const SNIPPET = {
  id: "s1", name: "Restart nginx", steps: [{ kind: "script", content: "systemctl restart nginx" }],
  tags: [], favorite: false, only_for_connection_tags: [], only_for_distros: [],
  vault_id: "personal", folder_id: null,
};

function makePorts(over: Record<string, unknown> = {}, approve = true) {
  const audit = vi.fn();
  const api = {
    snippets: {
      list: vi.fn(async () => [SNIPPET]),
      create: vi.fn(async () => ({ ...SNIPPET, id: "s2" })),
      update: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
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
  buildSnippetTools(ports).find((t) => t.name === name)!;

describe("snippet verbs", () => {
  it("lists snippets with their placement", async () => {
    const { ports } = makePorts();
    expect(await tool(ports, "snippet_list").execute({})).toEqual([SNIPPET]);
  });

  it("accepts all three step kinds, so a snippet is not narrowed to shell text", () => {
    const { ports } = makePorts();
    const parsed = tool(ports, "snippet_create").schema.safeParse({
      name: "Deploy",
      steps: [
        { kind: "script", content: "echo hi" },
        {
          kind: "transfer", from: "local", to: "remote", from_path: "/a", to_path: "/b",
          is_dir: false, mode: "copy", on_conflict: "overwrite",
        },
        { kind: "snippet", snippet_id: "s1" },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a step kind the app cannot run", () => {
    const { ports } = makePorts();
    const parsed = tool(ports, "snippet_create").schema.safeParse({
      name: "x", steps: [{ kind: "reboot" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("creates a snippet and records an object_created row", async () => {
    const { ports, api, audit } = makePorts();
    const result = await tool(ports, "snippet_create").execute({ name: "Deploy", steps: [] });
    expect(api.snippets.create).toHaveBeenCalledWith({ name: "Deploy", steps: [] });
    expect(audit).toHaveBeenCalledWith(
      "mcp",
      "agent.object_created",
      { tool: "snippet_create", approval: "granted", objectType: "snippet" },
      undefined,
    );
    expect(result).toEqual({ ok: true, result: { ...SNIPPET, id: "s2" } });
  });

  it("passes only the fields an update names, so the rest survive", async () => {
    const { ports, api } = makePorts();
    await tool(ports, "snippet_update").execute({ id: "s1", name: "Reload" });
    expect(api.snippets.update).toHaveBeenCalledWith("s1", { name: "Reload" });
  });

  it("surfaces a team-vault refusal as a marked refusal, not a throw", async () => {
    const { ports } = makePorts({
      delete: vi.fn(async () => { throw new Error("Snippet \"x\" is in a team vault"); }),
    });
    expect(await tool(ports, "snippet_delete").execute({ id: "s1" }))
      .toMatchObject({ refused: true, error: expect.stringContaining("team vault") });
  });

  it("never reaches the store when the approval is denied", async () => {
    const { ports, api } = makePorts({}, false);
    expect(await tool(ports, "snippet_delete").execute({ id: "s1" }))
      .toMatchObject({ refused: true, error: "rejected by user" });
    expect(api.snippets.delete).not.toHaveBeenCalled();
  });

  it("declares exactly the permissions its verbs reach", () => {
    expect([...SNIPPET_PERMISSIONS].sort()).toEqual(["audit", "snippets:read", "snippets:write"]);
  });
});
