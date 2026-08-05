import { describe, test, it, expect, vi, beforeEach } from "vitest";
import { buildTools, type AgentContext, type AgentTool } from "./registry";
import {
  MAX_PLAN_COMMAND_CHARS,
  MAX_PLAN_ID_CHARS,
  MAX_PLAN_RATIONALE_CHARS,
  MAX_PLAN_STEPS,
  type PlanStep,
} from "../state/planTokens";

vi.mock("./capture", () => ({
  captureCommand: vi.fn(async () => ({ output: "ok", exitCode: 0, timedOut: false, truncated: false, incomplete: false })),
  sendSerialCommand: vi.fn(async () => ({ output: "device", exitCode: null, timedOut: false, truncated: false, incomplete: true })),
}));
import { captureCommand, sendSerialCommand } from "./capture";

vi.mock("../state/auditSeam", () => ({ auditAgentAction: vi.fn() }));
import { auditAgentAction } from "../state/auditSeam";

function ctx(over: Partial<AgentContext> = {}): { ctx: AgentContext; approve: any } {
  let live = [{ id: "sess-1", type: "ssh", status: "connected", connectionId: "c1", connectionName: "srv" }];
  const approve = vi.fn(async () => ({ approve: true as const, scope: "c1", via: "granted" as const }));
  const api = {
    connections: { list: vi.fn(async () => [{ id: "c1", name: "srv", host: "h1" }]) },
    sessions: {
      open: vi.fn(async () => "sess-1"),
      close: vi.fn(async (id: string) => { live = live.filter((s) => s.id !== id); }),
      list: vi.fn(() => live),
    },
    terminal: { readSnapshot: vi.fn(() => "last lines") },
  } as any;
  const proposePlan = vi.fn(async () => ({ approve: false as const }));
  return { ctx: { api, approve, proposePlan, owned: new Set<string>(), ...over }, approve };
}
const toolsFor = new WeakMap<AgentContext, AgentTool[]>();
const tool = (c: AgentContext, name: string) => {
  let ts = toolsFor.get(c);
  if (!ts) {
    ts = buildTools(c);
    toolsFor.set(c, ts);
  }
  return ts.find((t) => t.name === name)!;
};
beforeEach(() => vi.clearAllMocks());

/** Typed context builder for the new tests below, so `proposePlan` (and any
 *  future `AgentContext` member) is actually typechecked — unlike `ctx()`
 *  above, whose `as any`/`as never` casts blank that out. */
function makeCtx(over: Partial<AgentContext> = {}): AgentContext {
  let live = [{ id: "sess-1", type: "ssh", status: "connected", connectionId: "conn-A", connectionName: "srv" }];
  const api = {
    connections: { list: vi.fn(async () => [{ id: "conn-A", name: "srv", host: "h1" }]) },
    sessions: {
      open: vi.fn(async () => "sess-1"),
      close: vi.fn(async (id: string) => { live = live.filter((s) => s.id !== id); }),
      list: vi.fn(() => live),
    },
    terminal: { readSnapshot: vi.fn(() => "last lines") },
  } as unknown as AgentContext["api"];
  const approve: AgentContext["approve"] = vi.fn(async () => ({
    approve: true as const,
    scope: "conn-A",
    via: "granted" as const,
  }));
  const proposePlan: AgentContext["proposePlan"] = vi.fn(async (_steps: PlanStep[]) => ({ approve: false as const }));
  return { api, approve, proposePlan, owned: new Set<string>(), ...over };
}

