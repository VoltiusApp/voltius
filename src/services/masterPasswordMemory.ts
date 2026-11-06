import { getAccountMode, isCurrentMasterPassword } from "@/services/account";
import { forgetSavedPlainPasswords } from "@/services/savedAccounts";
import { clearSecret, rememberPassword, secretState, setKeepsPlainPassword } from "@/services/vaultSecret";
import { canLockVault } from "@/utils/accountMode";

/** A sealed copy stays, and so does a no-password account's key: it is that vault key's only copy. */
export async function stopRememberingMasterPassword(): Promise<void> {
  await setKeepsPlainPassword(false);
  const mode = await getAccountMode().catch(() => null);
  if (canLockVault(mode) && (await secretState()) === "plain") await clearSecret();
  await forgetSavedPlainPasswords();
}

export async function startRememberingMasterPassword(password: string): Promise<boolean> {
  if (!canLockVault(await getAccountMode().catch(() => null))) return false;
  if (!(await isCurrentMasterPassword(password))) return false;
  await setKeepsPlainPassword(true);
  await rememberPassword(password);
  return true;
}
