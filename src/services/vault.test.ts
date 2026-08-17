import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  unlockError: null as Error | null,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/stores/persistedAccountUiState", () => ({ clearPersistedAccountUiState: vi.fn() }));

import { setVaultKey, getSecret, quarantineVault, unlockVaultIfNeeded } from "./vault";
import { VaultUnreadableError } from "./vaultErrors";

const KEY = [1, 2, 3];
const WRONG_KEY = new Error("Decryption failed — wrong key or corrupted file");

function routeInvoke() {
  h.invoke.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "secrets_unlock":
        if (h.unlockError) throw h.unlockError;
        return undefined;
      case "secrets_get":
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

test("quarantining sets the file aside and leaves the store ready to unlock again", async () => {
  h.unlockError = WRONG_KEY;
  await expect(unlockVaultIfNeeded()).rejects.toThrow(VaultUnreadableError);

  expect(await quarantineVault()).toBe("secrets.enc.1700000000.bak");

  h.unlockError = null;
  await expect(getSecret("password:c1")).resolves.toBe("value");
});