describe("tool registry", () => {
  test("open_session refuses an unknown connection id without raising a card", async () => {
    const c = makeCtx();
    const res: any = await buildTools(c).find((t) => t.name === "open_session")!.execute({ connectionId: "h1" });
    expect(String(res.error)).toContain("no connection with id");
    expect(res.connections).toEqual([{ id: "conn-A", name: "srv", host: "h1" }]);
    expect(c.approve).not.toHaveBeenCalled();
    expect(c.api.sessions.open).not.toHaveBeenCalled();
    expect(c.owned.size).toBe(0);
  });

  test("open_session still opens on a real id (non-vacuity partner)", async () => {
    const c = makeCtx();
    const res: any = await buildTools(c).find((t) => t.name === "open_session")!.execute({ connectionId: "conn-A" });
    expect(res).toEqual({ sessionId: "sess-1" });
    expect(c.approve).toHaveBeenCalledWith({ tool: "open_session", args: { connectionId: "conn-A" } });
    expect(c.owned.has("sess-1")).toBe(true);
  });

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

  test("run_command rejects a sessionId that is not open (never runs)", async () => {
    const { ctx: c } = ctx();
    const res: any = await tool(c, "run_command").execute({ sessionId: "not-owned", command: "rm -rf /" });
    expect(res.error).toMatch(/no such open session/i);
    expect(captureCommand).not.toHaveBeenCalled();
  });

  test("a rejected approval returns an error result and does not execute", async () => {
    const { ctx: c } = ctx({ approve: vi.fn(async () => ({ approve: false, reason: "no" })) as any });
    const res: any = await tool(c, "open_session").execute({ connectionId: "c1" });
    expect(res.error).toMatch(/rejected/i);
    expect(res.reason).toBe("no");
    expect(c.api.sessions.open).not.toHaveBeenCalled();
  });

  test("a rejected approval on run_command returns an error result and does not execute", async () => {
    const { ctx: c, approve } = ctx();
    await tool(c, "open_session").execute({ connectionId: "c1" }); // own sess-1 first
    approve.mockImplementation(async () => ({ approve: false, reason: "no" }));
    const res: any = await tool(c, "run_command").execute({ sessionId: "sess-1", command: "rm -rf /" });
    expect(res.error).toMatch(/rejected/i);
    expect(res.reason).toBe("no");
    expect(captureCommand).not.toHaveBeenCalled();
  });

  test("a rejected approval on close_session returns an error result and does not execute", async () => {
    const { ctx: c, approve } = ctx();
    await tool(c, "open_session").execute({ connectionId: "c1" }); // own sess-1 first
    approve.mockImplementation(async () => ({ approve: false, reason: "no" }));
    const res: any = await tool(c, "close_session").execute({ sessionId: "sess-1" });
    expect(res.error).toMatch(/rejected/i);
    expect(res.reason).toBe("no");
    expect(c.api.sessions.close).not.toHaveBeenCalled();
  });

  test("approve-with-edited-args runs the edited command", async () => {
    const approve = vi.fn(async () => ({ approve: true, scope: "c1", via: "prompted", args: { sessionId: "sess-1", command: "ls -a" } }));
    const { ctx: c } = ctx({ approve: approve as any });
    await tool(c, "open_session").execute({ connectionId: "c1" }); // own sess-1 first
    await tool(c, "run_command").execute({ sessionId: "sess-1", command: "ls" });
    expect(captureCommand).toHaveBeenLastCalledWith(expect.anything(), "sess-1", "ls -a", expect.anything());
  });

  test("approve-with-edited-args swapping in a sessionId that is not open is rejected post-approval (never runs)", async () => {
    const approve = vi.fn(async () => ({ approve: true, scope: "c1", via: "prompted", args: { sessionId: "not-owned", command: "ls" } }));
    const { ctx: c } = ctx({ approve: approve as any });
    await tool(c, "open_session").execute({ connectionId: "c1" }); // own sess-1, not "not-owned"
    const res: any = await tool(c, "run_command").execute({ sessionId: "sess-1", command: "ls" });
    expect(res.error).toMatch(/no such open session/i);
    expect(captureCommand).not.toHaveBeenCalled();
  });

  test("a session owned via one buildTools() call stays owned by a second, separately built tool set sharing ctx.owned (conversation lifetime across turns)", async () => {
    const { ctx: c } = ctx();
    const turn1 = buildTools(c);
    const openSession = turn1.find((t) => t.name === "open_session")!;
    const opened: any = await openSession.execute({ connectionId: "c1" });
    expect(opened.sessionId).toBe("sess-1");

    const turn2 = buildTools(c);
    const runCommand = turn2.find((t) => t.name === "run_command")!;
    const res: any = await runCommand.execute({ sessionId: "sess-1", command: "ls" });
    expect(res.exitCode).toBe(0);
    expect(captureCommand).toHaveBeenCalled();
  });

  test("close_session prompts, closes, and un-owns", async () => {
    const { ctx: c } = ctx();
    await tool(c, "open_session").execute({ connectionId: "c1" });
    await tool(c, "close_session").execute({ sessionId: "sess-1" });
    expect(c.api.sessions.close).toHaveBeenCalledWith("sess-1");
    expect(c.owned.has("sess-1")).toBe(false);
    // The closed session is gone from the host, so a later run is refused for
    // that reason — un-owning alone no longer refuses one, since run_command
    // may act in sessions the user opened.
    const res: any = await tool(c, "run_command").execute({ sessionId: "sess-1", command: "ls" });
    expect(res.error).toMatch(/no such open session/i);
  });

  test("run_command runs in a live session the agent does not own (the user's own terminal)", async () => {
    const { ctx: c, approve } = ctx();
    expect(c.owned.has("sess-1")).toBe(false);
    const res: any = await tool(c, "run_command").execute({ sessionId: "sess-1", command: "ls" });
    expect(approve).toHaveBeenCalled();
    expect(res.exitCode).toBe(0);
    expect(captureCommand).toHaveBeenCalled();
  });

  test("close_session hard-rejects a non-owned session (never closes, never prompts)", async () => {
    const { ctx: c, approve } = ctx();
    const res: any = await tool(c, "close_session").execute({ sessionId: "not-owned" });
    expect(res.error).toMatch(/not owned|open_session/i);
    expect(c.api.sessions.close).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });

  test("approve-with-edited-args swapping in a non-owned sessionId is rejected post-approval on close_session (never closes)", async () => {
    const approve = vi.fn(async () => ({ approve: true, scope: "c1", via: "prompted", args: { sessionId: "not-owned" } }));
    const { ctx: c } = ctx({ approve: approve as any });
    await tool(c, "open_session").execute({ connectionId: "c1" }); // own sess-1, not "not-owned"
    const res: any = await tool(c, "close_session").execute({ sessionId: "sess-1" });
    expect(res.error).toMatch(/not owned|open_session/i);
    expect(c.api.sessions.close).not.toHaveBeenCalled();
  });
});

