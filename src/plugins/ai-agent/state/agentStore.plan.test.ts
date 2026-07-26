import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _currentRunGeneration,
  _resetPlanBatch,
  _setDeps,
  consumePlanToken,
  initAgent,
  planActive,
  shutdownAgent,
  useAgentStore,
} from "./agentStore";
import type { PlanStep } from "./planTokens";

// sendMessage calls createProvider only after the planBatch clear this file
// pins, so a rejecting stub is enough to drive the real function into its
// catch branch without needing the full model/streaming mocking that
// agentStore.test.ts sets up — nothing here exercises the model at all.
vi.mock("../provider/factory", () => ({
  createProvider: vi.fn(async () => {
    throw new Error("no model needed — the invariant this pins runs before createProvider is reached");
  }),
}));

const step = (command: string, id = "s1"): PlanStep => ({
  id, tool: "run_command", connectionId: "conn-A", command, rationale: "why",
});
const entryFor = (key: string) =>
  ({ scope: "conn-A", tool: "run_command", grain: "exact", key }) as const;
// tsconfig targets ES2021 (no Array.prototype.at); matches persistence.test.ts's convention.
const last = <T>(arr: T[]): T => arr[arr.length - 1];

// Same shape as agentStore.test.ts's local fakeApi — kept separate rather than
// shared, since that file doesn't export it.
function fakeApi(store: Record<string, unknown> = {}) {
  return {
    storage: {
      get: async (k: string) => (k in store ? store[k] : null),
      set: async (k: string, v: unknown) => { store[k] = v; },
      delete: async () => {},
    },
    keychain: { get: async () => null, set: async () => {}, delete: async () => {} },
    sessions: { list: () => [] },
    connections: { list: async () => [] },
  } as never;
}

beforeEach(() => {
  _resetPlanBatch();
  useAgentStore.setState({ transcript: [], pendingPlan: null, planBatch: null });
});

describe("proposePlan", () => {
  it("appends a pending plan transcript entry and parks a promise", async () => {
    const gen = _currentRunGeneration();
    const pending = useAgentStore.getState().proposePlan([step("df -h")], gen);
    const entry = last(useAgentStore.getState().transcript);
    expect(entry).toMatchObject({ kind: "plan", outcome: "pending" });
    expect(useAgentStore.getState().pendingPlan).not.toBeNull();

    const planId = useAgentStore.getState().pendingPlan!.planId;
    useAgentStore.getState().resolvePlan(planId, { approve: false, reason: "no" });
    await expect(pending).resolves.toEqual({ approve: false, reason: "no" });
  });

  it("refuses a second plan while one is awaiting review", async () => {
    const gen = _currentRunGeneration();
    void useAgentStore.getState().proposePlan([step("df -h")], gen);
    await expect(useAgentStore.getState().proposePlan([step("uptime")], gen))
      .resolves.toMatchObject({ approve: false });
  });
});

