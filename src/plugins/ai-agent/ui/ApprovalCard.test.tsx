import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { installCatalogI18n } from "../testing/fakeI18n";
import { useAgentStore, type PendingApproval } from "../state/agentStore";
import * as storeMod from "../state/agentStore";
import { UNKNOWN_SCOPE } from "../state/scopeDerivation";
import { allowlistCandidates } from "../state/allowlist";
import { ApprovalCard } from "./ApprovalCard";

installCatalogI18n();

const CONNS = [
  { id: "c1", name: "Prod DB", host: "web-01", port: 22, username: "deploy", auth_type: "key", tags: [] },
];

// @iconify/react schedules an async icon-data-load timer that can fire after
// this file's jsdom environment is torn down, touching `window` and surfacing
// as an unhandled error unrelated to any assertion here. Stub it out.
vi.mock("@iconify/react", () => ({
  Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

// Render with the same store/mocks the file's other tests use. Mock the
// object card so we assert wiring, not its internals.
vi.mock("./ObjectRefCard", () => ({ ObjectRefCard: ({ id }: { id: string }) => <div data-testid="ref-card">{id}</div> }));
vi.mock("./useObjectRefs", () => ({
  useObjectRefs: () => ({ resolve: () => null, knownIds: new Set<string>(), loading: false }),
}));

/** Builds a `PendingApproval` fixture, filling in the parts every card needs
 * (`id`, `resolve`) that individual tests don't care about. */
function makePending(p: {
  tool: string;
  args: Record<string, unknown>;
  scope: string;
  grants: PendingApproval["grants"];
}): PendingApproval {
  return { id: "test-id", resolve: vi.fn(), ...p };
}

const pending = {
  id: "a1",
  tool: "run_command",
  args: { command: "apt update" },
  scope: "c1",
  // A realistic call: derive the grant the real gate would offer rather than
  // hand-writing it, so this fixture can't drift from allowlistCandidates.
  grants: allowlistCandidates("run_command", { command: "apt update" }, "c1"),
  resolve: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ApprovalCard", () => {
  beforeEach(() => useAgentStore.setState({ pendingApprovals: [pending], allowlist: [] }));
  it("Approve resolves true and clears the card", () => {
    render(<ApprovalCard pending={pending} />);
    fireEvent.click(screen.getByText("Approve"));
    expect(pending.resolve).toHaveBeenCalledWith({ approve: true, scope: "c1", via: "prompted" });
    expect(useAgentStore.getState().pendingApprovals).toHaveLength(0);
  });
  it("Always adds an allowlist entry then approves", () => {
    render(<ApprovalCard pending={pending} />);
    fireEvent.click(screen.getByText(/Always allow/));
    expect(useAgentStore.getState().hasAllowlist(pending.grants[0])).toBe(true);
    expect(pending.resolve).toHaveBeenCalledWith({ approve: true, scope: "c1", via: "prompted" });
  });
  it("omits the Always allow button for a command containing a shell metacharacter", () => {
    const pipedPending = {
      id: "a2",
      tool: "run_command",
      args: { command: "df -h | grep x" },
      scope: "c1",
      // The gate never offers a grant for a command carrying a shell
      // metacharacter — see allowlistCandidates — so a faithful fixture for
      // this call derives its grants from that same function rather than
      // hand-writing the empty array.
      grants: allowlistCandidates("run_command", { command: "df -h | grep x" }, "c1"),
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
  // Minor B: the gate fails closed on an unresolved scope (deriveScope -> null,
  // rendered as UNKNOWN_SCOPE), and the card's "Always allow" visibility must
  // never drift from that — otherwise the UI could offer a shortcut the gate
  // itself would never actually grant.
  it("omits Always allow and shows the honest unknown-connection label when the scope could not be resolved", () => {
    const unknownScopePending = {
      id: "a3",
      tool: "run_command",
      args: { command: "apt update" },
      scope: UNKNOWN_SCOPE,
      // Deliberately NOT derived from allowlistCandidates(tool, args,
      // UNKNOWN_SCOPE): in production this empty array comes from
      // approvalController's `scope === null` short-circuit, which never
      // calls allowlistCandidates at all — UNKNOWN_SCOPE is a display-only
      // substitution applied afterwards (see approvalController.approve).
      // Feeding UNKNOWN_SCOPE into allowlistCandidates as a real scope would
      // actually yield a (bogus) grant, so a literal is the honest fixture
      // here, not a derivation gap.
      grants: [],
      resolve: vi.fn(),
    };
    useAgentStore.setState({ pendingApprovals: [unknownScopePending], allowlist: [] });
    render(<ApprovalCard pending={unknownScopePending} />);
    expect(screen.queryByText(/Always allow/)).toBeNull();
    // UNKNOWN_SCOPE is now resolved to its human label rather than rendered
    // verbatim; "on Unresolved target" is that label's real English string.
    expect(screen.getByText("on Unresolved target")).not.toBeNull();
    expect(screen.getByText("Approve")).not.toBeNull();
  });

  it("labels the grant with the exact command, not the binary", () => {
    render(<ApprovalCard pending={makePending({
      tool: "run_command",
      args: { command: "df -h" },
      scope: "c1",
      grants: [{ scope: "c1", tool: "run_command", grain: "exact", key: "df -h" }],
    })} />);
    expect(screen.getByRole("button", { name: /`df -h`/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /`df` on/ })).toBeNull();
  });

  it("labels a non-command tool grant with the tool name", () => {
    render(<ApprovalCard pending={makePending({
      tool: "open_session",
      args: { connectionId: "c1" },
      scope: "c1",
      grants: [{ scope: "c1", tool: "open_session", grain: "tool", key: "open_session" }],
    })} />);
    expect(screen.getByRole("button", { name: /open_session/ })).toBeTruthy();
  });

  it("hides the control entirely when there are no grants", () => {
    render(<ApprovalCard pending={makePending({
      tool: "run_command",
      args: { command: "df -h | sh" },
      scope: "c1",
      // Derived, not hand-written: the shell-metacharacter guard in
      // allowlistCandidates is what actually makes this [], so let the real
      // function prove it rather than asserting a literal that could drift.
      grants: allowlistCandidates("run_command", { command: "df -h | sh" }, "c1"),
    })} />);
    expect(screen.queryByRole("button", { name: /always/i })).toBeNull();
  });

  it("stores exactly the candidate grant", () => {
    const add = vi.fn();
    useAgentStore.setState({ addAllowlist: add } as never);
    render(<ApprovalCard pending={makePending({
      tool: "run_command",
      args: { command: "df -h" },
      scope: "c1",
      grants: [{ scope: "c1", tool: "run_command", grain: "exact", key: "df -h" }],
    })} />);
    fireEvent.click(screen.getByRole("button", { name: /`df -h`/ }));
    expect(add).toHaveBeenCalledWith({ scope: "c1", tool: "run_command", grain: "exact", key: "df -h" });
  });

  it("names the connection, not the raw scope id", async () => {
    vi.spyOn(storeMod, "getAgentDeps").mockReturnValue({
      api: { connections: { subscribe: () => () => {}, list: async () => CONNS } },
    } as never);
    render(<ApprovalCard pending={{ id: "p1", tool: "run_command", args: { command: "df -h" }, scope: "c1", grants: [], resolve: vi.fn() }} />);
    expect(await screen.findByText(/Prod DB/)).toBeTruthy();
    expect(screen.queryByText(/\bc1\b/)).toBeNull();
  });

  // Important 1: editing connectionId on an open_session-shaped call must
  // resolve with the EDITED id as scope, not the original — otherwise a
  // later audit record would claim the call targeted the connection it was
  // first proposed against, while open_session actually opened the edited
  // one.
  it("resolves with the edited connectionId as scope when saved from the edit form", () => {
    const openSessionPending = makePending({
      tool: "open_session",
      args: { connectionId: "c1" },
      scope: "c1",
      grants: [],
    });
    useAgentStore.setState({ pendingApprovals: [openSessionPending], allowlist: [] });
    render(<ApprovalCard pending={openSessionPending} />);
    fireEvent.click(screen.getByText("Edit"));
    const input = screen.getByPlaceholderText("connection id");
    fireEvent.change(input, { target: { value: "c2" } });
    fireEvent.click(screen.getByText("Save & approve"));
    expect(openSessionPending.resolve).toHaveBeenCalledWith({
      approve: true,
      scope: "c2",
      via: "prompted",
      args: { connectionId: "c2" },
    });
  });

  it("labels an unresolvable scope instead of rendering a blank", async () => {
    vi.spyOn(storeMod, "getAgentDeps").mockReturnValue({
      api: { connections: { subscribe: () => () => {}, list: async () => CONNS } },
    } as never);
    render(<ApprovalCard pending={{ id: "p1", tool: "run_command", args: { command: "df -h" }, scope: "gone", grants: [], resolve: vi.fn() }} />);
    // Real i18n is in effect here (not a passthrough mock), so the rendered
    // text is the translated English copy, not the dotted key.
    expect(await screen.findByText(/Deleted connection/)).toBeTruthy();
  });

  it("renders an ObjectRefCard for the target instead of a raw connectionId", () => {
    const openSessionPending = {
      id: "p1", tool: "open_session", args: { connectionId: "conn_42" },
      scope: "conn_42", grants: [] as never[],
    };
    render(<ApprovalCard pending={openSessionPending as never} />);
    expect(screen.getByTestId("ref-card").textContent).toBe("conn_42");
    // The raw id must NOT appear as a JSON dump.
    expect(screen.queryByText(/"connectionId"/)).toBeNull();
  });

  // Important: close_session's args are just {sessionId} — neither `command`
  // nor `connectionId` — so it falls into the branch that used to render
  // `JSON.stringify(pending.args)`, leaking the raw opaque session id. That
  // branch must never surface `pending.args` as text; here the file-level
  // useObjectRefs mock always resolves null, so the branch must fall back to
  // a clean localized label instead of the id or a JSON dump.
  it("never leaks the raw sessionId for a close_session approval", () => {
    const closeSessionPending = {
      id: "p1", tool: "close_session", args: { sessionId: "sess_abc123" },
      scope: "c1", grants: [] as never[],
    };
    render(<ApprovalCard pending={closeSessionPending as never} />);
    expect(screen.queryByText(/sess_abc123/)).toBeNull();
    expect(screen.queryByText(/"sessionId"/)).toBeNull();
    expect(screen.getByText("No further details")).not.toBeNull();
  });
});
