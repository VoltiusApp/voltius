// @vitest-environment jsdom
import { expect, test } from "vitest";
import { VAULT_RESET_KEYS } from "./accountCacheKeys";
import { ENTRY_PREFIX, INDEX_KEY, SESSION_KEYS } from "./savedAccounts";

test("session_keys.json mirrors the app's keychain key lists", async () => {
  const lists = {
    session: SESSION_KEYS,
    reset: VAULT_RESET_KEYS,
    saved_index: INDEX_KEY,
    saved_entry_prefix: ENTRY_PREFIX,
  };
  await expect(JSON.stringify(lists, null, 2) + "\n").toMatchFileSnapshot("../../src-tauri/src/auth/session_keys.json");
});
