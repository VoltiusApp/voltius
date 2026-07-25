import { describe, it, expect, vi } from "vitest";
import { createApprovalController, type ApprovalControllerDeps } from "./approvalController";
import { UNKNOWN_SCOPE } from "./scopeDerivation";
import { allowlistCandidates, entriesEqual, type AllowlistEntry } from "./allowlist";
import type { Mode, PendingApproval } from "./agentStore";

// Every approve() call is issued under a generation, exactly as sendMessage
// binds it in production. GEN is the "live" one for these controller-level
// tests; the store-level generation semantics are covered in agentStore.test.ts.
const GEN = 7;

function ctl(mode: Mode, opts: { allowed?: boolean; isAborted?: (g: number) => boolean } = {}) {
  const pending: PendingApproval[] = [];
  const c = createApprovalController({
    getMode: () => mode,
    hasAllowlist: () => opts.allowed ?? false,
    addPending: (p) => pending.push(p),
    deriveScope: async () => "c1",
    allowlistCandidates,
    isAborted: opts.isAborted ?? (() => false),
  });
  return { c, pending };
}

/** Builds a controller from sensible defaults, overridable per test — used by
 *  the "grant grain" tests below, which only care about a few of the deps. */
function makeController(overrides: Partial<ApprovalControllerDeps> = {}) {
  return createApprovalController({
    getMode: () => "ask",
    hasAllowlist: () => false,
    addPending: () => {},
    deriveScope: async () => "c1",
    allowlistCandidates,
    isAborted: () => false,
    ...overrides,
  });
}

