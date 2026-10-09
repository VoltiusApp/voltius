import { test, expect, vi, beforeEach } from "vitest";
import { routeVaultSecret } from "@/test/vaultSecretRoute";

const h = vi.hoisted(() => ({ invoke: vi.fn(), store: {} as Record<string, string | null> }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));

import { readPlainSecret, rememberPassword, replacePassword } from "./vaultSecret";
import { isLeaveLockSuppressed } from "./leaveLockSuppression";

beforeEach(() => {
  h.store = {};
  h.invoke.mockReset();
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => routeVaultSecret(h.store, cmd, args).value);
});

test("rememberPassword writes plain when unbound", async () => {
  await rememberPassword("pw");
  expect(h.store.master_password).toBe("pw");
});

test("rememberPassword leaves a sealed secret alone", async () => {
  h.store.master_password_sealed = "S:old";
  await rememberPassword("pw");
  expect(h.invoke).not.toHaveBeenCalledWith("vault_secret_set", expect.anything());
  expect(h.store.master_password_sealed).toBe("S:old");
});

test("readPlainSecret never reads a sealed secret", async () => {
  h.store.master_password_sealed = "S:pw";
  expect(await readPlainSecret()).toBeNull();
  expect(h.invoke).not.toHaveBeenCalledWith("vault_secret_get", expect.anything());
});

test("prompting calls hold the leave-lock suppression", async () => {
  let held = false;
  h.invoke.mockImplementation(async () => { held = isLeaveLockSuppressed(); return "ok"; });
  await replacePassword("pw", "r");
  expect(held).toBe(true);
});
