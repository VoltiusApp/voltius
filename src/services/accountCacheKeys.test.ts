import { test, expect } from "vitest";
import accountSource from "./account.ts?raw";
import vaultSource from "./vault.ts?raw";
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
