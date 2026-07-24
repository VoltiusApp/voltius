import { describe, it, expect, vi } from "vitest";
import { createApprovalController } from "./approvalController";
import { isAllowlistable, UNKNOWN_HOST } from "./hostDerivation";
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
    deriveHost: async () => "web-01",
    allowlistKey: () => "apt",
    isAllowlistable,
    isAborted: opts.isAborted ?? (() => false),
  });
  return { c, pending };
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
    expect(pending[0]).toMatchObject({ tool: "run_command", host: "web-01", allowlistKey: "apt" });
    pending[0].resolve({ approve: true, args: { command: "apt upgrade" } });
    expect(await p).toEqual({ approve: true, args: { command: "apt upgrade" } });
  });
  it("an unresolved host (deriveHost -> null) always raises a card, even when hasAllowlist would return true (fail closed, not open)", async () => {
    const pending: PendingApproval[] = [];
    const c = createApprovalController({
      getMode: () => "ask",
      hasAllowlist: () => true, // would take the shortcut below if the host were treated as resolved
      addPending: (p) => pending.push(p),
      deriveHost: async () => null,
      allowlistKey: () => "apt",
      isAllowlistable,
      isAborted: () => false,
    });
    let settled = false;
    const p = c.approve({ tool: "run_command", args: { command: "apt update" } }, GEN);
    void p.then(() => { settled = true; });
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(settled).toBe(false);
    expect(pending[0].host).toBe(UNKNOWN_HOST);
    pending[0].resolve({ approve: true });
    expect(await p).toEqual({ approve: true });
  });

  it("a top-of-call abort refuses in 'ask' mode before deriveHost is ever consulted", async () => {
    const pending: PendingApproval[] = [];
    let deriveHostCalled = false;
    const c = createApprovalController({
      getMode: () => "ask",
      hasAllowlist: () => false,
      addPending: (p) => pending.push(p),
      deriveHost: async () => { deriveHostCalled = true; return "web-01"; },
      allowlistKey: () => "apt",
      isAllowlistable,
      isAborted: () => true,
    });
    const decision = await c.approve({ tool: "run_command", args: { command: "apt update" } }, GEN);
    expect(decision).toEqual({ approve: false, reason: "aborted" });
    expect(pending).toHaveLength(0);
    expect(deriveHostCalled).toBe(false);
  }, 2000);

  // Regression test 2 (brief item I1, "the deriveHost-await race"): a tool
  // call can be parked inside `await deps.deriveHost(...)` at the exact
  // instant the user hits Stop. Without a second isAborted() check placed
  // *after* that await, the call resumes, sees mode "ask" + no allowlist
  // hit, and registers a pending card that outlives the cancelled run —
  // clicking Approve on it would then genuinely execute. The controller
  // must instead resolve rejected, with nothing ever added to `pending`.
  it("a deriveHost that resolves only after the run is marked aborted still refuses, with no card left behind (the deriveHost-await race)", async () => {
    const pending: PendingApproval[] = [];
    let aborted = false;
    let resolveHost!: (h: string | null) => void;
    const hostPromise = new Promise<string | null>((resolve) => { resolveHost = resolve; });
    const c = createApprovalController({
      getMode: () => "ask",
      hasAllowlist: () => false,
      addPending: (p) => pending.push(p),
      deriveHost: async () => hostPromise,
      allowlistKey: () => "apt",
      isAllowlistable,
      isAborted: () => aborted,
    });

    const p = c.approve({ tool: "run_command", args: { command: "apt update" } }, GEN);
    // Simulate `stop()` firing while this call is still parked in the
    // deriveHost await, then let the await resolve afterward.
    aborted = true;
    resolveHost("web-01");

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
      deriveHost: async () => "web-01",
      allowlistKey: () => "apt",
      isAllowlistable,
      isAborted: (g) => { seen.push(g); return false; },
    });
    const p = c.approve({ tool: "run_command", args: { command: "apt update" } }, 42);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(seen).toEqual([42, 42]);
    pending[0].resolve({ approve: true });
    await p;
  }, 2000);
});
