import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@/i18n";
import { useAgentStore, type PendingApproval } from "../state/agentStore";
import { UNKNOWN_HOST } from "../state/hostDerivation";
import { allowlistCandidates } from "../state/allowlist";
import { ApprovalCard } from "./ApprovalCard";

// @iconify/react schedules an async icon-data-load timer that can fire after
// this file's jsdom environment is torn down, touching `window` and surfacing
// as an unhandled error unrelated to any assertion here. Stub it out.
vi.mock("@iconify/react", () => ({
  Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

/** Builds a `PendingApproval` fixture, filling in the parts every card needs
 * (`id`, `resolve`) that individual tests don't care about. */
function makePending(p: {
  tool: string;
  args: Record<string, unknown>;
  host: string;
  grants: PendingApproval["grants"];
}): PendingApproval {
  return { id: "test-id", resolve: vi.fn(), ...p };
}

const pending = {
  id: "a1",
  tool: "run_command",
  args: { command: "apt update" },
  host: "web-01",
  // A realistic call: derive the grant the real gate would offer rather than
  // hand-writing it, so this fixture can't drift from allowlistCandidates.
  grants: allowlistCandidates("run_command", { command: "apt update" }, "web-01"),
  resolve: vi.fn(),
};

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
    expect(useAgentStore.getState().hasAllowlist(pending.grants[0])).toBe(true);
    expect(pending.resolve).toHaveBeenCalledWith({ approve: true });
  });
  it("omits the Always allow button for a command containing a shell metacharacter", () => {
    const pipedPending = {
      id: "a2",
      tool: "run_command",
      args: { command: "df -h | grep x" },
      host: "web-01",
      // The gate never offers a grant for a command carrying a shell
      // metacharacter — see allowlistCandidates — so a faithful fixture for
      // this call derives its grants from that same function rather than
      // hand-writing the empty array.
      grants: allowlistCandidates("run_command", { command: "df -h | grep x" }, "web-01"),
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
      // Deliberately NOT derived from allowlistCandidates(tool, args,
      // UNKNOWN_HOST): in production this empty array comes from
      // approvalController's `host === null` short-circuit, which never
      // calls allowlistCandidates at all — UNKNOWN_HOST is a display-only
      // substitution applied afterwards (see approvalController.approve).
      // Feeding UNKNOWN_HOST into allowlistCandidates as a real host would
      // actually yield a (bogus) grant, so a literal is the honest fixture
      // here, not a derivation gap.
      grants: [],
      resolve: vi.fn(),
    };
    useAgentStore.setState({ pendingApprovals: [unknownHostPending], allowlist: [] });
    render(<ApprovalCard pending={unknownHostPending} />);
    expect(screen.queryByText(/Always allow/)).toBeNull();
    expect(screen.getByText(`on ${UNKNOWN_HOST}`)).not.toBeNull();
    expect(screen.getByText("Approve")).not.toBeNull();
  });

  it("labels the grant with the exact command, not the binary", () => {
    render(<ApprovalCard pending={makePending({
      tool: "run_command",
      args: { command: "df -h" },
      host: "ssh-host-1",
      grants: [{ host: "ssh-host-1", tool: "run_command", grain: "exact", key: "df -h" }],
    })} />);
    expect(screen.getByRole("button", { name: /`df -h`/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /`df` on/ })).toBeNull();
  });

  it("labels a non-command tool grant with the tool name", () => {
    render(<ApprovalCard pending={makePending({
      tool: "open_session",
      args: { connectionId: "c1" },
      host: "ssh-host-1",
      grants: [{ host: "ssh-host-1", tool: "open_session", grain: "tool", key: "open_session" }],
    })} />);
    expect(screen.getByRole("button", { name: /open_session/ })).toBeTruthy();
  });

  it("hides the control entirely when there are no grants", () => {
    render(<ApprovalCard pending={makePending({
      tool: "run_command",
      args: { command: "df -h | sh" },
      host: "ssh-host-1",
      // Derived, not hand-written: the shell-metacharacter guard in
      // allowlistCandidates is what actually makes this [], so let the real
      // function prove it rather than asserting a literal that could drift.
      grants: allowlistCandidates("run_command", { command: "df -h | sh" }, "ssh-host-1"),
    })} />);
    expect(screen.queryByRole("button", { name: /always/i })).toBeNull();
  });

  it("stores exactly the candidate grant", () => {
    const add = vi.fn();
    useAgentStore.setState({ addAllowlist: add } as never);
    render(<ApprovalCard pending={makePending({
      tool: "run_command",
      args: { command: "df -h" },
      host: "ssh-host-1",
      grants: [{ host: "ssh-host-1", tool: "run_command", grain: "exact", key: "df -h" }],
    })} />);
    fireEvent.click(screen.getByRole("button", { name: /`df -h`/ }));
    expect(add).toHaveBeenCalledWith({ host: "ssh-host-1", tool: "run_command", grain: "exact", key: "df -h" });
  });
});
