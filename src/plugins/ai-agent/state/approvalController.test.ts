import { describe, it, expect, vi } from "vitest";
import { createApprovalController } from "./approvalController";
import { isAllowlistable } from "./hostDerivation";
import type { Mode, PendingApproval } from "./agentStore";

function ctl(mode: Mode, opts: { allowed?: boolean } = {}) {
  const pending: PendingApproval[] = [];
  const c = createApprovalController({
    getMode: () => mode,
    hasAllowlist: () => opts.allowed ?? false,
    addPending: (p) => pending.push(p),
    deriveHost: async () => "web-01",
    allowlistKey: () => "apt",
    isAllowlistable,
  });
  return { c, pending };
}

describe("ApprovalController", () => {
  it("plan mode rejects with a reason and does not card", async () => {
    const { c, pending } = ctl("plan");
    const d = await c.approve({ tool: "run_command", args: { command: "apt update" } });
    expect(d).toEqual({ approve: false, reason: expect.stringContaining("plan mode") });
    expect(pending).toHaveLength(0);
  });
  it("auto mode approves without a card", async () => {
    const { c, pending } = ctl("auto");
    expect(await c.approve({ tool: "run_command", args: { command: "apt update" } })).toEqual({ approve: true });
    expect(pending).toHaveLength(0);
  });
  it("ask + allowlist hit approves without a card", async () => {
    const { c, pending } = ctl("ask", { allowed: true });
    expect(await c.approve({ tool: "run_command", args: { command: "apt update" } })).toEqual({ approve: true });
    expect(pending).toHaveLength(0);
  });
  it("ask + allowlist hit does NOT auto-approve a piped command (metacharacter escalation)", async () => {
    const { c, pending } = ctl("ask", { allowed: true });
    let settled = false;
    const p = c.approve({ tool: "run_command", args: { command: "df -h | grep x" } });
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
    const p = c.approve({ tool: "run_command", args: { command: "apt update" } });
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0]).toMatchObject({ tool: "run_command", host: "web-01", allowlistKey: "apt" });
    pending[0].resolve({ approve: true, args: { command: "apt upgrade" } });
    expect(await p).toEqual({ approve: true, args: { command: "apt upgrade" } });
  });
});
