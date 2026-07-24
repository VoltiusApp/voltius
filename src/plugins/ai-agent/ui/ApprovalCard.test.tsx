import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useAgentStore } from "../state/agentStore";
import { ApprovalCard } from "./ApprovalCard";

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
});
