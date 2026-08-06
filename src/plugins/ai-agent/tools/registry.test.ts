import { describe, test, it, expect, vi } from "vitest";
import { buildTools, type AgentContext } from "./registry";
import {
  MAX_PLAN_COMMAND_CHARS,
  MAX_PLAN_ID_CHARS,
  MAX_PLAN_RATIONALE_CHARS,
  MAX_PLAN_STEPS,
  type PlanStep,
} from "../state/planTokens";

vi.mock("../state/auditSeam", () => ({ auditAgentAction: vi.fn() }));
import { auditAgentAction } from "../state/auditSeam";

/** Typed context builder, so `proposePlan` (and any future `AgentContext`
 *  member) is actually typechecked. */
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

describe("agent tool composition", () => {
  test("exposes the core verbs plus propose_plan", () => {
    const names = buildTools(makeCtx()).map((t) => t.name);
    expect(names).toHaveLength(15);
    expect(names).toContain("propose_plan");
    expect(names).toContain("run_command");
  });

  test("wires the agent's audit seam in as the core surface's audit port", async () => {
    const ctx = makeCtx();
    await buildTools(ctx).find((t) => t.name === "open_session")!.execute({ connectionId: "conn-A" });
    expect(auditAgentAction).toHaveBeenCalledWith(
      "conn-A", "agent.session_opened", { tool: "open_session", approval: "granted" },
    );
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
