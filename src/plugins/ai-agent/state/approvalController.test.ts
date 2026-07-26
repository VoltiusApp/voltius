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
    planActive: () => false,
    consumePlanToken: () => false,
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
    planActive: () => false,
    consumePlanToken: () => false,
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
    expect(await c.approve({ tool: "run_command", args: { command: "apt update" } }, GEN)).toEqual({
      approve: true, scope: "c1", via: "auto_mode",
    });
    expect(pending).toHaveLength(0);
  });
  it("ask + allowlist hit approves without a card", async () => {
    const { c, pending } = ctl("ask", { allowed: true });
    expect(await c.approve({ tool: "run_command", args: { command: "apt update" } }, GEN)).toEqual({
      approve: true, scope: "c1", via: "granted",
    });
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
    pending[0].resolve({ approve: true, scope: "c1", via: "prompted" });
    expect(await p).toEqual({ approve: true, scope: "c1", via: "prompted" });
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
    pending[0].resolve({ approve: true, scope: "c1", via: "prompted", args: { command: "apt upgrade" } });
    expect(await p).toEqual({ approve: true, scope: "c1", via: "prompted", args: { command: "apt upgrade" } });
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
      planActive: () => false,
      consumePlanToken: () => false,
    });
    let settled = false;
    const p = c.approve({ tool: "run_command", args: { command: "apt update" } }, GEN);
    void p.then(() => { settled = true; });
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(settled).toBe(false);
    expect(pending[0].scope).toBe(UNKNOWN_SCOPE);
    expect(pending[0].grants).toEqual([]);
    pending[0].resolve({ approve: true, scope: UNKNOWN_SCOPE, via: "prompted" });
    expect(await p).toEqual({ approve: true, scope: UNKNOWN_SCOPE, via: "prompted" });
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
      planActive: () => false,
      consumePlanToken: () => false,
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
      planActive: () => false,
      consumePlanToken: () => false,
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
      planActive: () => false,
      consumePlanToken: () => false,
    });
    const p = c.approve({ tool: "run_command", args: { command: "apt update" } }, 42);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(seen).toEqual([42, 42]);
    pending[0].resolve({ approve: true, scope: "c1", via: "prompted" });
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
      ).resolves.toEqual({ approve: true, scope: "c1", via: "granted" });
      expect(addPending).not.toHaveBeenCalled();
    });

    it("a grant stored for one connection does not authorize the same command on a different connection", async () => {
      const stored: AllowlistEntry[] = [
        { scope: "c1", tool: "run_command", grain: "exact", key: "df -h" },
      ];
      const addPending = vi.fn();
      const c = makeController({
        getMode: () => "ask",
        hasAllowlist: (e) => stored.some((s) => entriesEqual(s, e)),
        addPending,
        deriveScope: async () => "c2",
      });
      void c.approve({ tool: "run_command", args: { command: "df -h" } }, 0);
      await vi.waitFor(() => expect(addPending).toHaveBeenCalledTimes(1)); // a card, not an auto-approval
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

  it("auto mode reports the derived scope and via=auto_mode", async () => {
    const { c } = ctl("auto");
    const d = await c.approve({ tool: "run_command", args: { command: "uptime" } }, GEN);
    expect(d).toEqual({ approve: true, scope: "c1", via: "auto_mode" });
  });

  it("an allowlist hit reports via=granted", async () => {
    const { c } = ctl("ask", { allowed: true });
    const d = await c.approve({ tool: "run_command", args: { command: "uptime" } }, GEN);
    expect(d).toEqual({ approve: true, scope: "c1", via: "granted" });
  });

  it("auto mode is refused when the run aborts DURING deriveScope", async () => {
    // Fails against the pre-reorder ordering, where auto returned {approve:true}
    // before deriveScope was ever awaited. That is the point of this test.
    let aborted = false;
    const c = makeController({
      getMode: () => "auto",
      deriveScope: async () => { aborted = true; return "c1"; },
      isAborted: () => aborted,
    });
    const d = await c.approve({ tool: "run_command", args: { command: "uptime" } }, GEN);
    expect(d).toEqual({ approve: false, reason: "aborted" });
  });

  it("plan mode still short-circuits without paying for deriveScope", async () => {
    const deriveScope = vi.fn(async () => "c1");
    const c = makeController({ getMode: () => "plan", deriveScope });
    await c.approve({ tool: "run_command", args: { command: "uptime" } }, GEN);
    expect(deriveScope).not.toHaveBeenCalled();
  });

  it("auto mode reports UNKNOWN_SCOPE when the scope cannot be derived", async () => {
    const c = makeController({ getMode: () => "auto", deriveScope: async () => null });
    const d = await c.approve({ tool: "run_command", args: { command: "uptime" } }, GEN);
    expect(d).toEqual({ approve: true, scope: UNKNOWN_SCOPE, via: "auto_mode" });
  });
});

