import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  lockVault: vi.fn(async () => undefined),
  wipeLocalConfig: vi.fn(async () => undefined),
  push: vi.fn(async () => undefined),
  stopRealtimeSync: vi.fn(),
  clearPersistedAccountUiState: vi.fn(),
  parkAccountUiState: vi.fn(),
  restoreAccountUiState: vi.fn(),
  writeParkedUiState: vi.fn(),
  dropAccountUiState: vi.fn(),
  reload: vi.fn(),
  store: {} as Record<string, string>,
  /** UTF-16 bytes a single keychain value may hold; 0 for an unbounded one. */
  valueCap: 0,
  readFails: false,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("./vault", () => ({ lockVault: h.lockVault, wipeLocalConfig: h.wipeLocalConfig }));
vi.mock("@/services/sync", () => ({ push: h.push, stopRealtimeSync: h.stopRealtimeSync }));
vi.mock("@/stores/persistedAccountUiState", () => ({
  clearPersistedAccountUiState: h.clearPersistedAccountUiState,
  parkAccountUiState: h.parkAccountUiState,
  restoreAccountUiState: h.restoreAccountUiState,
  writeParkedUiState: h.writeParkedUiState,
  dropAccountUiState: h.dropAccountUiState,
}));

import { getSavedAccounts, saveCurrentAccount, removeSavedAccount, signOutToAddAccount, switchToAccount, type SavedAccount } from "./savedAccounts";
import { ACCOUNT_CACHE_KEYS } from "./accountCacheKeys";

const INDEX_KEY = "voltius.saved_accounts";
const entryKey = (id: string) => `voltius.saved_account.${id}`;

/**
 * Windows Credential Manager's ceiling: CRED_MAX_CREDENTIAL_BLOB_SIZE, checked
 * after the value is encoded as UTF-16, so 2560 bytes is 1280 ASCII characters.
 * The switcher held every account in one value and blew straight through it.
 */
const WINDOWS_BLOB_CAP = 2560;

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
  h.valueCap = 0;
  h.readFails = false;
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
    switch (cmd) {
      case "keychain_get":
        if (h.readFails) throw new Error("Keychain read error");
        return h.store[args.key as string] ?? null;
      case "keychain_set": {
        const value = args.value as string;
        if (h.valueCap && value.length * 2 > h.valueCap) throw new Error("Keychain write error: too long");
        h.store[args.key as string] = value;
        return undefined;
      }
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

/** Seed the switcher in its stored shape: an index of ids, one entry each. */
function seed(...accounts: SavedAccount[]) {
  h.store[INDEX_KEY] = JSON.stringify(accounts.map((a) => a.account_id));
  for (const account of accounts) h.store[entryKey(account.account_id)] = JSON.stringify(account);
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
  seed({ ...CLOUD_A, mode: "local" }, CLOUD_B);
  expect((await getSavedAccounts()).map((a) => a.account_id)).toEqual(["b"]);
});

test("getSavedAccounts survives a corrupt list", async () => {
  h.store[INDEX_KEY] = "{not json";
  expect(await getSavedAccounts()).toEqual([]);
});

test("removeSavedAccount drops the account, its entry and its parked state", async () => {
  seed(CLOUD_A, CLOUD_B);
  await removeSavedAccount("a");
  expect((await getSavedAccounts()).map((a) => a.account_id)).toEqual(["b"]);
  expect(h.store[entryKey("a")]).toBeUndefined();
  expect(h.dropAccountUiState).toHaveBeenCalledWith("a");
});

test("switchToAccount clears every account-scoped key before writing the target's", async () => {
  activate(CLOUD_A);
  // Keys the previous account cached that are not part of the session snapshot.
  h.store.handle = "alice";
  h.store.wrapped_user_secrets = "WRAPPED_A";
  seed(CLOUD_A, CLOUD_B);

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
  seed(CLOUD_A, CLOUD_B);

  await switchToAccount(CLOUD_B);

  expect(h.parkAccountUiState).toHaveBeenCalledWith("a");
  expect(h.clearPersistedAccountUiState).toHaveBeenCalled();
  expect(h.restoreAccountUiState).toHaveBeenCalledWith("b");
});

