import { invoke } from "@/lib/invoke";
import { withLeaveLockSuppressed } from "@/services/leaveLockSuppression";
import { useSecurityStore } from "@/stores/securityStore";

export type SecretState = "none" | "plain" | "sealed";
export type SecretStatus = "ok" | "none" | "cancelled" | "failed" | "invalidated" | "unavailable";
export interface SecretRead { outcome: SecretStatus; value: string | null }
export interface ExportedSecret { kind: "plain" | "sealed"; value: string }

const prompting = <T>(cmd: string, args: Record<string, unknown>, fallback: T) =>
  withLeaveLockSuppressed(() => invoke<T>(cmd, args).catch(() => fallback));

export const secretState = () => invoke<SecretState>("vault_secret_state");
export const sealAvailable = () => invoke<boolean>("vault_secret_seal_available").catch(() => false);

/**
 * Whether a master password may be kept in the keychain in plain form: the
 * device-local "Remember master password" choice. Everything below that writes a
 * master password in plain form asks this first. A no-password account's key is
 * not a master password — it only exists in the keychain — so its writers
 * (`storeDeviceKey`, `rememberDeviceKey`) never ask.
 */
export const keepsPlainPassword = () => useSecurityStore.getState().rememberMasterPassword;

export const readSecret = (reason: string) =>
  prompting<SecretRead>("vault_secret_get", { reason }, { outcome: "failed", value: null });

/** Never prompts: null unless the secret is stored in plain form. Throws when the keychain does. */
export async function readPlainSecret(): Promise<string | null> {
  if ((await secretState()) !== "plain") return null;
  const r = await invoke<SecretRead>("vault_secret_get", { reason: "" });
  return r.outcome === "ok" ? r.value : null;
}

export const clearSecret = () => invoke<void>("vault_secret_clear");

/** With remembering off, a plain copy left by any path (a backend fallback included) is removed. Password modes only. */
async function dropPlainUnlessKept(): Promise<void> {
  if (keepsPlainPassword()) return;
  if ((await secretState().catch(() => "plain" as const)) === "plain") await clearSecret();
}

/** For unlocking the same account: a sealed secret already holds the password the user just proved. */
export async function rememberPassword(value: string): Promise<void> {
  const state = await secretState();
  if (state === "sealed") return;
  if (!keepsPlainPassword()) {
    if (state === "plain") await clearSecret();
    return;
  }
  await invoke("vault_secret_set", { value, reason: "" });
}

/** `rememberPassword` for a no-password account, whose key is stored however the user chose about passwords. */
export async function rememberDeviceKey(hexKey: string): Promise<void> {
  if ((await secretState()) === "sealed") return;
  await invoke("vault_secret_set", { value: hexKey, reason: "" });
}

/** A new master password: a sealed secret is sealed anew, a plain one only written while remembering is on. */
export async function replacePassword(value: string, reason: string): Promise<SecretStatus> {
  const sealed = (await secretState().catch(() => "none" as const)) === "sealed";
  if (!sealed && !keepsPlainPassword()) {
    await clearSecret();
    return "ok";
  }
  const status = await prompting<SecretStatus>("vault_secret_set", { value, reason }, "failed");
  // A reseal that fails falls back to a plain copy in the backend, so the new password stays reachable.
  if (sealed) await dropPlainUnlessKept().catch(() => {});
  return status;
}

export const bindSecret = (value: string, reason: string) =>
  prompting<SecretStatus>("vault_secret_bind", { value, reason }, "failed");

/** Unsealing leaves a plain copy behind, which only stays while remembering is on. */
export async function unbindSecret(reason: string): Promise<SecretStatus> {
  const status = await prompting<SecretStatus>("vault_secret_unbind", { reason }, "failed");
  if (status === "ok") await dropPlainUnlessKept();
  return status;
}

/** For a new account or sign-in: whatever was stored belongs to another password, so it goes either way. */
export async function storePassword(value: string): Promise<void> {
  if (!keepsPlainPassword()) return clearSecret();
  await invoke<void>("vault_secret_import", { kind: "plain", value });
}

/** A no-password account's key, which has nowhere else to live. */
export const storeDeviceKey = (hexKey: string) => invoke<void>("vault_secret_import", { kind: "plain", value: hexKey });

export const exportSecret = () => invoke<ExportedSecret | null>("vault_secret_export");

/** Puts back a stored master password: a plain one only while remembering is on. */
export async function importSecret(e: ExportedSecret): Promise<void> {
  if (e.kind === "plain" && !keepsPlainPassword()) return clearSecret();
  await invoke<void>("vault_secret_import", { kind: e.kind, value: e.value });
}
