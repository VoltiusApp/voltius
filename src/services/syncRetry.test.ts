import { test, expect } from "vitest";
import { SSE_RETRY_MAX_MS, SSE_RETRY_MIN_MS, sseRetryDelay } from "./syncRetry";

const mid = () => 0.5;

test("the wait doubles with every failed attempt", () => {
  expect([1, 2, 3, 4].map((n) => sseRetryDelay(n, mid))).toEqual([5_000, 10_000, 20_000, 40_000]);
});

test("the wait stops growing at the cap", () => {
  expect(sseRetryDelay(7, mid)).toBe(SSE_RETRY_MAX_MS);
  expect(sseRetryDelay(500, mid)).toBe(SSE_RETRY_MAX_MS);
});

test("a stream that just dropped is retried at the shortest wait", () => {
  expect(sseRetryDelay(0, mid)).toBe(SSE_RETRY_MIN_MS);
});

test("jitter spreads clients a fifth either side of the schedule", () => {
  expect(sseRetryDelay(1, () => 0)).toBe(4_000);
  expect(sseRetryDelay(1, () => 1)).toBe(6_000);
});
