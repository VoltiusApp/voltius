import { describe, expect, it } from "vitest";
import {
  canPreAuthorize,
  consumeToken,
  mintTokens,
  stepEntry,
  type PlanStep,
} from "./planTokens";

const cmd = (command: string, connectionId = "conn-A"): PlanStep => ({
  id: "s1", tool: "run_command", connectionId, command, rationale: "why",
});
const open = (connectionId = "conn-A"): PlanStep => ({
  id: "s0", tool: "open_session", connectionId, rationale: "why",
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
});

describe("mintTokens", () => {
  it("mints one unused token per pre-authorizable step and skips the rest", () => {
    const batch = mintTokens([cmd("df -h"), cmd("du -sh /var/*"), open()], 7, "plan-1");
    expect(batch.generation).toBe(7);
    expect(batch.planId).toBe("plan-1");
    expect(batch.tokens.map((t) => t.entry.key)).toEqual(["df -h", "open_session"]);
    expect(batch.tokens.map((t) => t.stepId)).toEqual(["s1", "s0"]);
    expect(batch.tokens.every((t) => !t.used)).toBe(true);
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
