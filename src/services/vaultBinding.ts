import { getAccountMode, isCurrentMasterPassword, openWithStoredSecret } from "@/services/account";
import { systemAuthVerify } from "@/services/appLock";
import { useSecurityStore } from "@/stores/securityStore";
import { canLockVault } from "@/utils/accountMode";
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

async function open(password: string): Promise<UnlockOutcome> {
  return (await openWithStoredSecret(password)) === "ok" ? "ok" : "declined";
}

/** Seals the plain secret; null when there is none or the device can't seal. */
async function bindPlain(reason: string): Promise<{ status: UnlockOutcome; password: string } | null> {
  const password = await readPlainSecret().catch(() => null);
  if (!password) return null;
  const status = (await bindSecret(password, reason)) as UnlockOutcome;
  return status === "unavailable" ? null : { status, password };
}

export async function unlockWithSystemAuth(reason: string): Promise<UnlockOutcome> {
  const state = await secretState().catch(() => "none" as const);
  if (state === "sealed") {
    const read = await readSecret(reason);
    if (read.outcome !== "ok" || !read.value) return read.outcome === "none" ? "declined" : (read.outcome as UnlockOutcome);
    if ((await open(read.value)) !== "ok") {
      // The blob holds a password this account no longer has (changed on another device).
      await clearSecret().catch(() => {});
      return "invalidated";
    }
    if (!(await wantsBinding())) await importSecret({ kind: "plain", value: read.value }).catch(() => {});
    return "ok";
  }
  if (state === "plain" && (await wantsBinding())) {
    const bound = await bindPlain(reason);
    if (bound) return bound.status === "ok" ? open(bound.password) : bound.status;
  }
  const verified = await systemAuthVerify(reason);
  if (verified !== "ok") return verified;
  const password = await readPlainSecret().catch(() => null);
  return password ? open(password) : "declined";
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
  await bindSecret(password, reason);
}

export type BindingStatus = "bound" | "unbound" | "os-login" | "no-password";

export async function bindingStatus(mode: string | null): Promise<BindingStatus> {
  if ((await secretState().catch(() => "none")) === "sealed") return "bound";
  if (mode === "local-nopassword") return "no-password";
  return (await isBindable(mode)) ? "unbound" : "os-login";
}

export async function enableBinding(password: string, reason: string): Promise<"wrong-password" | UnlockOutcome> {
  if (!(await isCurrentMasterPassword(password))) return "wrong-password";
  return (await bindSecret(password, reason)) as UnlockOutcome;
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
