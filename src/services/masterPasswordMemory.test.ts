import { beforeEach, expect, test, vi } from "vitest";
import { FORGET, routeVaultSecret } from "@/test/vaultSecretRoute";

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

beforeEach(() => {
  vi.clearAllMocks();
  h.store = {};
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => routeVaultSecret(h.store, cmd, args).value);
});

test("turning it off deletes this account's plain copy and the switcher's", async () => {
  h.store = { mode: "server", master_password: "pw" };
  await stopRememberingMasterPassword();
  expect(h.store[FORGET]).toBe("1");
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
  h.store = { mode: "local", [FORGET]: "1" };
  expect(await startRememberingMasterPassword("nope")).toBe(false);
  expect(h.store[FORGET]).toBe("1");
  expect(h.store.master_password).toBeUndefined();
  expect(await startRememberingMasterPassword("pw")).toBe(true);
  expect(h.store[FORGET]).toBeUndefined();
  expect(h.store.master_password).toBe("pw");
});
