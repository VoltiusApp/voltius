import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Module-level pending load callback — afterEach(cleanup) is NOT enough.
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o?.connection ? `${k}:${o.connection}` : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { useAgentStore } from "../state/agentStore";
import { PlanCard } from "./PlanCard";

const step = (over: Partial<{ id: string; command: string; status: string }> = {}) => ({
  id: "step-1", tool: "run_command" as const, connectionId: "conn-A",
  command: "df -h", rationale: "check disk", status: "pending" as const, ...over,
});

afterEach(cleanup);
beforeEach(() => useAgentStore.setState({ pendingPlan: null, transcript: [], planBatch: null }));

describe("PlanCard", () => {
  const live = (steps = [step()]) => {
    const resolve = vi.fn();
    useAgentStore.setState({ pendingPlan: { planId: "plan-1", generation: 1, steps: steps as never, resolve } });
    render(<PlanCard entry={{ planId: "plan-1", steps: steps as never, outcome: "pending" }} />);
    return resolve;
  };

  it("offers the three actions while the plan is the live pending one", () => {
    live();
    expect(screen.getByText("aiAgent.plan.approveAndRun")).toBeTruthy();
    expect(screen.getByText("aiAgent.plan.approvePlan")).toBeTruthy();
    expect(screen.getByText("aiAgent.plan.reject")).toBeTruthy();
  });

  it("renders read-only when the entry is NOT the live pending plan", () => {
    render(<PlanCard entry={{ planId: "plan-1", steps: [step({ status: "dispatched" })] as never, outcome: "approved_run" }} />);
    expect(screen.queryByText("aiAgent.plan.approveAndRun")).toBeNull();
    expect(screen.queryByText("aiAgent.plan.remove")).toBeNull();
  });

  // Distinct from the previous test: here `pendingPlan.planId` still matches
  // this entry (stale, not yet cleared), so ONLY the outcome !== "pending"
  // conjunct blocks it from rendering live. Without this test, dropping that
  // conjunct is not caught by anything in this file.
  it("renders read-only when a stale pendingPlan still shares this planId but the outcome has moved past pending", () => {
    useAgentStore.setState({ pendingPlan: { planId: "plan-1", generation: 1, steps: [], resolve: vi.fn() } });
    render(<PlanCard entry={{ planId: "plan-1", steps: [step({ status: "dispatched" })] as never, outcome: "approved_run" }} />);
    expect(screen.queryByText("aiAgent.plan.approveAndRun")).toBeNull();
    expect(screen.queryByText("aiAgent.plan.remove")).toBeNull();
  });

  it("renders read-only for a restored entry even if a DIFFERENT plan is pending", () => {
    useAgentStore.setState({ pendingPlan: { planId: "plan-2", generation: 1, steps: [], resolve: vi.fn() } });
    render(<PlanCard entry={{ planId: "plan-1", steps: [step()] as never, outcome: "abandoned" }} />);
    expect(screen.queryByText("aiAgent.plan.approveAndRun")).toBeNull();
  });

  // Distinct from the previous test: here `entry.outcome` IS "pending", so
  // ONLY the planId-match conjunct blocks it from rendering live. The
  // previous test's entry is "abandoned", which already fails the outcome
  // conjunct regardless of planId — so it cannot catch a dropped planId
  // check on its own.
  it("renders read-only when a DIFFERENT plan is pending even though this entry's own outcome is still pending", () => {
    useAgentStore.setState({ pendingPlan: { planId: "plan-2", generation: 1, steps: [], resolve: vi.fn() } });
    render(<PlanCard entry={{ planId: "plan-1", steps: [step()] as never, outcome: "pending" }} />);
    expect(screen.queryByText("aiAgent.plan.approveAndRun")).toBeNull();
  });

  it("badges a step that cannot be pre-authorized", () => {
    live([step({ command: "du -sh /var/* | sort -h" })]);
    expect(screen.getByText("aiAgent.plan.willStillAsk")).toBeTruthy();
  });

  it("does NOT badge a plain command", () => {
    live();
    expect(screen.queryByText("aiAgent.plan.willStillAsk")).toBeNull();
  });

  it("resolves with the EDITED command", () => {
    const resolve = live();
    fireEvent.click(screen.getByText("aiAgent.plan.edit"));
    fireEvent.change(screen.getByDisplayValue("df -h"), { target: { value: "df -h /" } });
    fireEvent.click(screen.getByText("aiAgent.plan.approveAndRun"));
    // Assert the verdict STRUCTURE, and that resolve was called at all — a
    // fallback to store state here would let this pass without the component
    // ever resolving the plan.
    expect(resolve).toHaveBeenCalledTimes(1);
    const verdict = resolve.mock.calls[0][0] as { approve: string; steps: { command: string }[] };
    expect(verdict.approve).toBe("run");
    expect(verdict.steps.map((s) => s.command)).toEqual(["df -h /"]);
  });

  it("strips the display-only status field from the verdict", () => {
    const resolve = live();
    fireEvent.click(screen.getByText("aiAgent.plan.approvePlan"));
    const verdict = resolve.mock.calls[0][0] as { approve: string; steps: Record<string, unknown>[] };
    expect(verdict.approve).toBe("ask");
    expect(verdict.steps[0]).not.toHaveProperty("status");
  });

  it("resolves without a removed step", () => {
    const resolve = live([step({ id: "step-1" }), step({ id: "step-2", command: "uptime" })]);
    fireEvent.click(screen.getAllByText("aiAgent.plan.remove")[1]);
    fireEvent.click(screen.getByText("aiAgent.plan.approveAndRun"));
    expect(resolve).toHaveBeenCalledTimes(1);
    const verdict = resolve.mock.calls[0][0] as { steps: { id: string }[] };
    expect(verdict.steps.map((s) => s.id)).toEqual(["step-1"]);
  });

  it("updates the badge live as the command is edited", () => {
    live();
    fireEvent.click(screen.getByText("aiAgent.plan.edit"));
    fireEvent.change(screen.getByDisplayValue("df -h"), { target: { value: "df -h | wc -l" } });
    expect(screen.getByText("aiAgent.plan.willStillAsk")).toBeTruthy();
  });
});
