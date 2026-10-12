import { test, expect } from "vitest";
import { signOutRisk } from "./signOutRisk";

test("an account without a plan has no copy on the server", () => {
  expect(signOutRisk({ isPro: false, paused: false, status: "success" })).toBe("no-server-copy");
});

test("a synced account loses nothing by signing out", () => {
  expect(signOutRisk({ isPro: true, paused: false, status: "success" })).toBeNull();
  expect(signOutRisk({ isPro: true, paused: false, status: "idle" })).toBeNull();
  expect(signOutRisk({ isPro: true, paused: false, status: "syncing" })).toBeNull();
});

test.each(["offline", "error"] as const)("a sync left %s may be behind this device", (status) => {
  expect(signOutRisk({ isPro: true, paused: false, status })).toBe("unsynced");
});

test("a paused device may be ahead of the server", () => {
  expect(signOutRisk({ isPro: true, paused: true, status: "success" })).toBe("unsynced");
});

test("no plan outranks a paused sync: there is nothing on the server at all", () => {
  expect(signOutRisk({ isPro: false, paused: true, status: "offline" })).toBe("no-server-copy");
});