describe("propose_plan", () => {
  const toolNamed = (ctx: AgentContext, name: string) =>
    buildTools(ctx).find((x) => x.name === name)!;

  it("assigns step ids client-side rather than trusting the model", async () => {
    const proposePlan = vi.fn(async (_steps: PlanStep[]) => ({ approve: false as const }));
    const ctx = makeCtx({ proposePlan });
    await toolNamed(ctx, "propose_plan").execute({
      // A model trying to collide ids so one step's execution ticks another's row.
      steps: [
        { tool: "run_command", connectionId: "conn-A", command: "df -h", rationale: "r", id: "x" },
        { tool: "run_command", connectionId: "conn-A", command: "uptime", rationale: "r", id: "x" },
      ],
    });
    expect(proposePlan.mock.calls[0][0].map((s) => s.id)).toEqual(["step-1", "step-2"]);
  });

  it("returns the FINAL edited steps to the model, not the proposed ones", async () => {
    const ctx = makeCtx({
      proposePlan: vi.fn(async (_steps: PlanStep[]) => ({
        approve: "run" as const,
        steps: [{ id: "step-1", tool: "run_command" as const, connectionId: "conn-A", command: "df -h /", rationale: "r" }],
      })),
    });
    const result = await toolNamed(ctx, "propose_plan").execute({
      steps: [{ tool: "run_command", connectionId: "conn-A", command: "df -h", rationale: "r" }],
    });
    // Echoing the PROPOSED text would make the edited step miss its token and
    // raise a card, defeating the edit.
    expect(result).toMatchObject({ approved: true, preAuthorized: true });
    expect((result as { steps: { command: string }[] }).steps[0].command).toBe("df -h /");
  });

  // Non-vacuity partner for the "run" case above: "ask" must report
  // `preAuthorized: false`, or the model would narrate steps as pre-approved
  // when the user will in fact be asked before every single one.
  it("reports preAuthorized: false for an 'ask' verdict", async () => {
    const ctx = makeCtx({
      proposePlan: vi.fn(async (_steps: PlanStep[]) => ({
        approve: "ask" as const,
        steps: [{ id: "step-1", tool: "run_command" as const, connectionId: "conn-A", command: "df -h", rationale: "r" }],
      })),
    });
    const result = await toolNamed(ctx, "propose_plan").execute({
      steps: [{ tool: "run_command", connectionId: "conn-A", command: "df -h", rationale: "r" }],
    });
    expect(result).toMatchObject({ approved: true, preAuthorized: false });
  });

  it("reports a rejection without throwing", async () => {
    const ctx = makeCtx({ proposePlan: vi.fn(async () => ({ approve: false as const, reason: "nope" })) });
    await expect(toolNamed(ctx, "propose_plan").execute({
      steps: [{ tool: "run_command", connectionId: "conn-A", command: "df -h", rationale: "r" }],
    })).resolves.toMatchObject({ approved: false, reason: "nope" });
  });

  it("is auto-risk and never calls the approval gate", async () => {
    const approve = vi.fn(async () => ({ approve: true as const, scope: "conn-A", via: "prompted" as const }));
    const ctx = makeCtx({ approve, proposePlan: vi.fn(async () => ({ approve: false as const })) });
    expect(toolNamed(ctx, "propose_plan").risk).toBe("auto");
    await toolNamed(ctx, "propose_plan").execute({
      steps: [{ tool: "run_command", connectionId: "conn-A", command: "df -h", rationale: "r" }],
    });
    expect(approve).not.toHaveBeenCalled();
  });

  it("rejects the whole plan when any step names an unknown connection", async () => {
    const c = makeCtx();
    const t = buildTools(c).find((x) => x.name === "propose_plan")!;
    const res: any = await t.execute({
      steps: [
        { tool: "run_command", connectionId: "conn-A", command: "df -h", rationale: "r" },
        { tool: "run_command", connectionId: "h1", command: "uptime", rationale: "r" },
      ],
    });
    expect(c.proposePlan).not.toHaveBeenCalled();
    expect(res.unknownConnectionIds).toEqual(["h1"]);
    expect(String(res.error)).toContain("plan not shown to the user");
  });

  it("still parks a checklist when every step names a real connection (non-vacuity partner)", async () => {
    const proposePlan = vi.fn(async (steps: PlanStep[]) => ({ approve: "run" as const, steps }));
    const c = makeCtx({ proposePlan });
    const t = buildTools(c).find((x) => x.name === "propose_plan")!;
    const res: any = await t.execute({
      steps: [{ tool: "run_command", connectionId: "conn-A", command: "df -h", rationale: "r" }],
    });
    expect(proposePlan).toHaveBeenCalledTimes(1);
    expect(res.approved).toBe(true);
    expect(res.preAuthorized).toBe(true);
  });
});

