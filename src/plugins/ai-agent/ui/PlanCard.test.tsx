import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Module-level pending load callback — afterEach(cleanup) is NOT enough.
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("./ObjectRefChip", () => ({ ObjectRefChip: ({ id }: { id: string }) => <b data-testid="plan-chip">{id}</b> }));
vi.mock("./useObjectRefs", () => ({
  useObjectRefs: () => ({ resolve: () => null, knownIds: new Set<string>(), loading: false }),
}));

import { useAgentStore } from "../state/agentStore";
import * as storeMod from "../state/agentStore";
import { PlanCard } from "./PlanCard";
import { installFakeI18n } from "../testing/fakeI18n";

installFakeI18n((k: string, o?: Record<string, unknown>) => (o?.connection ? `${k}:${o.connection}` : k));

const step = (over: Partial<{ id: string; command: string; status: string; connectionId: string }> = {}) => ({
  id: "step-1", tool: "run_command" as const, connectionId: "conn-A",
  command: "df -h", rationale: "check disk", status: "pending" as const, ...over,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  useAgentStore.setState({ pendingPlan: null, transcript: [], planBatch: null });
  // Default: connections never resolve, so every step's connection label
  // stays `pending` and the badge tracks `canPreAuthorize` alone — the
  // pre-existing behaviour every test below except the I1 tests relies on.
  // The two I1 tests override this per-case with a settled connections list.
  vi.spyOn(storeMod, "getAgentDeps").mockReturnValue({
    api: { connections: { subscribe: () => () => {}, list: () => new Promise(() => {}) } },
  } as never);
});

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

  // I1: a step naming a connection that doesn't resolve must badge even
  // though `canPreAuthorize` alone would say the step is fine — the token
  // `mintTokens` produces for it is inert (`deriveScope` returns null at
  // execution), so the card the badge warns about really does happen.
  it("badges a step whose connection does not resolve to a real connection", async () => {
    vi.spyOn(storeMod, "getAgentDeps").mockReturnValue({
      api: { connections: { subscribe: () => () => {}, list: () => Promise.resolve([]) } },
    } as never);
    live([step({ connectionId: "conn-HALLUCINATED" })]);
    await waitFor(() => expect(screen.getByText("aiAgent.plan.willStillAsk")).toBeTruthy());
  });

  // Non-vacuity partner: once the SAME kind of lookup resolves to a real
  // connection, the badge must not fire on that account alone.
  it("does NOT badge a step whose connection resolves to a real connection", async () => {
    const connectionsPromise = Promise.resolve([
      { id: "conn-A", name: "Test Conn", host: "h1", port: 22, username: "u", auth_type: "key", tags: [] },
    ]);
    vi.spyOn(storeMod, "getAgentDeps").mockReturnValue({
      api: { connections: { subscribe: () => () => {}, list: () => connectionsPromise } },
    } as never);
    live([step({ connectionId: "conn-A" })]);
    // Flush the exact connections lookup the component consumed, so
    // `labelFor` settles to `connection` (not merely `pending`) before
    // asserting the badge's absence — proving this isn't vacuously true
    // while the lookup is still in flight. (The resolved connection's name
    // is no longer plain text here — it flows through the mocked
    // ObjectRefChip — so waiting on rendered text is no longer available.)
    await act(async () => {
      await connectionsPromise;
    });
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

  // These characters carry no shell metacharacter, so absent the widened
  // predicate a step containing one would be `canPreAuthorize === true` and
  // render with no badge — the exact display-vs-authority divergence this
  // fix closes. One representative codepoint per class.
  describe("badges a command containing a control or format character", () => {
    it.each([
      ["C0 control", "cat /etc/passwd\x1b"],
      ["tab", "cat\t/etc/passwd"],
      ["DEL", "cat /etc/passwd\x7f"],
      ["C1 control", "cat /etc/passwd\x9b"],
      ["bidi override", "cat \u202e/etc/passwd"],
      ["zero-width", "cat /etc/pa\u200bsswd"],
    ])("%s", (_label, command) => {
      live([step({ command })]);
      expect(screen.getByText("aiAgent.plan.willStillAsk")).toBeTruthy();
    });
  });

  it("renders the command with whitespace preserved and bidi isolated, so it cannot collapse or be reordered", () => {
    const { container } = render(
      <PlanCard entry={{ planId: "plan-1", steps: [step({ status: "dispatched" })] as never, outcome: "approved_run" }} />,
    );
    const code = container.querySelector("code")!;
    expect(code.style.whiteSpace).toBe("pre-wrap");
    expect(code.style.unicodeBidi).toBe("isolate");
  });

  // A mutant that makes Reject send {approve:"ask", steps:[]} instead of
  // {approve:false} survives if only "does Reject exist" is asserted: per
  // approvalController.ts, {approve:"ask"} LIFTS the plan-mode refusal and
  // sets a planBatch, turning the user's "no" into "yes, ask before each
  // step" — the opposite of what Reject promises.
  it("Reject resolves the plan as refused, with no steps and no approval grade", () => {
    const resolve = live();
    fireEvent.click(screen.getByText("aiAgent.plan.reject"));
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve.mock.calls[0][0]).toEqual({ approve: false });
  });

  it("renders an ObjectRefChip for a step's target connection", () => {
    const entry = {
      planId: "pl1", outcome: "pending" as const,
      steps: [{ id: "s1", tool: "run_command" as const, command: "df -h", connectionId: "conn_7", rationale: "check disk", status: "pending" as const }],
    };
    useAgentStore.setState({ pendingPlan: { planId: "pl1" } as never });
    render(<PlanCard entry={entry as never} />);
    expect(screen.getByTestId("plan-chip").textContent).toBe("conn_7");
  });
});

describe("PlanCard — deferred #76 follow-ups", () => {
  const live = (steps: unknown[]) => {
    const resolve = vi.fn();
    useAgentStore.setState({ pendingPlan: { planId: "plan-1", generation: 1, steps: steps as never, resolve } });
    render(<PlanCard entry={{ planId: "plan-1", steps: steps as never, outcome: "pending" }} />);
    return resolve;
  };

  it("disables both approve grades once every step has been removed, leaving Reject the only exit", () => {
    const resolve = live([step()]);
    fireEvent.click(screen.getByText("aiAgent.plan.remove"));

    expect(screen.getByText("aiAgent.plan.emptyHint")).toBeTruthy();
    const run = screen.getByText("aiAgent.plan.approveAndRun") as HTMLButtonElement;
    const ask = screen.getByText("aiAgent.plan.approvePlan") as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    expect(ask.disabled).toBe(true);
    fireEvent.click(run);
    fireEvent.click(ask);
    expect(resolve).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("aiAgent.plan.reject"));
    expect(resolve).toHaveBeenCalled();
  });

  it("reveals the will-still-ask explanation on click, not only via the title attribute", () => {
    live([step({ command: "df -h | wc -l" })]);
    expect(screen.queryByText("aiAgent.plan.willStillAskHint")).toBeNull();

    const badge = screen.getByText("aiAgent.plan.willStillAsk").closest("button") as HTMLButtonElement;
    expect(badge.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(badge);

    expect(screen.getByText("aiAgent.plan.willStillAskHint")).toBeTruthy();
    expect(badge.getAttribute("aria-expanded")).toBe("true");
  });
});
