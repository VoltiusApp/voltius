import { test, expect, vi, beforeEach, afterEach, describe } from "vitest";
import { routeVaultSecret } from "@/test/vaultSecretRoute";

const h = vi.hoisted(() => ({ invoke: vi.fn(), store: {} as Record<string, string | null> }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));

import {
  importSecret, readPlainSecret, rememberDeviceKey, rememberPassword, replacePassword, storeDeviceKey, storePassword, unbindSecret,
} from "./vaultSecret";
import { useSecurityStore } from "@/stores/securityStore";
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

describe("with Remember master password off", () => {
  beforeEach(() => useSecurityStore.setState({ rememberMasterPassword: false }));
  afterEach(() => useSecurityStore.setState({ rememberMasterPassword: true }));

  test("rememberPassword writes nothing and removes a plain copy already there", async () => {
    h.store.master_password = "pw";
    await rememberPassword("pw");
    expect(h.store.master_password).toBeUndefined();
    expect(h.invoke).not.toHaveBeenCalledWith("vault_secret_set", expect.anything());
  });

  test("rememberPassword still leaves a sealed secret alone", async () => {
    h.store.master_password_sealed = "S:pw";
    await rememberPassword("pw");
    expect(h.store.master_password_sealed).toBe("S:pw");
  });

  test("storePassword and importSecret clear instead of writing plain; a sealed import still lands", async () => {
    h.store.master_password = "old";
    await storePassword("pw");
    expect(h.store.master_password).toBeUndefined();
    await importSecret({ kind: "plain", value: "pw" });
    expect(h.store.master_password).toBeUndefined();
    await importSecret({ kind: "sealed", value: "S:pw" });
    expect(h.store.master_password_sealed).toBe("S:pw");
  });

  test("replacePassword drops an unsealed copy rather than writing the new password", async () => {
    h.store.master_password = "old";
    expect(await replacePassword("new", "r")).toBe("ok");
    expect(h.store.master_password).toBeUndefined();
  });

  test("a reseal that fails over to a plain copy in the backend leaves no plain copy", async () => {
    h.store.master_password_sealed = "S:old";
    h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      // vault_secret.rs `set`: a seal that is cancelled imports the new value in plain form.
      if (cmd === "vault_secret_set") {
        delete h.store.master_password_sealed;
        h.store.master_password = args.value as string;
        return "cancelled";
      }
      return routeVaultSecret(h.store, cmd, args).value;
    });
    expect(await replacePassword("new", "r")).toBe("cancelled");
    expect(h.store.master_password).toBeUndefined();
  });

  test("unbinding leaves no plain copy behind", async () => {
    h.store.master_password_sealed = "S:pw";
    expect(await unbindSecret("r")).toBe("ok");
    expect(h.store.master_password).toBeUndefined();
    expect(h.store.master_password_sealed).toBeUndefined();
  });

  test("a no-password account's key is stored and kept regardless", async () => {
    await storeDeviceKey("ab".repeat(32));
    expect(h.store.master_password).toBe("ab".repeat(32));
    await rememberDeviceKey("cd".repeat(32));
    expect(h.store.master_password).toBe("cd".repeat(32));
  });
});
