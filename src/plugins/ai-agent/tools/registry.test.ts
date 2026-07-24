import { describe, test, expect, vi, beforeEach } from "vitest";
import { buildTools, type AgentContext } from "./registry";

vi.mock("./capture", () => ({
  captureCommand: vi.fn(async () => ({ output: "ok", exitCode: 0, timedOut: false, truncated: false })),
}));
import { captureCommand } from "./capture";

function ctx(over: Partial<AgentContext> = {}): { ctx: AgentContext; approve: any } {
  const approve = vi.fn(async () => ({ approve: true }));
  const api = {
    connections: { list: vi.fn(async () => [{ id: "c1", name: "srv", host: "h1" }]) },
    sessions: { open: vi.fn(async () => "sess-1"), close: vi.fn(async () => {}) },
    terminal: { readSnapshot: vi.fn(() => "last lines") },
  } as any;
  return { ctx: { api, approve, ...over }, approve };
}
const tool = (ctx: AgentContext, name: string) => buildTools(ctx).find((t) => t.name === name)!;
beforeEach(() => vi.clearAllMocks());

describe("tool registry", () => {
  test("list_connections is auto-risk and returns connections", async () => {
    const { ctx: c } = ctx();
    const t = tool(c, "list_connections");
    expect(t.risk).toBe("auto");
    expect(await t.execute({})).toEqual([{ id: "c1", name: "srv", host: "h1" }]);
  });

  test("read_terminal is auto-risk and reads a snapshot", async () => {
    const { ctx: c } = ctx();
    const t = tool(c, "read_terminal");
    expect(t.risk).toBe("auto");
    expect(await t.execute({ sessionId: "any", maxLines: 50 })).toBe("last lines");
    expect(c.api.terminal.readSnapshot).toHaveBeenCalledWith("any", 50);
  });

  test("open_session prompts, opens, and records the workbench as owned", async () => {
    const { ctx: c, approve } = ctx();
    const t = tool(c, "open_session");
    expect(t.risk).toBe("prompt");
    const res: any = await t.execute({ connectionId: "c1" });
    expect(approve).toHaveBeenCalledWith({ tool: "open_session", args: { connectionId: "c1" } });
    expect(res.sessionId).toBe("sess-1");
    // now run_command should accept that owned session
    const rc: any = await tool(c, "run_command").execute({ sessionId: "sess-1", command: "ls" });
    expect(rc.exitCode).toBe(0);
    expect(captureCommand).toHaveBeenCalled();
  });

  test("run_command hard-rejects a non-owned session (never runs)", async () => {
    const { ctx: c } = ctx();
    const res: any = await tool(c, "run_command").execute({ sessionId: "not-owned", command: "rm -rf /" });
    expect(res.error).toMatch(/not owned|open_session/i);
    expect(captureCommand).not.toHaveBeenCalled();
  });

  test("a rejected approval returns an error result and does not execute", async () => {
    const { ctx: c } = ctx({ approve: vi.fn(async () => ({ approve: false, reason: "no" })) as any });
    const res: any = await tool(c, "open_session").execute({ connectionId: "c1" });
    expect(res.error).toMatch(/rejected/i);
    expect(res.reason).toBe("no");
    expect(c.api.sessions.open).not.toHaveBeenCalled();
  });

  test("approve-with-edited-args runs the edited command", async () => {
    const approve = vi.fn(async () => ({ approve: true, args: { sessionId: "sess-1", command: "ls -a" } }));
    const { ctx: c } = ctx({ approve: approve as any });
    await tool(c, "open_session").execute({ connectionId: "c1" }); // own sess-1 first
    await tool(c, "run_command").execute({ sessionId: "sess-1", command: "ls" });
    expect(captureCommand).toHaveBeenLastCalledWith(expect.anything(), "sess-1", "ls -a", expect.anything());
  });

  test("approve-with-edited-args swapping in a non-owned sessionId is rejected post-approval (never runs)", async () => {
    const approve = vi.fn(async () => ({ approve: true, args: { sessionId: "not-owned", command: "ls" } }));
    const { ctx: c } = ctx({ approve: approve as any });
    await tool(c, "open_session").execute({ connectionId: "c1" }); // own sess-1, not "not-owned"
    const res: any = await tool(c, "run_command").execute({ sessionId: "sess-1", command: "ls" });
    expect(res.error).toMatch(/not owned|open_session/i);
    expect(captureCommand).not.toHaveBeenCalled();
  });

  test("close_session prompts, closes, and un-owns", async () => {
    const { ctx: c } = ctx();
    await tool(c, "open_session").execute({ connectionId: "c1" });
    await tool(c, "close_session").execute({ sessionId: "sess-1" });
    expect(c.api.sessions.close).toHaveBeenCalledWith("sess-1");
    const res: any = await tool(c, "run_command").execute({ sessionId: "sess-1", command: "ls" });
    expect(res.error).toMatch(/not owned|open_session/i);
  });
});
