import { beforeEach, describe, expect, it } from "vitest";
import {
  _currentRunGeneration,
  _resetPlanBatch,
  consumePlanToken,
  planActive,
  useAgentStore,
} from "./agentStore";
import type { PlanStep } from "./planTokens";

const step = (command: string, id = "s1"): PlanStep => ({
  id, tool: "run_command", connectionId: "conn-A", command, rationale: "why",
});
const entryFor = (key: string) =>
  ({ scope: "conn-A", tool: "run_command", grain: "exact", key }) as const;
// tsconfig targets ES2021 (no Array.prototype.at); matches persistence.test.ts's convention.
const last = <T>(arr: T[]): T => arr[arr.length - 1];

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
