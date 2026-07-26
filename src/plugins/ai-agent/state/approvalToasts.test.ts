import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useUIStore } from "@/stores/uiStore";
import { useAgentStore } from "./agentStore";
import { installApprovalToasts } from "./approvalToasts";
import { DRAWER_PANEL_ID } from "../panelId";

// Not cast to `never` at construction (unlike other fakeApi helpers in this
// plugin): these tests read .mock.calls off `a.notifications.toast` directly,
// which a `never`-typed binding can't do. Cast to `never` only at the
// installApprovalToasts(a as never) call sites below, where a PluginAPI is required.
function api() {
  return { notifications: { toast: vi.fn() }, connections: { list: async () => [] } };
}

const pending = (id: string) => ({
  id, tool: "run_command", args: { command: "df -h" }, scope: "c1", grants: [], resolve: vi.fn(),
});

let dispose: (() => void) | null = null;

beforeEach(() => {
  useAgentStore.setState({ pendingApprovals: [], pendingPlan: null });
  useUIStore.setState({ globalPanelOpen: {} } as never);
});
afterEach(() => { dispose?.(); dispose = null; });

describe("installApprovalToasts", () => {
  it("toasts a new pending approval while the drawer is closed", () => {
    const a = api();
    dispose = installApprovalToasts(a as never);
    useAgentStore.getState()._addPending(pending("p1"));
    expect(a.notifications.toast).toHaveBeenCalledTimes(1);
    const [, opts] = a.notifications.toast.mock.calls[0];
    expect(opts.severity).toBe("warning");
    expect(opts.duration).toBe(8000);
    expect(typeof opts.action.onClick).toBe("function");
  });

  it("the toast action opens the drawer", () => {
    const a = api();
    dispose = installApprovalToasts(a as never);
    useAgentStore.getState()._addPending(pending("p1"));
    a.notifications.toast.mock.calls[0][1].action.onClick();
    expect(useUIStore.getState().globalPanelOpen[DRAWER_PANEL_ID]).toBe(true);
  });

  it("does not toast while the drawer is open", () => {
    const a = api();
    useUIStore.setState({ globalPanelOpen: { [DRAWER_PANEL_ID]: true } } as never);
    dispose = installApprovalToasts(a as never);
    useAgentStore.getState()._addPending(pending("p1"));
    expect(a.notifications.toast).not.toHaveBeenCalled();
  });

  it("toasts each approval id exactly once", () => {
    const a = api();
    dispose = installApprovalToasts(a as never);
    useAgentStore.getState()._addPending(pending("p1"));
    useAgentStore.setState((s) => ({ ...s })); // unrelated re-render
    useAgentStore.getState()._addPending(pending("p2"));
    expect(a.notifications.toast).toHaveBeenCalledTimes(2);
  });

  it("stops toasting after disposal", () => {
    const a = api();
    installApprovalToasts(a as never)();
    useAgentStore.getState()._addPending(pending("p1"));
    expect(a.notifications.toast).not.toHaveBeenCalled();
  });

  it("forgets resolved ids so the seen set cannot grow unbounded", () => {
    const a = api();
    dispose = installApprovalToasts(a as never);
    useAgentStore.getState()._addPending(pending("p1"));
    useAgentStore.getState()._rejectAllPending("aborted");
    useAgentStore.getState()._addPending(pending("p1"));
    expect(a.notifications.toast).toHaveBeenCalledTimes(2);
  });

  it("toasts a pending plan once, and only while the drawer is closed", () => {
    const a = api();
    dispose = installApprovalToasts(a as never);
    useAgentStore.setState({
      pendingPlan: {
        planId: "plan-1",
        generation: 1,
        steps: [{ id: "s1", tool: "run_command", connectionId: "c", command: "df -h", rationale: "r" }],
        resolve: vi.fn(),
      } as never,
    });
    useAgentStore.setState((s) => ({ ...s })); // unrelated re-render, must not re-toast
    expect(a.notifications.toast).toHaveBeenCalledTimes(1);
    expect(a.notifications.toast.mock.calls[0][0]).toContain("1-step plan");
  });

  it("does not toast a pending plan while the drawer is open", () => {
    const a = api();
    useUIStore.setState({ globalPanelOpen: { [DRAWER_PANEL_ID]: true } } as never);
    dispose = installApprovalToasts(a as never);
    useAgentStore.setState({
      pendingPlan: {
        planId: "plan-1",
        generation: 1,
        steps: [{ id: "s1", tool: "run_command", connectionId: "c", command: "df -h", rationale: "r" }],
        resolve: vi.fn(),
      } as never,
    });
    expect(a.notifications.toast).not.toHaveBeenCalled();
  });
});
