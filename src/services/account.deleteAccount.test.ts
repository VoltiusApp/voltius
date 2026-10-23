import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  fetchAuth: vi.fn(),
  resetVault: vi.fn(async () => undefined),
  store: {} as Record<string, string | null>,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/i18n", () => ({ default: { t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k) } }));
vi.mock("@/services/http", () => ({ appFetch: vi.fn(), isAbortError: () => false }));
vi.mock("@/services/authFetch", () => ({ fetchAuth: h.fetchAuth }));
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
vi.mock("@/services/sync", () => ({ push: vi.fn(async () => undefined), isSyncPaused: () => false, stopRealtimeSync: vi.fn() }));
vi.mock("@/services/teamDataManager", () => ({ onSessionEnd: vi.fn() }));
vi.mock("@/services/savedAccounts", () => ({ removeSavedAccount: vi.fn(async () => undefined) }));

import { deleteAccount } from "./account";

beforeEach(() => {
  vi.clearAllMocks();
  h.store = { account_id: "acct-1", server_url: "https://api.example.test" };
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) =>
    cmd === "keychain_get" ? h.store[args.key as string] ?? null : undefined);
});

test("deletes the account on the server, then signs this device out", async () => {
  h.fetchAuth.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await deleteAccount();
  expect(h.fetchAuth).toHaveBeenCalledWith("https://api.example.test/v1/auth/account", { method: "DELETE" });
  expect(h.resetVault).toHaveBeenCalled();
});

/** A failed delete must leave the session alone: the account still exists, so wiping the device would only lose data. */
test("a server error keeps the device signed in", async () => {
  h.fetchAuth.mockResolvedValueOnce(new Response(null, { status: 500 }));
  await expect(deleteAccount()).rejects.toThrow(/shared\.deleteAccount\.failed.*500/);
  expect(h.resetVault).not.toHaveBeenCalled();
});

test("owning a team with members surfaces the coded refusal", async () => {
  h.fetchAuth.mockResolvedValueOnce(new Response(
    JSON.stringify({ error: "OWNS_TEAM_WITH_MEMBERS", teams: [{ id: "t1", name: "Ops", other_members: 1 }] }),
    { status: 409, headers: { "Content-Type": "application/json" } },
  ));
  await expect(deleteAccount()).rejects.toThrow(/shared\.deleteAccount\.ownsTeamWithMembers.*Ops/);
  expect(h.resetVault).not.toHaveBeenCalled();
});

test("a failed subscription cancellation keeps the device signed in", async () => {
  h.fetchAuth.mockResolvedValueOnce(new Response(
    JSON.stringify({ error: "SUBSCRIPTION_CANCEL_FAILED" }),
    { status: 502, headers: { "Content-Type": "application/json" } },
  ));
  await expect(deleteAccount()).rejects.toThrow("shared.deleteAccount.subscriptionCancelFailed");
  expect(h.resetVault).not.toHaveBeenCalled();
});

test("refuses without a server to talk to", async () => {
  h.store = { account_id: "acct-1" };
  await expect(deleteAccount()).rejects.toThrow("common.error.notConnectedToServer");
  expect(h.fetchAuth).not.toHaveBeenCalled();
  expect(h.resetVault).not.toHaveBeenCalled();
});

test("an expired session surfaces without wiping the device", async () => {
  h.fetchAuth.mockRejectedValueOnce(new Error("common.error.sessionExpired"));
  await expect(deleteAccount()).rejects.toThrow("common.error.sessionExpired");
  expect(h.resetVault).not.toHaveBeenCalled();
});
