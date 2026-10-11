import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { createWakeableSleeps } from "./wakeableSleep";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("a sleep left alone reports that its delay elapsed", async () => {
  const sleeps = createWakeableSleeps();
  const done = sleeps.sleep("a", 1000);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await done).toBe(false);
  expect(sleeps.sleeping()).toEqual([]);
});

test("waking a sleep ends it early and reports the wake", async () => {
  const sleeps = createWakeableSleeps();
  const done = sleeps.sleep("a", 60_000);
  expect(sleeps.sleeping()).toEqual(["a"]);
  expect(sleeps.wake("a")).toBe(true);
  expect(await done).toBe(true);
  expect(sleeps.sleeping()).toEqual([]);
});

test("waking a key nobody sleeps on reports nothing woken", () => {
  expect(createWakeableSleeps().wake("a")).toBe(false);
});
