import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useAgentStore } from "../state/agentStore";
import { UNKNOWN_HOST } from "../state/hostDerivation";
import { ApprovalCard } from "./ApprovalCard";

// @iconify/react schedules an async icon-data-load timer that can fire after
// this file's jsdom environment is torn down, touching `window` and surfacing
// as an unhandled error unrelated to any assertion here. Stub it out.
vi.mock("@iconify/react", () => ({
  Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

const pending = { id: "a1", tool: "run_command", args: { command: "apt update" }, host: "web-01", allowlistKey: "apt", resolve: vi.fn() };

afterEach(cleanup);

describe("ApprovalCard", () => {
  beforeEach(() => useAgentStore.setState({ pendingApprovals: [pending], allowlist: [] }));
  it("Approve resolves true and clears the card", () => {
    render(<ApprovalCard pending={pending} />);
    fireEvent.click(screen.getByText("Approve"));
    expect(pending.resolve).toHaveBeenCalledWith({ approve: true });
    expect(useAgentStore.getState().pendingApprovals).toHaveLength(0);
  });
  it("Always adds an allowlist entry then approves", () => {
    render(<ApprovalCard pending={pending} />);
    fireEvent.click(screen.getByText(/Always allow/));
    expect(useAgentStore.getState().hasAllowlist({ host: "web-01", key: "apt" })).toBe(true);
    expect(pending.resolve).toHaveBeenCalledWith({ approve: true });
  });
  it("omits the Always allow button for a command containing a shell metacharacter", () => {
    const pipedPending = {
      id: "a2",
      tool: "run_command",
      args: { command: "df -h | grep x" },
      host: "web-01",
      allowlistKey: "df",
      resolve: vi.fn(),
    };
    useAgentStore.setState({ pendingApprovals: [pipedPending], allowlist: [] });
    render(<ApprovalCard pending={pipedPending} />);
    expect(screen.queryByText(/Always allow/)).toBeNull();
    expect(screen.getByText("Approve")).not.toBeNull();
  });
  it("shows the Always allow button for a plain command", () => {
    render(<ApprovalCard pending={pending} />);
    expect(screen.queryByText(/Always allow/)).not.toBeNull();
  });
  // Minor B: the gate fails closed on an unresolved host (deriveHost -> null,
  // rendered as UNKNOWN_HOST), and the card's "Always allow" visibility must
  // never drift from that — otherwise the UI could offer a shortcut the gate
  // itself would never actually grant.
  it("omits Always allow and shows the honest unknown-host label when the host could not be resolved", () => {
    const unknownHostPending = {
      id: "a3",
      tool: "run_command",
      args: { command: "apt update" },
      host: UNKNOWN_HOST,
      allowlistKey: "apt",
      resolve: vi.fn(),
    };
    useAgentStore.setState({ pendingApprovals: [unknownHostPending], allowlist: [] });
    render(<ApprovalCard pending={unknownHostPending} />);
    expect(screen.queryByText(/Always allow/)).toBeNull();
    expect(screen.getByText(`on ${UNKNOWN_HOST}`)).not.toBeNull();
    expect(screen.getByText("Approve")).not.toBeNull();
  });
});