describe("session audit carries the approval classifier", () => {
  it("records how open_session was authorized", async () => {
    const ctx = makeCtx({
      approve: vi.fn(async () => ({ approve: true as const, scope: "conn-A", via: "plan" as const })),
    });
    await buildTools(ctx).find((x) => x.name === "open_session")!.execute({ connectionId: "conn-A" });
    expect(auditAgentAction).toHaveBeenCalledWith(
      "conn-A", "agent.session_opened", { tool: "open_session", approval: "plan" },
    );
  });

  it("records a plan-authorized command_run as approval:plan", async () => {
    const ctx = makeCtx({
      approve: vi.fn(async () => ({ approve: true as const, scope: "conn-A", via: "plan" as const })),
      owned: new Set(["sess-1"]),
    });
    await buildTools(ctx).find((x) => x.name === "run_command")!
      .execute({ sessionId: "sess-1", command: "df -h" });
    expect(auditAgentAction).toHaveBeenCalledWith(
      "conn-A",
      "agent.command_run",
      { tool: "run_command", approval: "plan", sessionType: "ssh", agentOwned: true },
      { command: "df -h" },
    );
  });
});

describe("ownership is checked upstream of any authorization", () => {
  // 3e widens reachability: a plan can pre-authorize run_command, so the
  // guarantee that NO approval mechanism can reach past ctx.owned needs its
  // own pin rather than resting on the approval path being the only caller.
  it("refuses a session that is not open without ever consulting the approval port", async () => {
    const approve = vi.fn(async () => ({ approve: true as const, scope: "conn-A", via: "plan" as const }));
    const ctx = makeCtx({ approve, owned: new Set<string>() });
    await expect(
      buildTools(ctx).find((x) => x.name === "run_command")!
        .execute({ sessionId: "sess-ghost", command: "df -h" }),
    ).resolves.toMatchObject({ error: expect.stringContaining("no such open session") });
    expect(approve).not.toHaveBeenCalled();
  });

  it("refuses close_session on an unowned session the same way", async () => {
    const approve = vi.fn(async () => ({ approve: true as const, scope: "conn-A", via: "plan" as const }));
    const ctx = makeCtx({ approve, owned: new Set<string>() });
    await expect(
      buildTools(ctx).find((x) => x.name === "close_session")!.execute({ sessionId: "sess-ghost" }),
    ).resolves.toMatchObject({ error: expect.stringContaining("not owned") });
    expect(approve).not.toHaveBeenCalled();
  });
});

