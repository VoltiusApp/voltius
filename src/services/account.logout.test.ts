import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  resetVault: vi.fn(async () => undefined),
  removeSavedAccount: vi.fn(async () => undefined),
  store: {} as Record<string, string | null>,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/http", () => ({ appFetch: vi.fn(), isAbortError: () => false }));
vi.mock("./vault", () => ({
  setVaultKey: vi.fn(),
  verifyVaultKey: vi.fn(async () => undefined),
  lockVault: vi.fn(async () => undefined),
  getVaultStatus: vi.fn(async () => ({ exists: false, path: "" })),
  unlockVaultIfNeeded: vi.fn(async () => undefined),
  wipeLocalConfig: vi.fn(async () => undefined),
  resetVault: h.resetVault,
}));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: { getState: () => ({ load: vi.fn(async () => undefined) }) },
}));
vi.mock("@/stores/vaultKeysStore", () => ({
  useVaultKeysStore: { getState: () => ({ set: vi.fn(), clear: vi.fn(), dek: null, x25519Private: null }) },
}));
vi.mock("@/services/sync", () => ({ push: vi.fn(async () => undefined), stopRealtimeSync: vi.fn() }));
vi.mock("@/services/teamDataManager", () => ({ onSessionEnd: vi.fn() }));
vi.mock("@/services/savedAccounts", () => ({ removeSavedAccount: h.removeSavedAccount }));

import { logout } from "./account";

beforeEach(() => {
  vi.clearAllMocks();
  h.store = { account_id: "acct-1" };
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) =>
    cmd === "keychain_get" ? h.store[args.key as string] ?? null : undefined);
});

/**
 * Sign-out clears the keychain, but the quick switcher keeps its own copy of the
 * master password. Left behind, it lets anyone re-enter the account from the
 * account menu with no password at all.
 */
test("signing out drops the account from the quick switcher", async () => {
  await logout();
  expect(h.removeSavedAccount).toHaveBeenCalledWith("acct-1");
  expect(h.resetVault).toHaveBeenCalled();
});

test("signing out still resets the vault when there is no account id", async () => {
  h.store = {};
  await logout();
  expect(h.removeSavedAccount).not.toHaveBeenCalled();
  expect(h.resetVault).toHaveBeenCalled();
});

test("a failing switcher cleanup never blocks the sign-out", async () => {
  h.removeSavedAccount.mockRejectedValueOnce(new Error("keychain unavailable"));
  await expect(logout()).resolves.toBeUndefined();
  expect(h.resetVault).toHaveBeenCalled();
});
