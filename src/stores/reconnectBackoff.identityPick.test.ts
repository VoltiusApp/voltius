import { test, expect, vi, afterEach } from "vitest";
import { runBackoff, strandedByNetwork, type BackoffStore } from "./reconnectBackoffCore.ts";

afterEach(() => vi.useRealTimers());

test("an unavailable identity pick stops the loop after one attempt and keeps the issue", async () => {
  vi.useFakeTimers();
  const issue = { connectionId: "c1", connectionName: "db-01", via: "pick" as const, reason: "missing" as const, hasFallback: false };
  const store: BackoffStore = {
    status: () => "connecting",
    exists: () => true,
    online: () => true,
    markReconnecting: vi.fn(),
    markConnected: vi.fn(),
    setWait: vi.fn(),
    sessionEnded: vi.fn(),
    markError: vi.fn(),
    attempt: vi.fn(async () => ({ ok: false, errorMessage: "Your identity for db-01 isn't available", identityPick: issue })),
  };

  const done = runBackoff("s-pick", store);
  await vi.runAllTimersAsync();

  expect(await done).toBe(false);
  expect(store.attempt).toHaveBeenCalledTimes(1);
  expect(store.markError).toHaveBeenCalledWith("s-pick", "Your identity for db-01 isn't available", undefined, issue);
});

test("the network coming back leaves a tab waiting on an identity choice alone", () => {
  const issue = { connectionId: "c1", connectionName: "db-01", via: "pick" as const, reason: "missing" as const, hasFallback: false };
  const tab = { type: "ssh", status: "error" as const, errorMessage: "Your identity for db-01 isn't available" };
  expect(strandedByNetwork(tab)).toBe(true);
  expect(strandedByNetwork({ ...tab, identityPick: issue })).toBe(false);
});
