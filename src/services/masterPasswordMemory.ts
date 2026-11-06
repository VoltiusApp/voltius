import { getAccountMode, isCurrentMasterPassword } from "@/services/account";
import { forgetSavedPlainPasswords } from "@/services/savedAccounts";
import { clearSecret, rememberPassword, secretState } from "@/services/vaultSecret";
import { useSecurityStore } from "@/stores/securityStore";
import { canLockVault } from "@/utils/accountMode";

/**
 * Stop keeping the master password in the OS keychain in plain form: this
 * account's copy, and the ones the account switcher holds for the others. The
 * next launch asks for it. A sealed copy stays, and so does a no-password
 * account's key, which is the only place that vault's key exists.
 */
export async function stopRememberingMasterPassword(): Promise<void> {
  useSecurityStore.getState().setRememberMasterPassword(false);
  const mode = await getAccountMode().catch(() => null);
  if (canLockVault(mode) && (await secretState()) === "plain") await clearSecret();
  await forgetSavedPlainPasswords();
}

/** Remember it again, from the password the user just typed: false when it is not the current one. */
export async function startRememberingMasterPassword(password: string): Promise<boolean> {
  if (!canLockVault(await getAccountMode().catch(() => null))) return false;
  if (!(await isCurrentMasterPassword(password))) return false;
  useSecurityStore.getState().setRememberMasterPassword(true);
  await rememberPassword(password);
  return true;
}
