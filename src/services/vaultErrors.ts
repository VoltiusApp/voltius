import i18n from "@/i18n";
import { BackendError, type BackendErrorCode } from "./backendErrors";

/** Why a secret could not be read. Carried alongside the translated message,
 * which must never be matched on. The backend sends the same codes. */
export type VaultErrorCode = Extract<BackendErrorCode, "vault-unreadable" | "vault-locked">;

/**
 * The vault itself could not answer, as opposed to answering "not stored". Lives
 * apart from vault.ts so tests mocking "./vault" still get the real classes.
 */
export abstract class VaultError extends BackendError {
  declare readonly code: VaultErrorCode;
  readonly cause?: unknown;

  constructor(code: VaultErrorCode, message: string, cause?: unknown) {
    super(code, message);
    this.cause = cause;
  }
}

/**
 * secrets.enc exists but no key this session holds can decrypt it. The file is
 * intact, so nothing may delete it on this signal — only quarantineVault, on
 * the user's request.
 */
export class VaultUnreadableError extends VaultError {
  declare readonly code: "vault-unreadable";

  constructor(cause?: unknown) {
    super("vault-unreadable", i18n.t("common.error.vaultUnreadable"), cause);
    this.name = "VaultUnreadableError";
  }
}

/** No vault key is installed, so nothing can be read until the user unlocks. */
export class VaultLockedError extends VaultError {
  declare readonly code: "vault-locked";

  constructor() {
    super("vault-locked", i18n.t("common.error.vaultLocked"));
    this.name = "VaultLockedError";
  }
}

export function isVaultErrorCode(code: BackendErrorCode | null | undefined): code is VaultErrorCode {
  return code === "vault-unreadable" || code === "vault-locked";
}

/** The vault-failure code behind an error, or null for any other failure. */
export function vaultErrorCode(e: unknown): VaultErrorCode | null {
  return e instanceof VaultError ? e.code : null;
}
