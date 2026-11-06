// @vitest-environment jsdom
import { test, expect, beforeEach } from "vitest";
import { useSecurityStore } from "./securityStore";
import { ACCOUNT_SCOPED_STORAGE_KEYS, DEVICE_SCOPED_STORAGE_KEYS } from "./persistedAccountUiState";
import { SETTING_KEYS } from "@/services/user-data/settingKeys";
import { POLICY_KEYS } from "@/services/policy/policyKeys";
import { settingDefs } from "@/plugins/domains/settingsManifest";

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

test("Remember master password is on by default, so existing installs keep unlocking at launch", async () => {
  localStorage.setItem("voltius-security", JSON.stringify({ state: { systemAuthUnlock: true }, version: 0 }));
  await useSecurityStore.persist.rehydrate();
  expect(useSecurityStore.getState().rememberMasterPassword).toBe(true);
});

test("Remember master password is kept on this device, readable before unlock", () => {
  useSecurityStore.getState().setRememberMasterPassword(false);
  expect(JSON.parse(localStorage.getItem("voltius-security")!).state.rememberMasterPassword).toBe(false);
  // Device-scoped: an account switch or sign-out leaves it, and no account's state carries it away.
  expect(DEVICE_SCOPED_STORAGE_KEYS).toContain("voltius-security");
  expect(ACCOUNT_SCOPED_STORAGE_KEYS).not.toContain("voltius-security");
  useSecurityStore.getState().setRememberMasterPassword(true);
});

test("neither sync, a team policy, a plugin nor MCP can turn Remember master password back on", () => {
  const named = (id: string) => /remember/i.test(id);
  // Only SETTING_KEYS leaves ride the app-settings sync bundle.
  expect(SETTING_KEYS.map((k) => k.id).filter(named)).toEqual([]);
  expect(POLICY_KEYS.map((k) => k.id).filter(named)).toEqual([]);
  expect(settingDefs().map((d) => d.key).filter(named)).toEqual([]);
});