describe("resolvePlan", () => {
  const propose = () => {
    const gen = _currentRunGeneration();
    const p = useAgentStore.getState().proposePlan([step("df -h")], gen);
    return { promise: p, planId: useAgentStore.getState().pendingPlan!.planId };
  };

  it("Approve & run mints a token and marks the entry approved_run", async () => {
    const { promise, planId } = propose();
    useAgentStore.getState().resolvePlan(planId, { approve: "run", steps: [step("df -h")] });
    await promise;
    expect(planActive()).toBe(true);
    expect(consumePlanToken(entryFor("df -h"))).toBe(true);
    expect(consumePlanToken(entryFor("df -h"))).toBe(false);
    const entry = last(useAgentStore.getState().transcript) as { outcome: string; steps: { status: string }[] };
    expect(entry.outcome).toBe("approved_run");
    expect(entry.steps[0].status).toBe("dispatched");
  });

  it("Approve plan creates an EMPTY batch, not no batch", async () => {
    // The batch is what lifts the plan-mode refusal. With no batch at all this
    // button would approve a plan that then refuses every one of its steps.
    const { promise, planId } = propose();
    useAgentStore.getState().resolvePlan(planId, { approve: "ask", steps: [step("df -h")] });
    await promise;
    expect(planActive()).toBe(true);
    expect(consumePlanToken(entryFor("df -h"))).toBe(false);
    expect(last(useAgentStore.getState().transcript)).toMatchObject({ outcome: "approved_ask" });
  });

  it("mints from the EDITED steps, not the proposed ones", async () => {
    const { promise, planId } = propose();
    useAgentStore.getState().resolvePlan(planId, { approve: "run", steps: [step("df -h /")] });
    await promise;
    expect(consumePlanToken(entryFor("df -h"))).toBe(false);
    expect(consumePlanToken(entryFor("df -h /"))).toBe(true);
  });

  it("mints nothing for a removed step", async () => {
    const gen = _currentRunGeneration();
    const p = useAgentStore.getState().proposePlan([step("df -h", "s1"), step("uptime", "s2")], gen);
    const planId = useAgentStore.getState().pendingPlan!.planId;
    useAgentStore.getState().resolvePlan(planId, { approve: "run", steps: [step("df -h", "s1")] });
    await p;
    expect(consumePlanToken(entryFor("uptime"))).toBe(false);
  });

  it("ignores a verdict for a plan that is no longer pending", () => {
    const { planId } = propose();
    useAgentStore.getState().resolvePlan(planId, { approve: false });
    useAgentStore.getState().resolvePlan(planId, { approve: "run", steps: [step("df -h")] });
    expect(planActive()).toBe(false);
  });

  it("mints a batch inert to the live generation when the proposing run was superseded before its plan lands", async () => {
    // A run dispatches propose_plan, carrying its own generation. Before that
    // tool call lands, the user sends another message: runGeneration bumps
    // (nothing was parked yet, so nothing is reaped). The superseded run's
    // propose_plan then lands anyway and parks a plan under its now-stale
    // generation — this is proposePlan's own contract (it takes an explicit
    // `generation` argument rather than reading the live one). If resolvePlan
    // minted against the live generation instead of the proposing one, the
    // new run would inherit tokens the user approved for a plan it never
    // proposed.
    const staleGen = _currentRunGeneration();
    await useAgentStore.getState().newConversation();
    expect(_currentRunGeneration()).not.toBe(staleGen);

    const p = useAgentStore.getState().proposePlan([step("df -h")], staleGen);
    const planId = useAgentStore.getState().pendingPlan!.planId;
    useAgentStore.getState().resolvePlan(planId, { approve: "run", steps: [step("df -h")] });
    await p;

    expect(planActive()).toBe(false);
    expect(consumePlanToken(entryFor("df -h"))).toBe(false);
  });
});

