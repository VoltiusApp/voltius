import { describe, expect, test } from "vitest";
import { STARTUP_SPREAD_MS, intervalFor, jitterFor, selectDue } from "./schedule";
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
  test("does not probe a target on first appearance, but schedules it soon", () => {
    const r = selectDue([target()], {}, 1_000, SESSION_MS, IDLE_MS);
    expect(r.due).toHaveLength(0);
    expect(r.dueAt["h1:22"]).toBeGreaterThanOrEqual(1_000);
    expect(r.dueAt["h1:22"]).toBeLessThan(1_000 + STARTUP_SPREAD_MS);
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
