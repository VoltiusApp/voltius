// @vitest-environment jsdom
import { test, expect, beforeEach } from "vitest";
import { useSecurityStore } from "./securityStore";

beforeEach(() => localStorage.clear());

test("defaults leave every lock feature off", () => {
  const s = useSecurityStore.getState();
  expect(s.sessionTimeoutMinutes).toBeNull();
  expect(s.lockAction).toBe("vault");
  expect(s.systemAuthUnlock).toBe(false);
});

test("a stored state from before #510 keeps today's lock behaviour", async () => {
  localStorage.setItem("voltius-security", JSON.stringify({ state: { sessionTimeoutMinutes: 15 }, version: 0 }));
  await useSecurityStore.persist.rehydrate();
  const s = useSecurityStore.getState();
  expect(s.sessionTimeoutMinutes).toBe(15);
  expect(s.lockAction).toBe("vault");
  expect(s.systemAuthUnlock).toBe(false);
});

test("lock action and system-auth unlock are persisted", () => {
  useSecurityStore.getState().setLockAction("screen");
  useSecurityStore.getState().setSystemAuthUnlock(true);
  const stored = JSON.parse(localStorage.getItem("voltius-security")!).state;
  expect(stored.lockAction).toBe("screen");
  expect(stored.systemAuthUnlock).toBe(true);
});