describe("lifecycle", () => {
  it("a batch minted under an older generation is inert", async () => {
    const gen = _currentRunGeneration();
    const p = useAgentStore.getState().proposePlan([step("df -h")], gen);
    const planId = useAgentStore.getState().pendingPlan!.planId;
    useAgentStore.getState().resolvePlan(planId, { approve: "run", steps: [step("df -h")] });
    await p;
    expect(planActive()).toBe(true);

    // newConversation bumps runGeneration; the batch's generation cannot follow.
    await useAgentStore.getState().newConversation();
    expect(planActive()).toBe(false);
    expect(consumePlanToken(entryFor("df -h"))).toBe(false);
  });

  it("refuses a token from a batch whose generation is not current", () => {
    // Seeds a stale batch directly via setState, bypassing every lifecycle
    // clear, to pin the generation comparison itself rather than the
    // belt-and-braces `planBatch: null` writes that run alongside it.
    const gen = _currentRunGeneration();
    useAgentStore.setState({
      planBatch: { generation: gen - 1, planId: "plan-stale", tokens: [{ stepId: "s1", entry: entryFor("df -h"), used: false }] },
    });
    expect(planActive()).toBe(false);
    expect(consumePlanToken(entryFor("df -h"))).toBe(false);
  });

  it("honours a token from a batch whose generation IS current", () => {
    // Non-vacuity partner: without this, the test above would pass even if
    // consumePlanToken were broken outright.
    const gen = _currentRunGeneration();
    useAgentStore.setState({
      planBatch: { generation: gen, planId: "plan-live", tokens: [{ stepId: "s1", entry: entryFor("df -h"), used: false }] },
    });
    expect(planActive()).toBe(true);
    expect(consumePlanToken(entryFor("df -h"))).toBe(true);
  });

  it("_rejectAllPending resolves a parked plan and marks it abandoned", async () => {
    const gen = _currentRunGeneration();
    const p = useAgentStore.getState().proposePlan([step("df -h")], gen);
    useAgentStore.getState()._rejectAllPending("superseded");
    await expect(p).resolves.toMatchObject({ approve: false, reason: "superseded" });
    expect(useAgentStore.getState().pendingPlan).toBeNull();
    expect(last(useAgentStore.getState().transcript)).toMatchObject({ outcome: "abandoned" });
  });

  it("stop() clears the batch", async () => {
    const gen = _currentRunGeneration();
    const p = useAgentStore.getState().proposePlan([step("df -h")], gen);
    const planId = useAgentStore.getState().pendingPlan!.planId;
    useAgentStore.getState().resolvePlan(planId, { approve: "run", steps: [step("df -h")] });
    await p;
    useAgentStore.getState().stop();
    expect(planActive()).toBe(false);
  });

  // Placed last in this describe: like the stop() test above, shutdownAgent
  // stamps abortedGeneration without bumping runGeneration, so a later test
  // that treats "the current generation" as live would be poisoned by it.
  it("shutdownAgent revokes a live batch via the generation guard, not merely its own clear", () => {
    // Seeded directly via setState, bypassing shutdownAgent's own
    // `planBatch: null` write, so this pins isGenerationDead's abort clause
    // rather than the belt-and-braces clear alongside it. shutdownAgent never
    // bumps runGeneration, only stamps abortedGeneration, so this is the one
    // lifecycle site where deleting the explicit clear would otherwise leave
    // a spendable token behind a torn-down PluginAPI.
    const gen = _currentRunGeneration();
    useAgentStore.setState({
      planBatch: { generation: gen, planId: "plan-live", tokens: [{ stepId: "s1", entry: entryFor("df -h"), used: false }] },
    });
    shutdownAgent();
    expect(consumePlanToken(entryFor("df -h"))).toBe(false);
  });
});

describe("_setPlanStepStatus", () => {
  it("updates one step in place", async () => {
    const gen = _currentRunGeneration();
    const p = useAgentStore.getState().proposePlan([step("df -h", "s1")], gen);
    const planId = useAgentStore.getState().pendingPlan!.planId;
    useAgentStore.getState()._setPlanStepStatus(planId, "s1", "dispatched");
    const entry = last(useAgentStore.getState().transcript) as { steps: { status: string }[] };
    expect(entry.steps[0].status).toBe("dispatched");
    useAgentStore.getState().resolvePlan(planId, { approve: false });
    await p;
  });
});

describe("planCounter — restored transcript", () => {
  it("advances past a restored plan-N id so a live plan cannot collide with a historical one", async () => {
    // planCounter is a module global shared by every test in this file, so
    // pin the exact id the restored entry must carry by probing what
    // nextPlanId() would hand out right now, rather than a hardcoded
    // "plan-3" — a hardcoded low number would make this test pass even with
    // the seeding removed, since earlier tests in this file have already
    // advanced planCounter well past it. Using probeCounter+1 guarantees a
    // real collision if planCounter is NOT seeded from the restored entry.
    const probeGen = _currentRunGeneration();
    const probeP = useAgentStore.getState().proposePlan([step("probe")], probeGen);
    const probeId = useAgentStore.getState().pendingPlan!.planId;
    useAgentStore.getState().resolvePlan(probeId, { approve: false });
    await probeP;
    const collidingId = `plan-${Number(probeId.slice("plan-".length)) + 1}`;

    // planCounter is a fresh module global every process; this restored
    // entry keeps the persisted id it was minted with. Without seeding
    // planCounter from it, nextPlanId() would hand out `collidingId` again,
    // and every planId-keyed mutator (_setPlanSteps/_setPlanOutcome/
    // _setPlanStepStatus) would then rewrite this historical entry in place
    // of the new plan.
    const historical = {
      kind: "plan" as const,
      planId: collidingId,
      outcome: "abandoned" as const,
      steps: [{ id: "old-1", tool: "run_command" as const, connectionId: "conn-A", command: "OLD", rationale: "why", status: "skipped" as const }],
    };
    await initAgent(fakeApi({ conversation: { v: 1, transcript: [historical], messages: [] } }));

    const gen = _currentRunGeneration();
    const p = useAgentStore.getState().proposePlan([step("df -h")], gen);
    const newPlanId = useAgentStore.getState().pendingPlan!.planId;
    useAgentStore.getState().resolvePlan(newPlanId, { approve: "run", steps: [step("df -h")] });
    await p;

    expect(newPlanId).not.toBe(collidingId);
    const entries = useAgentStore.getState().transcript;
    const restoredEntry = entries.find((e) => e.kind === "plan" && e.planId === collidingId);
    expect(restoredEntry).toEqual(historical);
    const liveEntry = entries.find((e) => e.kind === "plan" && e.planId === newPlanId);
    expect(liveEntry).toMatchObject({ outcome: "approved_run" });
  });
});