// `execute` does not itself run `propose_plan`'s zod schema — it trusts its
// `raw` argument. The schema is only enforced by the AI SDK adapter, which
// parses model input against `tool.schema` and calls `execute` with the
// parsed value ONLY on success (verified end-to-end in the task-5 review).
// So these tests pin the schema directly via `tool.schema.safeParse`, and
// express "never reaches ctx.proposePlan" the same way the SDK does: a
// failed parse means `execute` (and therefore `proposePlan`) is never
// invoked at all.
describe("propose_plan schema", () => {
  const schemaOf = (c: AgentContext) => buildTools(c).find((x) => x.name === "propose_plan")!.schema;

  const validStep = (over: Record<string, unknown> = {}) => ({
    tool: "run_command",
    connectionId: "conn-A",
    command: "df -h",
    rationale: "r",
    ...over,
  });

  it("rejects 21 steps (over MAX_PLAN_STEPS) without reaching proposePlan", () => {
    const proposePlan = vi.fn(async () => ({ approve: false as const }));
    const ctx = makeCtx({ proposePlan });
    const steps = Array.from({ length: MAX_PLAN_STEPS + 1 }, () => validStep());
    const result = schemaOf(ctx).safeParse({ steps });
    expect(result.success).toBe(false);
    expect(proposePlan).not.toHaveBeenCalled();
  });

  it("accepts exactly MAX_PLAN_STEPS steps (non-vacuity partner)", () => {
    const ctx = makeCtx();
    const steps = Array.from({ length: MAX_PLAN_STEPS }, () => validStep());
    expect(schemaOf(ctx).safeParse({ steps }).success).toBe(true);
  });

  it("rejects a command of MAX_PLAN_COMMAND_CHARS + 1 without reaching proposePlan", () => {
    const proposePlan = vi.fn(async () => ({ approve: false as const }));
    const ctx = makeCtx({ proposePlan });
    const steps = [validStep({ command: "x".repeat(MAX_PLAN_COMMAND_CHARS + 1) })];
    const result = schemaOf(ctx).safeParse({ steps });
    expect(result.success).toBe(false);
    expect(proposePlan).not.toHaveBeenCalled();
  });

  it("accepts a command of exactly MAX_PLAN_COMMAND_CHARS (non-vacuity partner)", () => {
    const ctx = makeCtx();
    const steps = [validStep({ command: "x".repeat(MAX_PLAN_COMMAND_CHARS) })];
    expect(schemaOf(ctx).safeParse({ steps }).success).toBe(true);
  });

  it("rejects a rationale of MAX_PLAN_RATIONALE_CHARS + 1 without reaching proposePlan", () => {
    const proposePlan = vi.fn(async () => ({ approve: false as const }));
    const ctx = makeCtx({ proposePlan });
    const steps = [validStep({ rationale: "x".repeat(MAX_PLAN_RATIONALE_CHARS + 1) })];
    const result = schemaOf(ctx).safeParse({ steps });
    expect(result.success).toBe(false);
    expect(proposePlan).not.toHaveBeenCalled();
  });

  it("rejects an empty connectionId without reaching proposePlan", () => {
    const proposePlan = vi.fn(async () => ({ approve: false as const }));
    const ctx = makeCtx({ proposePlan });
    const steps = [validStep({ connectionId: "" })];
    const result = schemaOf(ctx).safeParse({ steps });
    expect(result.success).toBe(false);
    expect(proposePlan).not.toHaveBeenCalled();
  });

  it("rejects a connectionId of MAX_PLAN_ID_CHARS + 1 without reaching proposePlan", () => {
    const proposePlan = vi.fn(async () => ({ approve: false as const }));
    const ctx = makeCtx({ proposePlan });
    const steps = [validStep({ connectionId: "x".repeat(MAX_PLAN_ID_CHARS + 1) })];
    const result = schemaOf(ctx).safeParse({ steps });
    expect(result.success).toBe(false);
    expect(proposePlan).not.toHaveBeenCalled();
  });

  it("accepts a connectionId of exactly MAX_PLAN_ID_CHARS (non-vacuity partner)", () => {
    const ctx = makeCtx();
    const steps = [validStep({ connectionId: "x".repeat(MAX_PLAN_ID_CHARS) })];
    expect(schemaOf(ctx).safeParse({ steps }).success).toBe(true);
  });

  it("rejects zero steps without reaching proposePlan", () => {
    const proposePlan = vi.fn(async () => ({ approve: false as const }));
    const ctx = makeCtx({ proposePlan });
    const result = schemaOf(ctx).safeParse({ steps: [] });
    expect(result.success).toBe(false);
    expect(proposePlan).not.toHaveBeenCalled();
  });

  it("rejects a tool value outside the enum without reaching proposePlan", () => {
    const proposePlan = vi.fn(async () => ({ approve: false as const }));
    const ctx = makeCtx({ proposePlan });
    const steps = [validStep({ tool: "delete_everything" })];
    const result = schemaOf(ctx).safeParse({ steps });
    expect(result.success).toBe(false);
    expect(proposePlan).not.toHaveBeenCalled();
  });
});