describe("ApprovalController", () => {
  it("plan mode rejects with a reason and does not card", async () => {
    const { c, pending } = ctl("plan");
    const d = await c.approve({ tool: "run_command", args: { command: "apt update" } }, GEN);
    expect(d).toEqual({ approve: false, reason: expect.stringContaining("plan mode") });
    expect(pending).toHaveLength(0);
  });
  it("auto mode approves without a card", async () => {
    const { c, pending } = ctl("auto");
    expect(await c.approve({ tool: "run_command", args: { command: "apt update" } }, GEN)).toEqual({ approve: true });
    expect(pending).toHaveLength(0);
  });
  it("ask + allowlist hit approves without a card", async () => {
    const { c, pending } = ctl("ask", { allowed: true });
    expect(await c.approve({ tool: "run_command", args: { command: "apt update" } }, GEN)).toEqual({ approve: true });
    expect(pending).toHaveLength(0);
  });
  it("ask + allowlist hit does NOT auto-approve a piped command (metacharacter escalation)", async () => {
    const { c, pending } = ctl("ask", { allowed: true });
    let settled = false;
    const p = c.approve({ tool: "run_command", args: { command: "df -h | grep x" } }, GEN);
    void p.then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(settled).toBe(false);
    pending[0].resolve({ approve: true });
    expect(await p).toEqual({ approve: true });
  });
  it("ask + miss creates a pending card and resolves via it", async () => {
    const { c, pending } = ctl("ask");
    const p = c.approve({ tool: "run_command", args: { command: "apt update" } }, GEN);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0]).toMatchObject({
      tool: "run_command",
      scope: "c1",
      grants: [{ scope: "c1", tool: "run_command", grain: "exact", key: "apt update" }],
    });
    pending[0].resolve({ approve: true, args: { command: "apt upgrade" } });
    expect(await p).toEqual({ approve: true, args: { command: "apt upgrade" } });
  });
  it("an unresolved scope (deriveScope -> null) always raises a card, even when hasAllowlist would return true (fail closed, not open)", async () => {
    const pending: PendingApproval[] = [];
    const c = createApprovalController({
      getMode: () => "ask",
      hasAllowlist: () => true, // would take the shortcut below if the scope were treated as resolved
      addPending: (p) => pending.push(p),
      deriveScope: async () => null,
      allowlistCandidates,
      isAborted: () => false,
    });
    let settled = false;
    const p = c.approve({ tool: "run_command", args: { command: "apt update" } }, GEN);
    void p.then(() => { settled = true; });
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(settled).toBe(false);
    expect(pending[0].scope).toBe(UNKNOWN_SCOPE);
    expect(pending[0].grants).toEqual([]);
    pending[0].resolve({ approve: true });
    expect(await p).toEqual({ approve: true });
  });

  it("a top-of-call abort refuses in 'ask' mode before deriveScope is ever consulted", async () => {
    const pending: PendingApproval[] = [];
    let deriveScopeCalled = false;
    const c = createApprovalController({
      getMode: () => "ask",
      hasAllowlist: () => false,
      addPending: (p) => pending.push(p),
      deriveScope: async () => { deriveScopeCalled = true; return "c1"; },
      allowlistCandidates,
      isAborted: () => true,
    });
    const decision = await c.approve({ tool: "run_command", args: { command: "apt update" } }, GEN);
    expect(decision).toEqual({ approve: false, reason: "aborted" });
    expect(pending).toHaveLength(0);
    expect(deriveScopeCalled).toBe(false);
  }, 2000);

  // Regression test 2 (brief item I1, "the deriveScope-await race"): a tool
  // call can be parked inside `await deps.deriveScope(...)` at the exact
  // instant the user hits Stop. Without a second isAborted() check placed
  // *after* that await, the call resumes, sees mode "ask" + no allowlist
  // hit, and registers a pending card that outlives the cancelled run —
  // clicking Approve on it would then genuinely execute. The controller
  // must instead resolve rejected, with nothing ever added to `pending`.
  it("a deriveScope that resolves only after the run is marked aborted still refuses, with no card left behind (the deriveScope-await race)", async () => {
    const pending: PendingApproval[] = [];
    let aborted = false;
    let resolveScope!: (s: string | null) => void;
    const scopePromise = new Promise<string | null>((resolve) => { resolveScope = resolve; });
    const c = createApprovalController({
      getMode: () => "ask",
      hasAllowlist: () => false,
      addPending: (p) => pending.push(p),
      deriveScope: async () => scopePromise,
      allowlistCandidates,
      isAborted: () => aborted,
    });

    const p = c.approve({ tool: "run_command", args: { command: "apt update" } }, GEN);
    // Simulate `stop()` firing while this call is still parked in the
    // deriveScope await, then let the await resolve afterward.
    aborted = true;
    resolveScope("c1");

    const decision = await p;
    expect(decision).toEqual({ approve: false, reason: "aborted" });
    expect(pending).toHaveLength(0);
  }, 2000);

  // The controller must ask about *this call's* generation at both check
  // points, never about "whatever generation is current now" — that is the
  // whole point of taking it as a parameter rather than reading module state.
  it("asks the store about the call's own generation at both check points", async () => {
    const seen: number[] = [];
    const pending: PendingApproval[] = [];
    const c = createApprovalController({
      getMode: () => "ask",
      hasAllowlist: () => false,
      addPending: (p) => pending.push(p),
      deriveScope: async () => "c1",
      allowlistCandidates,
      isAborted: (g) => { seen.push(g); return false; },
    });
    const p = c.approve({ tool: "run_command", args: { command: "apt update" } }, 42);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(seen).toEqual([42, 42]);
    pending[0].resolve({ approve: true });
    await p;
  }, 2000);

  describe("grant grain", () => {
    it("an exact grant does not authorize a different argv", async () => {
      const stored: AllowlistEntry[] = [
        { scope: "c1", tool: "run_command", grain: "exact", key: "df -h" },
      ];
      const addPending = vi.fn();
      const c = makeController({
        getMode: () => "ask",
        hasAllowlist: (e) => stored.some((s) => entriesEqual(s, e)),
        addPending,
        deriveScope: async () => "c1",
      });
      void c.approve({ tool: "run_command", args: { command: "df --output=source" } }, 0);
      await vi.waitFor(() => expect(addPending).toHaveBeenCalledTimes(1)); // a card, not an auto-approval
    });

    it("an exact grant authorizes the identical command with no card", async () => {
      const stored: AllowlistEntry[] = [
        { scope: "c1", tool: "run_command", grain: "exact", key: "df -h" },
      ];
      const addPending = vi.fn();
      const c = makeController({
        getMode: () => "ask",
        hasAllowlist: (e) => stored.some((s) => entriesEqual(s, e)),
        addPending,
        deriveScope: async () => "c1",
      });
      await expect(
        c.approve({ tool: "run_command", args: { command: " df -h " } }, 0),
      ).resolves.toEqual({ approve: true });
      expect(addPending).not.toHaveBeenCalled();
    });

    it("offers no grants at all when the scope is unresolved", async () => {
      const addPending = vi.fn();
      const c = makeController({
        getMode: () => "ask",
        hasAllowlist: () => true, // even a permissive store must not help
        addPending,
        deriveScope: async () => null,
      });
      void c.approve({ tool: "run_command", args: { command: "df -h" } }, 0);
      await vi.waitFor(() => expect(addPending).toHaveBeenCalledTimes(1));
      expect(addPending.mock.calls[0][0].scope).toBe(UNKNOWN_SCOPE);
      expect(addPending.mock.calls[0][0].grants).toEqual([]);
    });
  });
});