describe("invariant: planBatch !== null agrees with planActive() after every lifecycle transition", () => {
  // ModeChip trusts `planBatch !== null` as a proxy for planActive() (the
  // gate's real authority check). isGenerationDead already makes planActive()
  // false the instant a transition moves the generation/abort latch, with or
  // without the belt-and-braces `planBatch: null` clear — so a bare
  // `expect(planActive()).toBe(false)` after a transition would NOT catch a
  // missing clear (stop() proves this: it never bumps runGeneration, only
  // stamps abortedGeneration, which alone already kills planActive()). Only
  // asserting `planBatch` itself is null closes that gap. This is one test,
  // not five, and the five transitions live in one array: a per-transition
  // `it()` for each site is exactly the pattern that lets a sixth site added
  // later (a new lifecycle action that should also clear planBatch) go
  // untested because nothing forces it into this list.
  const fakeProfiles = () => ({
    list: async () => [{ id: "p1", providerKind: "anthropic" as const, label: "A", model: "claude-x" }],
    getActiveId: async () => "p1",
    getKey: async () => "sk-test",
  } as never);

  // Advances to a fresh, unaborted generation first — stop() and
  // shutdownAgent() (both already-run transitions by the time later
  // iterations seed) stamp `abortedGeneration` to the CURRENT generation
  // without bumping it, so minting a new batch against that same current
  // generation would be born dead before the transition under test even
  // runs. newConversation() bumps the generation unconditionally, which is
  // the same "abort latch reset" every real next-turn action performs, so
  // this mirrors how a live session actually reaches a fresh generation.
  // Then mints a fresh live batch, so each iteration starts from
  // "planActive() is true, planBatch matches" before applying the next
  // transition.
  const seedLiveBatch = async () => {
    await useAgentStore.getState().newConversation();
    const gen = _currentRunGeneration();
    const p = useAgentStore.getState().proposePlan([step("df -h")], gen);
    const planId = useAgentStore.getState().pendingPlan!.planId;
    useAgentStore.getState().resolvePlan(planId, { approve: "run", steps: [step("df -h")] });
    await p;
    expect(planActive()).toBe(true);
    expect(useAgentStore.getState().planBatch).not.toBeNull();
  };

  // sendMessage needs provider deps to run at all; a rejecting createProvider
  // stub (mocked at module scope above) is enough to drive the REAL function
  // through its real planBatch-clearing lines without pulling in the
  // model/streaming mocks agentStore.test.ts uses — this is real execution of
  // sendMessage's source, not a construction-only stand-in for it.
  const transitions: Array<[string, () => void | Promise<unknown>]> = [
    ["stop", () => useAgentStore.getState().stop()],
    ["newConversation", () => useAgentStore.getState().newConversation()],
    ["initAgent", () => initAgent(fakeApi())],
    ["shutdownAgent", () => shutdownAgent()],
    ["sendMessage (second, ordinary follow-up turn)", async () => {
      _setDeps({ api: fakeApi(), profiles: fakeProfiles(), controller: {} as never });
      await useAgentStore.getState().sendMessage("second turn");
    }],
  ];

  it("holds after stop/newConversation/initAgent/shutdownAgent/sendMessage", async () => {
    for (const [name, run] of transitions) {
      await seedLiveBatch();
      await run();
      expect(planActive(), name).toBe(false);
      expect(useAgentStore.getState().planBatch, name).toBeNull();
    }
    _setDeps(null);
  });
});