test("parking the outgoing UI state keeps the rest of its saved entry", async () => {
  activate(CLOUD_A);
  seed(CLOUD_A, CLOUD_B);
  await switchToAccount(CLOUD_B);
  expect((await getSavedAccounts()).find((a) => a.account_id === "a")).toMatchObject(CLOUD_A);
});

test("only an account the switcher already holds gets its UI state parked", async () => {
  activate(CLOUD_A); // signed in, never saved — parking it would strand its state
  await switchToAccount(CLOUD_B);
  expect(h.parkAccountUiState).not.toHaveBeenCalled();
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
  expect(h.parkAccountUiState).toHaveBeenCalledWith("a");
});

/**
 * The bug this layout exists for. Real tokens are ~350 characters each, so two
 * accounts in one keychain value ran to ~3.8 KB UTF-16 — past the cap, and the
 * write failed silently, leaving the second account out of the switcher for good.
 */
function realisticAccount(id: string): SavedAccount {
  const token = (kind: string) => `${fake(kind, id)}.${"t".repeat(340)}`;
  return { ...cloudAccount(id), jwt: token("jwt"), refresh_token: token("refresh") };
}

const utf16Bytes = (value: string) => value.length * 2;

test("a second account survives a keychain that caps one value at the Windows blob size", async () => {
  h.valueCap = WINDOWS_BLOB_CAP;

  activate(realisticAccount("a"));
  await saveCurrentAccount();
  activate(realisticAccount("b"));
  await saveCurrentAccount();

  expect((await getSavedAccounts()).map((a) => a.account_id)).toEqual(["a", "b"]);
  for (const [key, value] of Object.entries(h.store)) {
    expect(utf16Bytes(value), `${key} would be refused by the keychain`).toBeLessThanOrEqual(WINDOWS_BLOB_CAP);
  }
});

test("one account's entry leaves room under the Windows cap", async () => {
  activate(realisticAccount("a"));
  await saveCurrentAccount();
  // Headroom for a few more claims in the JWT before the cap bites again.
  expect(utf16Bytes(h.store[entryKey("a")])).toBeLessThan(WINDOWS_BLOB_CAP * 0.8);
});

test("a keychain that cannot be read is never overwritten with an empty switcher", async () => {
  seed(CLOUD_A, CLOUD_B);
  activate(CLOUD_A);
  const before = { ...h.store };
  h.readFails = true;

  await expect(saveCurrentAccount()).rejects.toThrow();

  h.readFails = false;
  expect(h.store).toEqual(before);
  expect((await getSavedAccounts()).map((a) => a.account_id)).toEqual(["a", "b"]);
});

test("a pre-0.29 single-value list migrates to one entry per account", async () => {
  h.store[INDEX_KEY] = JSON.stringify([
    { ...CLOUD_A, ui_state: { "voltius-vaults": "VAULTS_OF_A" } },
    CLOUD_B,
  ]);

  expect(await getSavedAccounts()).toEqual([CLOUD_A, CLOUD_B]);
  expect(JSON.parse(h.store[INDEX_KEY])).toEqual(["a", "b"]);
  expect(JSON.parse(h.store[entryKey("a")])).toEqual(CLOUD_A);
  // The UI state that used to ride along leaves the keychain for localStorage.
  expect(h.writeParkedUiState).toHaveBeenCalledWith("a", { "voltius-vaults": "VAULTS_OF_A" });
});

test("a migration the keychain refuses leaves the old list readable", async () => {
  const legacy = JSON.stringify([CLOUD_A, CLOUD_B]);
  h.store[INDEX_KEY] = legacy;
  h.valueCap = 20;

  expect((await getSavedAccounts()).map((a) => a.account_id)).toEqual(["a", "b"]);
  expect(h.store[INDEX_KEY]).toBe(legacy);
});
