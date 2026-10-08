import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  unlockError: null as unknown,
  getError: null as unknown,
  verifyError: null as unknown,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/stores/persistedAccountUiState", () => ({ clearPersistedAccountUiState: vi.fn() }));

import {
  setVaultKey,
  getLocalSecret,
  purgeLocalSecrets,
  quarantineVault,
  resetVault,
  unlockVaultIfNeeded,
  verifyVaultKey,
  wipeLocalConfig,
} from "./vault";
import { VaultLockedError, VaultUnreadableError, vaultErrorCode } from "./vaultErrors";
import { useOrgLockPolicyStore } from "@/stores/orgLockPolicyStore";

const KEY = [1, 2, 3];
// What secrets.rs sends over IPC (its `a_wrong_key_sends_…`/`a_locked_store_sends_…` tests).
const WRONG_KEY = { code: "vault-unreadable", message: "Decryption failed — wrong key or corrupted file" };
const LOCKED = { code: "vault-locked", message: "Secrets store is locked" };

function routeInvoke() {
  h.invoke.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "secrets_unlock":
        if (h.unlockError) throw h.unlockError;
        return undefined;
      case "secrets_get":
        if (h.getError) throw h.getError;
        return "value";
      case "secrets_verify":
        if (h.verifyError) throw h.verifyError;
        return undefined;
      case "secrets_quarantine":
        return "secrets.enc.1700000000.bak";
      default:
        return undefined;
    }
  });
}

const invoked = (cmd: string) => h.invoke.mock.calls.some(([c]) => c === cmd);

beforeEach(() => {
  h.invoke.mockReset();
  h.unlockError = null;
  h.getError = null;
  h.verifyError = null;
  routeInvoke();
  setVaultKey(KEY);
});

test("an unreadable vault raises VaultUnreadableError instead of destroying the file", async () => {
  // #134's second half: the file was readable with another key and got deleted.
  h.unlockError = WRONG_KEY;
  await expect(getLocalSecret("password:c1")).rejects.toThrow(VaultUnreadableError);
  expect(invoked("secrets_wipe")).toBe(false);
  expect(invoked("secrets_quarantine")).toBe(false);
});

test("a key mismatch in server mode is not self-healed", async () => {
  h.unlockError = WRONG_KEY;
  await expect(unlockVaultIfNeeded()).rejects.toThrow(VaultUnreadableError);
  expect(invoked("keychain_get")).toBe(false);
  expect(invoked("secrets_wipe")).toBe(false);
});

test("unlock failures other than a key mismatch propagate unchanged", async () => {
  h.unlockError = new Error("Read failed: permission denied");
  await expect(getLocalSecret("password:c1")).rejects.toThrow("permission denied");
});

test("no vault key installed reports the vault as locked", async () => {
  setVaultKey(null as unknown as number[]);
  await expect(getLocalSecret("password:c1")).rejects.toThrow("common.error.vaultLocked");
});

// Without a VaultLockedError, Rust's locked store reaches the generic error panel
// instead of the one offering to unlock.
test("a locked store reported by Rust carries the vault-locked code", async () => {
  h.getError = LOCKED;
  await expect(getLocalSecret("password:c1")).rejects.toSatisfy(
    (e: unknown) => vaultErrorCode(e) === "vault-locked",
  );
});

// The store can only answer "locked" while the module thinks it is unlocked, so
// that flag has drifted and must not be trusted again.
test("a locked store clears the unlocked flag so the next read unlocks again", async () => {
  h.getError = LOCKED;
  await expect(getLocalSecret("password:c1")).rejects.toThrow(VaultLockedError);

  h.getError = null;
  await expect(getLocalSecret("password:c1")).resolves.toBe("value");
  expect(h.invoke.mock.calls.filter(([c]) => c === "secrets_unlock")).toHaveLength(2);
});

test("verifyVaultKey types a failed decrypt so callers can read it as a wrong key", async () => {
  h.verifyError = WRONG_KEY;
  await expect(verifyVaultKey(KEY)).rejects.toThrow(VaultUnreadableError);
});

test("verifyVaultKey leaves a read failure untyped so it is not read as a wrong key", async () => {
  h.verifyError = new Error("Read failed: permission denied");
  await expect(verifyVaultKey(KEY)).rejects.not.toBeInstanceOf(VaultUnreadableError);
});

test("quarantining sets the file aside and leaves the store ready to unlock again", async () => {
  h.unlockError = WRONG_KEY;
  await expect(unlockVaultIfNeeded()).rejects.toThrow(VaultUnreadableError);

  expect(await quarantineVault()).toBe("secrets.enc.1700000000.bak");

  h.unlockError = null;
  await expect(getLocalSecret("password:c1")).resolves.toBe("value");
});

test("purgeLocalSecrets sends every key in one call, and none when there are none", async () => {
  h.invoke.mockImplementation(async (cmd: string) => (cmd === "secrets_purge" ? ["password:c1"] : undefined));
  await expect(purgeLocalSecrets(["password:c1", "key:c2"])).resolves.toEqual(["password:c1"]);
  expect(h.invoke).toHaveBeenCalledWith("secrets_purge", { keys: ["password:c1", "key:c2"] });

  h.invoke.mockClear();
  await expect(purgeLocalSecrets([])).resolves.toEqual([]);
  expect(h.invoke).not.toHaveBeenCalled();
});

test("secrets carried through a wipe land in the next vault on its first unlock, once", async () => {
  const keychain: Record<string, string> = {};
  const vault: Record<string, string> = {};
  h.invoke.mockImplementation(async (cmd: string, args?: Record<string, string>) => {
    if (cmd === "keychain_set") keychain[args!.key] = args!.value;
    if (cmd === "keychain_get") return keychain[args!.key] ?? null;
    if (cmd === "keychain_delete") delete keychain[args!.key];
    if (cmd === "secrets_set") vault[args!.key] = args!.value;
    return undefined;
  });

  await wipeLocalConfig({ "proxy_password:__global__": "proxy-pw" });
  expect(invoked("config_wipe")).toBe(true);
  setVaultKey([9, 9, 9]);
  await unlockVaultIfNeeded();

  expect(vault).toEqual({ "proxy_password:__global__": "proxy-pw" });
  expect(keychain).toEqual({});
});

test("a wipe with nothing to carry leaves the keychain alone", async () => {
  await wipeLocalConfig();
  expect(invoked("keychain_set")).toBe(false);
  expect(invoked("config_wipe")).toBe(true);
});

test("resetVault drops the team lock policy held in memory", async () => {
  useOrgLockPolicyStore.setState({ policy: { maxMinutes: 15, forceVault: true } });
  await resetVault();
  expect(useOrgLockPolicyStore.getState().policy).toBeNull();
});