/** Deps-factory for the plan-token gate tests below — this file's other
 *  helper (`makeController`) returns a built controller, not the deps object,
 *  so these tests (which assert on `deps.addPending` / an injected
 *  `consumePlanToken` spy) get their own. `deriveScope` defaults to
 *  "conn-A" so `allowlistCandidates` mints one real "exact" candidate for
 *  "df -h", letting the token branch's `grants.some(...)` actually run. */
function makeDeps(overrides: Partial<ApprovalControllerDeps> = {}): ApprovalControllerDeps {
  return {
    getMode: () => "ask",
    hasAllowlist: () => false,
    addPending: vi.fn(),
    deriveScope: async () => "conn-A",
    allowlistCandidates,
    isAborted: () => false,
    planActive: () => false,
    consumePlanToken: () => false,
    ...overrides,
  };
}

describe("plan pre-authorization", () => {
  const call = { tool: "run_command", args: { sessionId: "sess-1", command: "df -h" } };

  it("plan mode still refuses outright when no batch is live", async () => {
    const deps = makeDeps({ getMode: () => "plan", planActive: () => false });
    const c = createApprovalController(deps);
    await expect(c.approve(call, 1)).resolves.toMatchObject({ approve: false });
    expect(deps.addPending).not.toHaveBeenCalled();
  });

  it("approves a call matching a token, reporting via:plan", async () => {
    const deps = makeDeps({
      getMode: () => "plan",
      planActive: () => true,
      consumePlanToken: vi.fn(() => true),
    });
    await expect(createApprovalController(deps).approve(call, 1))
      .resolves.toEqual({ approve: true, scope: "conn-A", via: "plan" });
  });

  it("cards an OFF-PLAN step instead of refusing, while a batch is live", async () => {
    const deps = makeDeps({
      getMode: () => "plan",
      planActive: () => true,
      consumePlanToken: vi.fn(() => false),
    });
    const c = createApprovalController(deps);
    void c.approve(call, 1);
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.addPending).toHaveBeenCalled();
  });

  it("prefers a standing grant and does NOT spend a token", async () => {
    const consumePlanToken = vi.fn(() => true);
    const deps = makeDeps({
      getMode: () => "ask",
      hasAllowlist: () => true,
      planActive: () => true,
      consumePlanToken,
    });
    await expect(createApprovalController(deps).approve(call, 1))
      .resolves.toMatchObject({ via: "granted" });
    expect(consumePlanToken).not.toHaveBeenCalled();
  });

  it("never consults tokens for an unresolved scope", async () => {
    const consumePlanToken = vi.fn(() => true);
    const deps = makeDeps({
      getMode: () => "plan",
      planActive: () => true,
      deriveScope: async () => null,
      consumePlanToken,
    });
    const c = createApprovalController(deps);
    void c.approve(call, 1);
    await Promise.resolve();
    await Promise.resolve();
    expect(consumePlanToken).not.toHaveBeenCalled();
    expect(deps.addPending).toHaveBeenCalled();
  });

  it("refuses a token for an aborted generation before the mode gate", async () => {
    const consumePlanToken = vi.fn(() => true);
    const deps = makeDeps({
      getMode: () => "plan",
      planActive: () => true,
      isAborted: () => true,
      consumePlanToken,
    });
    await expect(createApprovalController(deps).approve(call, 1))
      .resolves.toEqual({ approve: false, reason: "aborted" });
    expect(consumePlanToken).not.toHaveBeenCalled();
  });

  // Carried forward from Task 1's review: a step whose command mints no token
  // (shell metacharacter, over MAX_PLAN_COMMAND_CHARS, empty scope, ...) must
  // fall through to a normal approval card — never to silent execution, and
  // never to a flat refusal just because a batch happens to be live.
  it("a step outside the token's exact-command shape still cards, never executes silently and never flat-refuses", async () => {
    const deps = makeDeps({
      getMode: () => "plan",
      planActive: () => true,
      // No entry ever minted for a piped command, so allowlistCandidates
      // returns [] for it — consumePlanToken has nothing to be asked about.
      consumePlanToken: vi.fn(() => true),
    });
    const c = createApprovalController(deps);
    const p = c.approve(
      { tool: "run_command", args: { sessionId: "sess-1", command: "df -h | grep x" } },
      1,
    );
    let settled = false;
    void p.then(() => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false); // not silently executed, not flat-refused
    expect(deps.addPending).toHaveBeenCalled();
  });
});
