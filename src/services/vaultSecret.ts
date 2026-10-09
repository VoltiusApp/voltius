import { invoke } from "@/lib/invoke";
import { withLeaveLockSuppressed } from "@/services/leaveLockSuppression";

export type SecretState = "none" | "plain" | "sealed";
export type SecretStatus = "ok" | "none" | "cancelled" | "failed" | "invalidated" | "unavailable";
export interface SecretRead { outcome: SecretStatus; value: string | null }
export interface ExportedSecret { kind: "plain" | "sealed"; value: string }

const prompting = <T>(cmd: string, args: Record<string, unknown>, fallback: T) =>
  withLeaveLockSuppressed(() => invoke<T>(cmd, args).catch(() => fallback));

export const secretState = () => invoke<SecretState>("vault_secret_state");
export const sealAvailable = () => invoke<boolean>("vault_secret_seal_available").catch(() => false);

export const readSecret = (reason: string) =>
  prompting<SecretRead>("vault_secret_get", { reason }, { outcome: "failed", value: null });

/** Never prompts: null unless the secret is stored in plain form. Throws when the keychain does. */
export async function readPlainSecret(): Promise<string | null> {
  if ((await secretState()) !== "plain") return null;
  const r = await invoke<SecretRead>("vault_secret_get", { reason: "" });
  return r.outcome === "ok" ? r.value : null;
}

/** For unlocking the same account: a sealed secret already holds the password the user just proved. */
export async function rememberPassword(value: string): Promise<void> {
  if ((await secretState()) === "sealed") return;
  await invoke("vault_secret_set", { value, reason: "" });
}

export const replacePassword = (value: string, reason: string) =>
  prompting<SecretStatus>("vault_secret_set", { value, reason }, "failed");
export const bindSecret = (value: string, reason: string) =>
  prompting<SecretStatus>("vault_secret_bind", { value, reason }, "failed");
export const unbindSecret = (reason: string) =>
  prompting<SecretStatus>("vault_secret_unbind", { reason }, "failed");

/** For a new account or sign-in: whatever was stored belongs to another password. */
export const storePassword = (value: string) => invoke<void>("vault_secret_import", { kind: "plain", value });

export const clearSecret = () => invoke<void>("vault_secret_clear");
export const exportSecret = () => invoke<ExportedSecret | null>("vault_secret_export");
export const importSecret = (e: ExportedSecret) => invoke<void>("vault_secret_import", { kind: e.kind, value: e.value });
