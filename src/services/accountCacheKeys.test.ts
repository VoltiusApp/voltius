import { test, expect } from "vitest";
import accountSource from "./account.ts?raw";
import vaultSource from "./vault.ts?raw";
import savedAccountsSource from "./savedAccounts.ts?raw";
import { SESSION_KEYS } from "./savedAccounts";
import { ACCOUNT_CACHE_KEYS } from "./accountCacheKeys";

/**
 * Read against the writers rather than a hand-kept list: a key that account.ts
 * caches but resetVault never clears survives a sign-out and is then served to
 * the *next* account. That shipped once — the account menu showed the previous
 * user's handle — and a unit test over resetVault alone could not have caught
 * it, because nothing in that function knows what it is missing.
 */
test("every keychain key account.ts caches is cleared on sign-out", () => {
  const cached = [...accountSource.matchAll(/keychainSet\("([^"]+)"/g)].map((m) => m[1]);

  expect(cached.length).toBeGreaterThan(0);
  const missing = cached.filter((key) => !ACCOUNT_CACHE_KEYS.includes(key as never));
  expect(missing).toEqual([]);
});

test("resetVault clears the account cache list, not a literal of its own", () => {
  expect(vaultSource).toContain("of ACCOUNT_CACHE_KEYS");
});

/**
 * Account switching is the second way one account's session replaces another's,
 * and it hits the same trap: a key the previous account cached but the switch
 * never clears is read by the incoming account.
 */
test("switchToAccount clears the account cache list before writing the new session", () => {
  expect(savedAccountsSource).toContain("of ACCOUNT_CACHE_KEYS");
});

test("every session key the switcher writes is on the account cache list", () => {
  const missing = SESSION_KEYS.filter((key) => !ACCOUNT_CACHE_KEYS.includes(key as never));
  expect(missing).toEqual([]);
});
