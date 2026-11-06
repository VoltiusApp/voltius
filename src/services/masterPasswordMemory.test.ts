import { beforeEach, expect, test, vi } from "vitest";
import { routeVaultSecret } from "@/test/vaultSecretRoute";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  store: {} as Record<string, string>,
  forgetSaved: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/account", () => ({
  getAccountMode: async () => h.store.mode ?? null,
  isCurrentMasterPassword: async (pw: string) => pw === "pw",
}));
vi.mock("@/services/savedAccounts", () => ({ forgetSavedPlainPasswords: h.forgetSaved }));

import { startRememberingMasterPassword, stopRememberingMasterPassword } from "./masterPasswordMemory";
import { useSecurityStore } from "@/stores/securityStore";

beforeEach(() => {
  vi.clearAllMocks();
  h.store = {};
  useSecurityStore.setState({ rememberMasterPassword: true });
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => routeVaultSecret(h.store, cmd, args).value);
});

test("turning it off deletes this account's plain copy and the switcher's", async () => {
  h.store = { mode: "server", master_password: "pw" };
  await stopRememberingMasterPassword();
  expect(useSecurityStore.getState().rememberMasterPassword).toBe(false);
  expect(h.store.master_password).toBeUndefined();
  expect(h.forgetSaved).toHaveBeenCalledTimes(1);
});

test("turning it off keeps a sealed copy", async () => {
  h.store = { mode: "local", master_password_sealed: "S:pw" };
  await stopRememberingMasterPassword();
  expect(h.store.master_password_sealed).toBe("S:pw");
});

test("turning it off never touches a no-password account's key", async () => {
  h.store = { mode: "local-nopassword", master_password: "ab".repeat(32) };
  await stopRememberingMasterPassword();
  expect(h.store.master_password).toBe("ab".repeat(32));
});

test("turning it on stores the password only once it is proven current", async () => {
  useSecurityStore.setState({ rememberMasterPassword: false });
  h.store = { mode: "local" };
  expect(await startRememberingMasterPassword("nope")).toBe(false);
  expect(useSecurityStore.getState().rememberMasterPassword).toBe(false);
  expect(h.store.master_password).toBeUndefined();
  expect(await startRememberingMasterPassword("pw")).toBe(true);
  expect(useSecurityStore.getState().rememberMasterPassword).toBe(true);
  expect(h.store.master_password).toBe("pw");
});
