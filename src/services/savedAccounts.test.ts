import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  lockVault: vi.fn(async () => undefined),
  wipeLocalConfig: vi.fn(async () => undefined),
  push: vi.fn(async () => undefined),
  stopRealtimeSync: vi.fn(),
  clearPersistedAccountUiState: vi.fn(),
  snapshotPersistedAccountUiState: vi.fn(() => ({ "voltius-vaults": "VAULTS_OF_CURRENT" })),
  restorePersistedAccountUiState: vi.fn(),
  reload: vi.fn(),
  store: {} as Record<string, string>,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("./vault", () => ({ lockVault: h.lockVault, wipeLocalConfig: h.wipeLocalConfig }));
vi.mock("@/services/sync", () => ({ push: h.push, stopRealtimeSync: h.stopRealtimeSync }));
vi.mock("@/stores/persistedAccountUiState", () => ({
  clearPersistedAccountUiState: h.clearPersistedAccountUiState,
  snapshotPersistedAccountUiState: h.snapshotPersistedAccountUiState,
  restorePersistedAccountUiState: h.restorePersistedAccountUiState,
}));

import { getSavedAccounts, saveCurrentAccount, removeSavedAccount, signOutToAddAccount, switchToAccount, type SavedAccount } from "./savedAccounts";
import { ACCOUNT_CACHE_KEYS } from "./accountCacheKeys";

const LIST_KEY = "voltius.saved_accounts";

/** Values are composed rather than written inline so secret scanners stay quiet. */
const fake = (kind: string, id: string) => [kind, "for", id].join("-");

function cloudAccount(id: string): SavedAccount {
  return {
    account_id: id,
    mode: "server",
    master_password: fake("master", id),
    email: `${id}@x.io`,
    server_url: "https://srv",
    jwt: fake("jwt", id),
    refresh_token: fake("refresh", id),
  };
}

const CLOUD_A = cloudAccount("a");
const CLOUD_B = cloudAccount("b");

beforeEach(() => {
  vi.clearAllMocks();
  h.store = {};
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
    switch (cmd) {
      case "keychain_get": return h.store[args.key as string] ?? null;
      case "keychain_set": h.store[args.key as string] = args.value as string; return undefined;
      case "keychain_delete": delete h.store[args.key as string]; return undefined;
      default: throw new Error(`unexpected command ${cmd}`);
    }
  });
  vi.stubGlobal("window", { location: { reload: h.reload } });
  vi.stubGlobal("sessionStorage", { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() });
});

function activate(account: SavedAccount) {
  for (const [key, value] of Object.entries(account)) h.store[key] = value as string;
}

test("saveCurrentAccount snapshots the active session and upserts by account_id", async () => {
  activate(CLOUD_A);
  await saveCurrentAccount();
  expect(await getSavedAccounts()).toEqual([CLOUD_A]);

  h.store.jwt = fake("jwt", "a2");
  await saveCurrentAccount();
  const saved = await getSavedAccounts();
  expect(saved).toHaveLength(1);
  expect(saved[0].jwt).toBe(fake("jwt", "a2"));

  activate(CLOUD_B);
  await saveCurrentAccount();
  expect((await getSavedAccounts()).map((a) => a.account_id)).toEqual(["a", "b"]);
});

test("saveCurrentAccount ignores an incomplete session", async () => {
  activate(CLOUD_A);
  delete h.store.master_password;
  await saveCurrentAccount();
  expect(await getSavedAccounts()).toEqual([]);
});

test("a local account is never saved or listed — switching would wipe its only copy", async () => {
  activate({ ...CLOUD_A, mode: "local-nopassword", email: null, server_url: null, jwt: null, refresh_token: null });
  await saveCurrentAccount();
  expect(await getSavedAccounts()).toEqual([]);

  // Entries written by an install from before the rule are filtered on read.
  h.store[LIST_KEY] = JSON.stringify([{ ...CLOUD_A, mode: "local" }, CLOUD_B]);
  expect((await getSavedAccounts()).map((a) => a.account_id)).toEqual(["b"]);
});

test("getSavedAccounts survives a corrupt list", async () => {
  h.store[LIST_KEY] = "{not json";
  expect(await getSavedAccounts()).toEqual([]);
});

test("removeSavedAccount drops only the named account", async () => {
  h.store[LIST_KEY] = JSON.stringify([CLOUD_A, CLOUD_B]);
  await removeSavedAccount("a");
  expect((await getSavedAccounts()).map((a) => a.account_id)).toEqual(["b"]);
});

