import { describe, expect, test } from "vitest";
import { DOWN_CONFIRM_MS, DOWN_RETRY_MS, STARTUP_SPREAD_MS, confirmDown, intervalFor, jitterFor, selectDue } from "./schedule";
import type { PingTarget } from "./pingTargets";

const SESSION_MS = 5_000;
const IDLE_MS = 60_000;

function target(over: Partial<PingTarget> = {}): PingTarget {
  return {
    key: "h1:22",
    host: "h1",
    port: 22,
    connectionIds: ["a"],
    sessionId: null,
    connection: { id: "a", host: "h1", port: 22 } as PingTarget["connection"],
    ...over,
  };
}

describe("jitterFor", () => {
  test("is stable for a key and inside the span", () => {
    expect(jitterFor("h1:22", 1000)).toBe(jitterFor("h1:22", 1000));
    expect(jitterFor("h1:22", 1000)).toBeLessThan(1000);
    expect(jitterFor("h1:22", 1000)).toBeGreaterThanOrEqual(0);
  });

  test("differs across keys", () => {
    expect(jitterFor("h1:22", 60_000)).not.toBe(jitterFor("h2:22", 60_000));
  });
});

describe("intervalFor", () => {
  test("uses the session interval when a session is live", () => {
    expect(intervalFor(target({ sessionId: "s1" }), SESSION_MS, IDLE_MS)).toBe(SESSION_MS);
  });

  test("uses the idle interval otherwise", () => {
    expect(intervalFor(target(), SESSION_MS, IDLE_MS)).toBe(IDLE_MS);
  });
});

describe("selectDue", () => {
  test("does not probe a sessionless target on first appearance, but schedules it soon", () => {
    const r = selectDue([target()], {}, 1_000, SESSION_MS, IDLE_MS);
    expect(r.due).toHaveLength(0);
    expect(r.dueAt["h1:22"]).toBeGreaterThanOrEqual(1_000);
    expect(r.dueAt["h1:22"]).toBeLessThan(1_000 + STARTUP_SPREAD_MS);
  });

  test("probes a session-backed target immediately on first appearance", () => {
    const r = selectDue([target({ sessionId: "s1" })], {}, 1_000, SESSION_MS, IDLE_MS);
    expect(r.due.map((t) => t.key)).toEqual(["h1:22"]);
    expect(r.dueAt["h1:22"]).toBeGreaterThanOrEqual(1_000 + SESSION_MS);
  });

  test("probes once the due time is reached", () => {
    const first = selectDue([target()], {}, 0, SESSION_MS, IDLE_MS);
    const r = selectDue([target()], first.dueAt, STARTUP_SPREAD_MS, SESSION_MS, IDLE_MS);
    expect(r.due.map((t) => t.key)).toEqual(["h1:22"]);
  });

  test("reschedules at least one interval out after probing", () => {
    const first = selectDue([target()], {}, 0, SESSION_MS, IDLE_MS);
    const now = STARTUP_SPREAD_MS;
    const r = selectDue([target()], first.dueAt, now, SESSION_MS, IDLE_MS);
    expect(r.dueAt["h1:22"]).toBeGreaterThanOrEqual(now + IDLE_MS);
  });

  test("leaves a not-yet-due target untouched", () => {
    const r = selectDue([target()], { "h1:22": 50_000 }, 10_000, SESSION_MS, IDLE_MS);
    expect(r.due).toHaveLength(0);
    expect(r.dueAt["h1:22"]).toBe(50_000);
  });

  test("forgets targets that disappeared", () => {
    const r = selectDue([], { "gone:22": 10 }, 20, SESSION_MS, IDLE_MS);
    expect(r.dueAt).toEqual({});
  });

  test("repeated calls at the same instant do not re-probe", () => {
    const first = selectDue([target()], {}, 0, SESSION_MS, IDLE_MS);
    const now = STARTUP_SPREAD_MS;
    const second = selectDue([target()], first.dueAt, now, SESSION_MS, IDLE_MS);
    expect(second.due).toHaveLength(1);
    const third = selectDue([target()], second.dueAt, now, SESSION_MS, IDLE_MS);
    expect(third.due).toHaveLength(0);
  });
});

describe("confirmDown", () => {
  test("a single failed probe is not reported as down", () => {
    expect(confirmDown(new Map(), "h1:22", 1_000)).toBe(false);
  });

  test("failures spanning the confirm window are reported as down", () => {
    const failingSince = new Map<string, number>();
    expect(confirmDown(failingSince, "h1:22", 0)).toBe(false);
    expect(confirmDown(failingSince, "h1:22", DOWN_RETRY_MS)).toBe(false);
    expect(confirmDown(failingSince, "h1:22", DOWN_CONFIRM_MS)).toBe(true);
  });

  test("once confirmed, later failures stay down", () => {
    const failingSince = new Map([["h1:22", 0]]);
    expect(confirmDown(failingSince, "h1:22", DOWN_CONFIRM_MS + IDLE_MS)).toBe(true);
  });

  test("a success in between restarts the window", () => {
    const failingSince = new Map<string, number>();
    confirmDown(failingSince, "h1:22", 0);
    failingSince.delete("h1:22");
    expect(confirmDown(failingSince, "h1:22", DOWN_CONFIRM_MS)).toBe(false);
  });

  test("retries well inside the confirm window", () => {
    expect(DOWN_RETRY_MS * 2).toBeLessThanOrEqual(DOWN_CONFIRM_MS);
  });
});
