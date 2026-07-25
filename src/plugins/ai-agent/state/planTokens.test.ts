import { beforeEach, describe, expect, it } from "vitest";
import {
  canPreAuthorize,
  consumeToken,
  MAX_PLAN_COMMAND_CHARS,
  mintTokens,
  stepEntry,
  type PlanStep,
} from "./planTokens";

let seq = 0;
// Reset per test: vitest isolates modules per FILE not per test (see
// vitest.config.ts), so an un-reset counter would carry over between tests
// and make an auto-id assertion depend on execution order. Production never
// has this problem — ids are assigned fresh per plan by array index — so
// resetting per test is the fixture staying faithful to that, not a fudge.
beforeEach(() => { seq = 0; });
// Distinct ids per call: production assigns `step-1..step-N` by index, so a
// fixture that reuses one id would not represent any real plan.
const cmd = (command: string, connectionId = "conn-A", id = `s${++seq}`): PlanStep => ({
  id, tool: "run_command", connectionId, command, rationale: "why",
});
const open = (connectionId = "conn-A", id = `s${++seq}`): PlanStep => ({
  id, tool: "open_session", connectionId, rationale: "why",
});

describe("stepEntry", () => {
  it("keys a run_command step on the exact command and the connection", () => {
    expect(stepEntry(cmd("df -h"))).toEqual({
      scope: "conn-A", tool: "run_command", grain: "exact", key: "df -h",
    });
  });

  it("keys a non-command step on the tool", () => {
    expect(stepEntry(open())).toEqual({
      scope: "conn-A", tool: "open_session", grain: "tool", key: "open_session",
    });
  });

  it("returns null for a command carrying a shell metacharacter", () => {
    // `!` history-expands in the interactive PTY, so the approved text is not
    // what would execute. `|` and `;` change the command outright.
    expect(stepEntry(cmd("df -h | grep /"))).toBeNull();
    expect(stepEntry(cmd("df -h !sudo"))).toBeNull();
    expect(canPreAuthorize(cmd("df -h | grep /"))).toBe(false);
    expect(canPreAuthorize(cmd("df -h"))).toBe(true);
  });

  it("returns null for an empty command", () => {
    expect(stepEntry(cmd("   "))).toBeNull();
  });

  it("keys the entry's scope on the step's own connectionId, not a fixed one", () => {
    // Every other fixture in this file mints on "conn-A", which cannot
    // distinguish "reads step.connectionId" from "always scopes to conn-A" (or
    // to any other hardcoded/fallback value). Mint from two different
    // connections and assert the two entries carry those distinct scopes.
    const onA = stepEntry(cmd("df -h", "conn-A"));
    const onB = stepEntry(cmd("df -h", "conn-B"));
    expect(onA?.scope).toBe("conn-A");
    expect(onB?.scope).toBe("conn-B");

    const batchA = mintTokens([cmd("df -h", "conn-A", "s1")], 1, "plan-1");
    const entry = { scope: "conn-A", tool: "run_command", grain: "exact", key: "df -h" } as const;
    // A token minted on conn-A must not be redeemable by a call scoped conn-B.
    expect(consumeToken(batchA, { ...entry, scope: "conn-B" }).consumed).toBe(false);
    expect(consumeToken(batchA, { ...entry, scope: "conn-A" }).consumed).toBe(true);
  });

  it("returns null for a run_command step whose command exceeds MAX_PLAN_COMMAND_CHARS, but mints at exactly the cap", () => {
    const atCap = "a".repeat(MAX_PLAN_COMMAND_CHARS);
    const overCap = "a".repeat(MAX_PLAN_COMMAND_CHARS + 1);
    expect(stepEntry(cmd(atCap))).toEqual({
      scope: "conn-A", tool: "run_command", grain: "exact", key: atCap,
    });
    expect(stepEntry(cmd(overCap))).toBeNull();
    expect(canPreAuthorize(cmd(overCap))).toBe(false);
  });
});

describe("mintTokens", () => {
  it("mints one unused token per pre-authorizable step and skips the rest", () => {
    // `*` is NOT in SHELL_METACHARACTERS (scopeDerivation.ts:8), so a glob IS
    // allowlistable and mints a token. A pipe is not — that is the skipped case.
    const a = cmd("df -h", "conn-A", "s1");
    const b = cmd("du -sh /var/*", "conn-A", "s2");
    const c = cmd("tail -f x | grep y", "conn-A", "s3");
    const d = open("conn-A", "s4");
    const batch = mintTokens([a, b, c, d], 7, "plan-1");
    expect(batch.generation).toBe(7);
    expect(batch.planId).toBe("plan-1");
    expect(batch.tokens.map((t) => t.entry.key)).toEqual(["df -h", "du -sh /var/*", "open_session"]);
    expect(batch.tokens.map((t) => t.stepId)).toEqual(["s1", "s2", "s4"]);
    expect(batch.tokens.every((t) => !t.used)).toBe(true);
  });

  it("mints a separate token for each occurrence of a repeated command", () => {
    // A plan may legitimately probe the same thing twice (before and after a
    // change). Two approved occurrences must authorize two executions.
    const batch = mintTokens(
      [cmd("df -h", "conn-A", "s1"), cmd("df -h", "conn-A", "s2")], 1, "plan-1",
    );
    expect(batch.tokens.map((t) => t.stepId)).toEqual(["s1", "s2"]);
  });
});

describe("consumeToken", () => {
  const entry = { scope: "conn-A", tool: "run_command", grain: "exact", key: "df -h" } as const;

  it("consumes a matching token exactly once", () => {
    const first = consumeToken(mintTokens([cmd("df -h")], 1, "plan-1"), entry);
    expect(first.consumed).toBe(true);
    expect(first.stepId).toBe("s1");
    const second = consumeToken(first.batch, entry);
    expect(second.consumed).toBe(false);
  });

  it("does not match the same command on a different connection", () => {
    const batch = mintTokens([cmd("df -h", "conn-A")], 1, "plan-1");
    // Non-vacuity: the SAME command on the minted connection must consume,
    // or this test would pass even if matching were broken entirely.
    expect(consumeToken(batch, { ...entry, scope: "conn-A" }).consumed).toBe(true);
    expect(consumeToken(batch, { ...entry, scope: "conn-B" }).consumed).toBe(false);
  });

  it("does not match a drifted command", () => {
    const batch = mintTokens([cmd("df -h")], 1, "plan-1");
    expect(consumeToken(batch, { ...entry, key: "df -h /" }).consumed).toBe(false);
  });

  it("returns the input batch unchanged when nothing matches", () => {
    const batch = mintTokens([cmd("df -h")], 1, "plan-1");
    const result = consumeToken(batch, { ...entry, key: "uptime" });
    expect(result.batch).toBe(batch);
  });

  it("does not mutate the input batch", () => {
    const batch = mintTokens([cmd("df -h")], 1, "plan-1");
    consumeToken(batch, entry);
    expect(batch.tokens[0].used).toBe(false);
  });
});
