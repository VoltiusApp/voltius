/**
 * Every keychain entry that belongs to the signed-in account.
 *
 * Lives apart from `account.ts` (which writes them) and `vault.ts` (which clears
 * them on sign-out) because those two already import in one direction. A key
 * cached but not listed here survives a sign-out and is then read by the next
 * account: `handle` did exactly that, showing the previous user's `@handle` in
 * the account menu.
 */
export const ACCOUNT_CACHE_KEYS = [
  "master_password",
  "account_id",
  "mode",
  "email",
  // Nothing writes this any more — it is here to purge the key from devices
  // that cached one before 0.26. Delete in 0.27 with the display_name alias.
  "display_name",
  "handle",
  "jwt",
  "refresh_token",
  "server_url",
  "device_id",
  "wrapped_user_secrets",
] as const;
