import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  unlockError: null as Error | null,
  getError: null as Error | null,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/stores/persistedAccountUiState", () => ({ clearPersistedAccountUiState: vi.fn() }));

import { setVaultKey, getSecret, quarantineVault, unlockVaultIfNeeded } from "./vault";
import { VaultLockedError, VaultUnreadableError, vaultErrorCode } from "./vaultErrors";

const KEY = [1, 2, 3];
const WRONG_KEY = new Error("Decryption failed — wrong key or corrupted file");

function routeInvoke() {
  h.invoke.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "secrets_unlock":
        if (h.unlockError) throw h.unlockError;
        return undefined;
      case "secrets_get":
        if (h.getError) throw h.getError;
        return "value";
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
  routeInvoke();
  setVaultKey(KEY);
});

test("an unreadable vault raises VaultUnreadableError instead of destroying the file", async () => {
  // #134's second half: the file was readable with another key and got deleted.
  h.unlockError = WRONG_KEY;
  await expect(getSecret("password:c1")).rejects.toThrow(VaultUnreadableError);
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
  await expect(getSecret("password:c1")).rejects.toThrow("permission denied");
});

test("no vault key installed reports the vault as locked", async () => {
  setVaultKey(null as unknown as number[]);
  await expect(getSecret("password:c1")).rejects.toThrow("common.error.vaultLocked");
});

// Rust answers a locked store with a bare string. Without a code it reaches the
// generic error panel instead of the one offering to unlock.
test("a locked store reported by Rust carries the vault-locked code", async () => {
  h.getError = new Error("Secrets store is locked");
  await expect(getSecret("password:c1")).rejects.toSatisfy(
    (e: unknown) => vaultErrorCode(e) === "vault-locked",
  );
});

// The store can only answer "locked" while the module thinks it is unlocked, so
// that flag has drifted and must not be trusted again.
test("a locked store clears the unlocked flag so the next read unlocks again", async () => {
  h.getError = new Error("Secrets store is locked");
  await expect(getSecret("password:c1")).rejects.toThrow(VaultLockedError);

  h.getError = null;
  await expect(getSecret("password:c1")).resolves.toBe("value");
  expect(h.invoke.mock.calls.filter(([c]) => c === "secrets_unlock")).toHaveLength(2);
});

test("quarantining sets the file aside and leaves the store ready to unlock again", async () => {
  h.unlockError = WRONG_KEY;
  await expect(unlockVaultIfNeeded()).rejects.toThrow(VaultUnreadableError);

  expect(await quarantineVault()).toBe("secrets.enc.1700000000.bak");

  h.unlockError = null;
  await expect(getSecret("password:c1")).resolves.toBe("value");
});
