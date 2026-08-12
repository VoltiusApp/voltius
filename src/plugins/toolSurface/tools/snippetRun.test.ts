import { describe, expect, it, vi } from "vitest";
import { buildSnippetRunTools, SNIPPET_RUN_PERMISSIONS } from "./snippetRun";
import type { ToolSurfacePorts } from "../coreTools";

function makePorts(run = vi.fn(async () => ({
  targets: [{ label: "web-01", ok: true }], flatten_errors: [], opened_session_ids: ["s-9"],
})), approve = true) {
  const audit = vi.fn();
  const api = { snippets: { run } };
  const ports = {
    api,
    approve: async ({ args }: { args: Record<string, unknown> }) =>
      approve ? { approve: true, scope: "mcp", via: "granted", args } : { approve: false, reason: "denied" },
    audit,
    owned: new Set<string>(),
  } as unknown as ToolSurfacePorts;
  return { ports, api, audit, run };
}

const tool = (ports: ToolSurfacePorts) => buildSnippetRunTools(ports).find((t) => t.name === "snippet_run")!;

describe("snippet_run", () => {
  it("declares every permission it reaches", () => {
    expect([...SNIPPET_RUN_PERMISSIONS]).toEqual(["snippets:read", "snippets:run", "audit"]);
  });

  it("prompts before running and audits as a command run", async () => {
    const { ports, audit, run } = makePorts();
    expect(tool(ports).risk).toBe("prompt");
    const res = await tool(ports).execute({ snippet_id: "s-1", targets: [{ session_id: "s-9" }] });
    expect(run).toHaveBeenCalledWith({
      snippetId: "s-1", targets: [{ session_id: "s-9" }], variables: undefined, dryRun: undefined,
    });
    expect(res).toMatchObject({ ok: true });
    const [, action, meta] = audit.mock.calls[0];
    expect(action).toBe("agent.command_run");
    expect(meta).toMatchObject({ tool: "snippet_run" });
  });

  it("returns a refusal, not a throw, when the engine reports missing variables", async () => {
    const { ports } = makePorts(vi.fn(async () => { throw new Error("Missing variables: svc. Pass them in `variables`."); }));
    const res = await tool(ports).execute({ snippet_id: "s-1", targets: [{ session_id: "s-9" }] });
    expect(res).toMatchObject({ refused: true });
    expect((res as { error: string }).error).toContain("svc");
  });

  it("does not run when the user rejects", async () => {
    const { ports, run } = makePorts(undefined, false);
    expect(await tool(ports).execute({ snippet_id: "s-1", targets: [{ session_id: "s-9" }] }))
      .toMatchObject({ refused: true });
    expect(run).not.toHaveBeenCalled();
  });
});