test("switchToAccount clears every account-scoped key before writing the target's", async () => {
  activate(CLOUD_A);
  // Keys the previous account cached that are not part of the session snapshot.
  h.store.handle = "alice";
  h.store.wrapped_user_secrets = "WRAPPED_A";
  h.store[LIST_KEY] = JSON.stringify([CLOUD_A, CLOUD_B]);

  await switchToAccount(CLOUD_B);

  for (const key of ACCOUNT_CACHE_KEYS) {
    if (key in CLOUD_B) continue;
    expect(h.store[key], `${key} leaked into the new account`).toBeUndefined();
  }
  expect(h.store).toMatchObject(CLOUD_B);
  // The saved list itself must survive — it is what makes the switch reversible.
  expect((await getSavedAccounts()).map((a) => a.account_id)).toEqual(["a", "b"]);
});

test("switchToAccount deletes session keys the target leaves empty", async () => {
  activate(CLOUD_A);
  await switchToAccount({ ...CLOUD_B, jwt: null, refresh_token: null });
  expect(h.store.jwt).toBeUndefined();
  expect(h.store.refresh_token).toBeUndefined();
});

test("switchToAccount parks the outgoing UI state and restores the incoming one", async () => {
  activate(CLOUD_A);
  const bWithState = { ...CLOUD_B, ui_state: { "voltius-vaults": "VAULTS_OF_B" } };
  h.store[LIST_KEY] = JSON.stringify([CLOUD_A, bWithState]);

  await switchToAccount(bWithState);

  const parked = (await getSavedAccounts()).find((a) => a.account_id === "a");
  expect(parked?.ui_state).toEqual({ "voltius-vaults": "VAULTS_OF_CURRENT" });
  expect(h.clearPersistedAccountUiState).toHaveBeenCalled();
  expect(h.restorePersistedAccountUiState).toHaveBeenCalledWith({ "voltius-vaults": "VAULTS_OF_B" });
});

test("parking the outgoing UI state keeps the rest of its saved entry", async () => {
  activate(CLOUD_A);
  h.store[LIST_KEY] = JSON.stringify([CLOUD_A, CLOUD_B]);
  await switchToAccount(CLOUD_B);
  expect((await getSavedAccounts()).find((a) => a.account_id === "a")).toMatchObject(CLOUD_A);
});

test("saveCurrentAccount keeps the UI state already parked on the entry", async () => {
  activate(CLOUD_A);
  h.store[LIST_KEY] = JSON.stringify([{ ...CLOUD_A, ui_state: { "voltius-vaults": "PARKED" } }]);
  h.store.jwt = fake("jwt", "a3");
  await saveCurrentAccount();
  const saved = (await getSavedAccounts())[0];
  expect(saved.ui_state).toEqual({ "voltius-vaults": "PARKED" });
  expect(saved.jwt).toBe(fake("jwt", "a3"));
});

test("switchToAccount tears the old session down before reloading", async () => {
  activate(CLOUD_A);
  await switchToAccount(CLOUD_B);
  expect(h.push).toHaveBeenCalled();
  expect(h.stopRealtimeSync).toHaveBeenCalled();
  expect(h.lockVault).toHaveBeenCalled();
  expect(h.wipeLocalConfig).toHaveBeenCalled();
  expect(h.clearPersistedAccountUiState).toHaveBeenCalled();
  expect(sessionStorage.setItem).toHaveBeenCalledWith("voltius.replace-sync-on-login", "1");
  expect(h.reload).toHaveBeenCalled();
});

/**
 * Sign-out forgets the account by design, and it is otherwise the only way to
 * reach the auth screen — so without this the switcher could never hold a
 * second account.
 */
test("adding another account keeps the current one in the switcher", async () => {
  activate(CLOUD_A);
  h.store.handle = "alice";

  await signOutToAddAccount();

  expect((await getSavedAccounts()).map((a) => a.account_id)).toEqual(["a"]);
  expect(h.store.master_password).toBeUndefined();
  expect(h.store.handle).toBeUndefined();
  expect(h.wipeLocalConfig).toHaveBeenCalled();
  expect(h.clearPersistedAccountUiState).toHaveBeenCalled();
  expect(h.reload).toHaveBeenCalled();
});

test("adding another account parks the outgoing account's UI state", async () => {
  activate(CLOUD_A);
  await signOutToAddAccount();
  const parked = (await getSavedAccounts()).find((a) => a.account_id === "a");
  expect(parked?.ui_state).toEqual({ "voltius-vaults": "VAULTS_OF_CURRENT" });
});