describe("session-type routing", () => {
  function serialCtx(): AgentContext {
    const live = [
      { id: "ser-1", type: "serial", status: "connected", connectionId: "conn-S", connectionName: "dev" },
      { id: "ssh-1", type: "ssh", status: "connected", connectionId: "conn-A", connectionName: "srv" },
      { id: "loc-1", type: "local", status: "connected", connectionId: "local", connectionName: "bash" },
    ];
    return {
      api: {
        connections: { list: vi.fn(async () => [{ id: "conn-A", name: "srv", host: "h1" }]) },
        sessions: { open: vi.fn(), close: vi.fn(), list: vi.fn(() => live) },
        terminal: { readSnapshot: vi.fn(() => "") },
      } as unknown as AgentContext["api"],
      approve: vi.fn(async () => ({ approve: true as const, scope: "conn-S", via: "prompted" as const })),
      proposePlan: vi.fn(async () => ({ approve: false as const })),
      owned: new Set<string>(),
    };
  }

  test("list_sessions exposes the user's local and serial sessions, not just agent-owned ones", async () => {
    const c = serialCtx();
    const res = (await buildTools(c).find((t) => t.name === "list_sessions")!.execute({})) as Array<{
      id: string; type: string; agentOwned: boolean;
    }>;
    expect(res.map((s) => s.type).sort()).toEqual(["local", "serial", "ssh"]);
    expect(res.every((s) => s.agentOwned === false)).toBe(true);
  });

  test("run_command sends verbatim on a serial session — no shell markers reach the device", async () => {
    const c = serialCtx();
    await buildTools(c).find((t) => t.name === "run_command")!.execute({ sessionId: "ser-1", command: "AT" });
    expect(sendSerialCommand).toHaveBeenCalledWith(expect.anything(), "ser-1", "AT", expect.anything());
    expect(captureCommand).not.toHaveBeenCalled();
  });

  test("run_command uses marker capture on a local shell", async () => {
    const c = serialCtx();
    await buildTools(c).find((t) => t.name === "run_command")!.execute({ sessionId: "loc-1", command: "ls" });
    expect(captureCommand).toHaveBeenCalledWith(expect.anything(), "loc-1", "ls", expect.anything());
    expect(sendSerialCommand).not.toHaveBeenCalled();
  });
});

