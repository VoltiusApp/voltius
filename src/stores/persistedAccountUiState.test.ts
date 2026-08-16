import { test, expect } from "vitest";
import {
  ACCOUNT_SCOPED_STORAGE_KEYS,
  ACCOUNT_SCOPED_RESET_KEYS,
  DEVICE_SCOPED_STORAGE_KEYS,
  clearPersistedAccountUiState,
  snapshotPersistedAccountUiState,
  restorePersistedAccountUiState,
} from "./persistedAccountUiState";

const storeSources = import.meta.glob("./*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => { data[key] = value; },
    removeItem: (key: string) => { delete data[key]; },
  };
}

const ACCOUNT_STATE = Object.fromEntries(ACCOUNT_SCOPED_STORAGE_KEYS.map((key) => [key, `state of ${key}`]));
const DEVICE_STATE = Object.fromEntries(DEVICE_SCOPED_STORAGE_KEYS.map((key) => [key, `state of ${key}`]));
const RESET_STATE = Object.fromEntries(ACCOUNT_SCOPED_RESET_KEYS.map((key) => [key, `state of ${key}`]));

test("clearing takes the account's state and leaves the machine's", () => {
  const storage = fakeStorage({ ...ACCOUNT_STATE, ...DEVICE_STATE, ...RESET_STATE });

  clearPersistedAccountUiState(storage);

  expect(Object.keys(storage.data).sort()).toEqual([...DEVICE_SCOPED_STORAGE_KEYS].sort());
});

test("a snapshot carries the account's state but never the reset keys", () => {
  const storage = fakeStorage({ ...ACCOUNT_STATE, ...DEVICE_STATE, ...RESET_STATE });

  const snapshot = snapshotPersistedAccountUiState(storage);

  expect(snapshot).toEqual(ACCOUNT_STATE);
});

test("restoring writes the snapshot back and leaves absent keys absent", () => {
  const storage = fakeStorage(DEVICE_STATE);

  restorePersistedAccountUiState({ "voltius-vaults": "the vaults" }, storage);

  expect(storage.data["voltius-vaults"]).toBe("the vaults");
  expect(storage.data["voltius-teams"]).toBeUndefined();
});

test("a switch hands the incoming account its own state, not the outgoing one's", () => {
  const storage = fakeStorage({ ...ACCOUNT_STATE, ...DEVICE_STATE, ...RESET_STATE });

  const outgoing = snapshotPersistedAccountUiState(storage);
  clearPersistedAccountUiState(storage);
  restorePersistedAccountUiState({ "voltius-teams": "the other account's teams" }, storage);

  expect(storage.data["voltius-teams"]).toBe("the other account's teams");
  expect(storage.data["voltius-command-history"]).toBeUndefined();
  expect(storage.data["voltius-app-settings-ts"]).toBeUndefined();

  // …and switching back returns what the first account had.
  clearPersistedAccountUiState(storage);
  restorePersistedAccountUiState(outgoing, storage);
  expect(storage.data).toMatchObject(ACCOUNT_STATE);
});

/**
 * The whole bug class here is a store nobody classified: it keeps its previous
 * account's contents and shows them to the next one. A new persisted store has
 * to land in one of the three lists or this fails.
 */
test("every persisted store is classified as the account's or the machine's", () => {
  const persisted = Object.values(storeSources)
    .flatMap((source) => [...source.matchAll(/name: "(voltius-[a-z0-9-]+)"/g)].map((m) => m[1]));

  expect(persisted.length).toBeGreaterThan(15);

  const classified = new Set([
    ...ACCOUNT_SCOPED_STORAGE_KEYS,
    ...ACCOUNT_SCOPED_RESET_KEYS,
    ...DEVICE_SCOPED_STORAGE_KEYS,
  ]);
  expect([...new Set(persisted)].filter((key) => !classified.has(key))).toEqual([]);
});

test("no key is classified twice", () => {
  const all = [...ACCOUNT_SCOPED_STORAGE_KEYS, ...ACCOUNT_SCOPED_RESET_KEYS, ...DEVICE_SCOPED_STORAGE_KEYS];
  expect(all).toHaveLength(new Set(all).size);
});
