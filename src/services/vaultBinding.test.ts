import { test, expect, vi, beforeEach } from "vitest";
import { routeVaultSecret } from "@/test/vaultSecretRoute";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  store: {} as Record<string, string | null>,
  sealAvailable: true,
  bindResult: "ok",
  openResult: "ok",
  verify: vi.fn(async () => "ok"),
  systemAuthUnlock: true,
  forgetOthers: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/account", () => ({
  openWithStoredSecret: vi.fn(async () => h.openResult),
  getAccountMode: vi.fn(async () => h.store.mode ?? null),
  isCurrentMasterPassword: vi.fn(async (p: string) => p === "pw"),
}));
vi.mock("@/services/appLock", () => ({ systemAuthVerify: h.verify }));
vi.mock("@/services/savedAccounts", () => ({ forgetOtherPlainPasswords: h.forgetOthers }));
vi.mock("@/stores/securityStore", () => ({
  useSecurityStore: { getState: () => ({ systemAuthUnlock: h.systemAuthUnlock }) },
}));

import {
  bindNow, bindingStatus, disableBinding, disableWithPassword, enableBinding,
  rebindAfterPassword, unlockWithSystemAuth, verifyForLockScreen,
} from "./vaultBinding";

beforeEach(() => {
  h.store = { mode: "local" };
  h.sealAvailable = true;
  h.bindResult = "ok";
  h.openResult = "ok";
  h.systemAuthUnlock = true;
  h.verify.mockClear();
  h.forgetOthers.mockClear();
  h.invoke.mockReset();
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "vault_secret_seal_available") return h.sealAvailable;
    if (cmd === "vault_secret_bind" && h.bindResult !== "ok") return h.bindResult;
    return routeVaultSecret(h.store, cmd, args).value;
  });
});

test("a plain secret binds through the unlock prompt instead of a presence check", async () => {
  h.store.master_password = "pw";
  expect(await unlockWithSystemAuth("r")).toBe("ok");
  expect(h.verify).not.toHaveBeenCalled();
  expect(h.store.master_password_sealed).toBe("S:pw");
  expect(h.store.master_password).toBeUndefined();
});

test("a device that cannot seal keeps the presence check", async () => {
  h.sealAvailable = false;
  h.store.master_password = "pw";
  expect(await unlockWithSystemAuth("r")).toBe("ok");
  expect(h.verify).toHaveBeenCalled();
  expect(h.store.master_password).toBe("pw");
});

test("a no-password account is never bound", async () => {
  h.store.mode = "local-nopassword";
  h.store.master_password = "a".repeat(64);
  await unlockWithSystemAuth("r");
  expect(h.store.master_password_sealed).toBeUndefined();
});

test("a cancelled bind leaves the account unbound and locked", async () => {
  h.store.master_password = "pw";
  h.bindResult = "cancelled";
  expect(await unlockWithSystemAuth("r")).toBe("cancelled");
  expect(h.store.master_password).toBe("pw");
});

test("a sealed secret unlocks after the prompt", async () => {
  h.store.master_password_sealed = "S:pw";
  expect(await unlockWithSystemAuth("r")).toBe("ok");
  expect(h.store.master_password_sealed).toBe("S:pw");
});

test("stale blob is dropped and reported as invalidated", async () => {
  h.store.master_password_sealed = "S:old";
  h.openResult = "wrong-key";
  expect(await unlockWithSystemAuth("r")).toBe("invalidated");
  expect(h.store.master_password_sealed).toBeUndefined();
});

test("unseal with the toggle off restores the plain entry", async () => {
  h.systemAuthUnlock = false;
  h.store.master_password_sealed = "S:pw";
  expect(await unlockWithSystemAuth("r")).toBe("ok");
  expect(h.store.master_password).toBe("pw");
  expect(h.store.master_password_sealed).toBeUndefined();
});

test("the lock screen migrates an unbound device with one prompt", async () => {
  h.store.master_password = "pw";
  expect(await verifyForLockScreen("r")).toBe("ok");
  expect(h.verify).not.toHaveBeenCalled();
  expect(h.store.master_password_sealed).toBe("S:pw");
});

test("the lock screen of a bound device uses the presence check", async () => {
  h.store.master_password_sealed = "S:pw";
  expect(await verifyForLockScreen("r")).toBe("ok");
  expect(h.verify).toHaveBeenCalled();
});

test("rebind after a password unlock seals when the toggle is on", async () => {
  h.store.master_password = "pw";
  await rebindAfterPassword("pw", "r");
  expect(h.store.master_password_sealed).toBe("S:pw");
});

test("rebind after a password unlock does nothing with the toggle off", async () => {
  h.systemAuthUnlock = false;
  h.store.master_password = "pw";
  await rebindAfterPassword("pw", "r");
  expect(h.store.master_password_sealed).toBeUndefined();
});

test("enabling checks the password before sealing", async () => {
  h.store.master_password = "pw";
  expect(await enableBinding("nope", "r")).toBe("wrong-password");
  expect(h.store.master_password_sealed).toBeUndefined();
  expect(await enableBinding("pw", "r")).toBe("ok");
  expect(h.store.master_password_sealed).toBe("S:pw");
});

test("disabling restores the plain entry", async () => {
  h.store.master_password_sealed = "S:pw";
  expect(await disableBinding("r")).toBe("ok");
  expect(h.store.master_password).toBe("pw");
});

test("disabling with the password works when the prompt cannot", async () => {
  h.store.master_password_sealed = "S:pw";
  expect(await disableWithPassword("nope")).toBe(false);
  expect(h.store.master_password_sealed).toBe("S:pw");
  expect(await disableWithPassword("pw")).toBe(true);
  expect(h.store.master_password).toBe("pw");
  expect(h.store.master_password_sealed).toBeUndefined();
});

test("bind now seals the plain secret without asking for the password", async () => {
  h.store.master_password = "pw";
  expect(await bindNow("r")).toBe("ok");
  expect(h.store.master_password_sealed).toBe("S:pw");
});

test("status names the protection level", async () => {
  h.store.master_password_sealed = "S:pw";
  expect(await bindingStatus("local")).toBe("bound");
  delete h.store.master_password_sealed;
  h.store.master_password = "pw";
  expect(await bindingStatus("local")).toBe("unbound");
  h.sealAvailable = false;
  expect(await bindingStatus("local")).toBe("os-login");
  h.sealAvailable = true;
  expect(await bindingStatus("local-nopassword")).toBe("no-password");
});

test("an unlock that fails for another reason keeps the sealed secret", async () => {
  h.store.master_password_sealed = "S:pw";
  h.openResult = "declined";
  expect(await unlockWithSystemAuth("r")).toBe("failed");
  expect(h.store.master_password_sealed).toBe("S:pw");
});

test("binding drops the plaintext copies other saved accounts hold", async () => {
  h.store.master_password = "pw";
  await enableBinding("pw", "r");
  expect(h.forgetOthers).toHaveBeenCalled();
});

test("a cancelled bind leaves other saved accounts alone", async () => {
  h.store.master_password = "pw";
  h.bindResult = "cancelled";
  await bindNow("r");
  expect(h.forgetOthers).not.toHaveBeenCalled();
});
