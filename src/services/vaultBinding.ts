import { getAccountMode, isCurrentMasterPassword, openWithStoredSecret } from "@/services/account";
import { systemAuthVerify } from "@/services/appLock";
import { useSecurityStore } from "@/stores/securityStore";
import { canLockVault } from "@/utils/accountMode";
import { forgetOtherPlainPasswords } from "@/services/savedAccounts";
import {
  bindSecret, clearSecret, importSecret, readPlainSecret, readSecret, sealAvailable, secretState, unbindSecret,
} from "@/services/vaultSecret";

export type UnlockOutcome = "ok" | "declined" | "cancelled" | "failed" | "invalidated" | "unavailable";

export async function isBindable(mode: string | null): Promise<boolean> {
  return canLockVault(mode) && (await sealAvailable());
}

async function wantsBinding(): Promise<boolean> {
  return useSecurityStore.getState().systemAuthUnlock && isBindable(await getAccountMode().catch(() => null));
}

async function open(password: string): Promise<UnlockOutcome | "wrong-key"> {
  const outcome = await openWithStoredSecret(password);
  if (outcome === "ok" || outcome === "wrong-key") return outcome;
  return "declined";
}

async function unlocked(password: string): Promise<UnlockOutcome> {
  return (await open(password)) === "ok" ? "ok" : "declined";
}

/** Once this device holds a sealed secret, plaintext copies in the switcher defeat it. */
async function bind(password: string, reason: string): Promise<UnlockOutcome> {
  const status = (await bindSecret(password, reason)) as UnlockOutcome;
  if (status === "ok") await forgetOtherPlainPasswords().catch(() => {});
  return status;
}

/** Seals the plain secret; null when there is none or the device can't seal. */
async function bindPlain(reason: string): Promise<{ status: UnlockOutcome; password: string } | null> {
  const password = await readPlainSecret().catch(() => null);
  if (!password) return null;
  const status = await bind(password, reason);
  return status === "unavailable" ? null : { status, password };
}

export async function unlockWithSystemAuth(reason: string): Promise<UnlockOutcome> {
  const state = await secretState().catch(() => "none" as const);
  if (state === "sealed") {
    const read = await readSecret(reason);
    if (read.outcome !== "ok" || !read.value) return read.outcome === "none" ? "declined" : (read.outcome as UnlockOutcome);
    const opened = await open(read.value);
    if (opened === "wrong-key") {
      // The blob holds a password this account no longer has (changed on another device).
      await clearSecret().catch(() => {});
      return "invalidated";
    }
    if (opened !== "ok") return "failed";
    if (!(await wantsBinding())) await importSecret({ kind: "plain", value: read.value }).catch(() => {});
    return "ok";
  }
  if (state === "plain" && (await wantsBinding())) {
    const bound = await bindPlain(reason);
    if (bound) return bound.status === "ok" ? unlocked(bound.password) : bound.status;
  }
  const verified = await systemAuthVerify(reason);
  if (verified !== "ok") return verified;
  const password = await readPlainSecret().catch(() => null);
  return password ? unlocked(password) : "declined";
}

export async function verifyForLockScreen(reason: string): Promise<UnlockOutcome> {
  if ((await secretState().catch(() => "none")) === "plain" && (await wantsBinding())) {
    const bound = await bindPlain(reason);
    if (bound) return bound.status;
  }
  return systemAuthVerify(reason);
}

export async function rebindAfterPassword(password: string, reason: string): Promise<void> {
  if ((await secretState().catch(() => "sealed")) === "sealed" || !(await wantsBinding())) return;
  await bind(password, reason);
}

export type BindingStatus = "bound" | "unbound" | "os-login" | "no-password";

export async function bindingStatus(mode: string | null): Promise<BindingStatus> {
  if ((await secretState().catch(() => "none")) === "sealed") return "bound";
  if (mode === "local-nopassword") return "no-password";
  return (await isBindable(mode)) ? "unbound" : "os-login";
}

export async function enableBinding(password: string, reason: string): Promise<"wrong-password" | UnlockOutcome> {
  if (!(await isCurrentMasterPassword(password))) return "wrong-password";
  return bind(password, reason);
}

export async function disableBinding(reason: string): Promise<UnlockOutcome> {
  if ((await secretState().catch(() => "sealed")) !== "sealed") return "ok";
  return (await unbindSecret(reason)) as UnlockOutcome;
}

export async function disableWithPassword(password: string): Promise<boolean> {
  if (!(await isCurrentMasterPassword(password))) return false;
  await importSecret({ kind: "plain", value: password });
  return true;
}

export async function bindNow(reason: string): Promise<UnlockOutcome> {
  return (await bindPlain(reason))?.status ?? "unavailable";
}