describe("file tools", () => {
  function fileCtx(over: Partial<AgentContext> = {}): AgentContext {
    const sftp = {
      list: vi.fn(async () => [{ name: "a.txt", path: "/srv/a.txt", size: 3, isDir: false, isSymlink: false, modified: 1 }]),
      stat: vi.fn(async () => ({ name: "a.txt", path: "/srv/a.txt", size: 3, isDir: false, isSymlink: false, modified: 1 })),
      readText: vi.fn(async () => "hello"),
      writeText: vi.fn(async () => {}),
      mkdir: vi.fn(async () => {}),
      rename: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      transfer: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
    };
    return {
      api: {
        sftp,
        connections: { list: vi.fn(async () => [{ id: "conn-A", name: "srv", host: "h1" }]) },
        sessions: { open: vi.fn(), close: vi.fn(), list: vi.fn(() => []) },
        terminal: { readSnapshot: vi.fn(() => "") },
      } as unknown as AgentContext["api"],
      approve: vi.fn(async () => ({ approve: true as const, scope: "conn-A", via: "prompted" as const })),
      proposePlan: vi.fn(async () => ({ approve: false as const })),
      owned: new Set<string>(),
      ...over,
    };
  }
  const t = (c: AgentContext, n: string) => buildTools(c).find((x) => x.name === n)!;
  const sftpOf = (c: AgentContext) => (c.api as unknown as { sftp: Record<string, ReturnType<typeof vi.fn>> }).sftp;

  test("read tools are auto-risk and never consult the approval port", async () => {
    const c = fileCtx();
    for (const name of ["list_files", "stat_file", "read_file"]) {
      expect(t(c, name).risk).toBe("auto");
    }
    await t(c, "list_files").execute({ target: "conn-A", path: "/srv" });
    expect(c.approve).not.toHaveBeenCalled();
  });

  test.each(["make_dir", "write_file", "rename_path", "delete_path", "transfer_file"])(
    "%s is prompt-risk", (name) => {
      expect(t(fileCtx(), name).risk).toBe("prompt");
    },
  );

  test("delete_path runs only after approval, and records the operation", async () => {
    const c = fileCtx();
    await t(c, "delete_path").execute({ target: "conn-A", path: "/srv/a.txt" });
    expect(c.approve).toHaveBeenCalledWith({ tool: "delete_path", args: { target: "conn-A", path: "/srv/a.txt" } });
    expect(sftpOf(c).delete).toHaveBeenCalledWith("conn-A", "/srv/a.txt");
    expect(auditAgentAction).toHaveBeenCalledWith(
      "conn-A", "agent.command_run",
      { tool: "delete_path", approval: "prompted" },
      expect.objectContaining({ args: expect.stringContaining("/srv/a.txt") }),
    );
  });

  test("a rejected delete never reaches the filesystem", async () => {
    const c = fileCtx({ approve: vi.fn(async () => ({ approve: false as const, reason: "no" })) });
    const res = await t(c, "delete_path").execute({ target: "conn-A", path: "/srv/a.txt" });
    expect(res).toMatchObject({ error: "rejected by user" });
    expect(sftpOf(c).delete).not.toHaveBeenCalled();
    expect(auditAgentAction).not.toHaveBeenCalled();
  });

  test("transfer_file passes both endpoints straight through", async () => {
    const c = fileCtx();
    await t(c, "transfer_file").execute({
      fromTarget: "conn-A", fromPath: "/srv/a.txt", toTarget: "local", toPath: "/home/u/a.txt",
    });
    expect(sftpOf(c).transfer).toHaveBeenCalledWith(
      { target: "conn-A", path: "/srv/a.txt" },
      { target: "local", path: "/home/u/a.txt" },
    );
  });

  test("a failing operation returns an error result rather than throwing out of the tool", async () => {
    const c = fileCtx();
    sftpOf(c).mkdir.mockRejectedValueOnce(new Error("permission denied"));
    await expect(t(c, "make_dir").execute({ target: "conn-A", path: "/srv/x" }))
      .resolves.toMatchObject({ error: "permission denied" });
  });
});
