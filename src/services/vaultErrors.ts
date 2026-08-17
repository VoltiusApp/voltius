import i18n from "@/i18n";

/** Why a secret could not be read. Carried alongside the translated message,
 * which must never be matched on. */
export type VaultErrorCode = "vault-unreadable" | "vault-locked";

/**
 * The vault itself could not answer, as opposed to answering "not stored". Lives
 * apart from vault.ts so tests mocking "./vault" still get the real classes.
 */
export abstract class VaultError extends Error {
  abstract readonly code: VaultErrorCode;
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

/**
 * secrets.enc exists but no key this session holds can decrypt it. The file is
 * intact, so nothing may delete it on this signal — only quarantineVault, on
 * the user's request.
 */
export class VaultUnreadableError extends VaultError {
  readonly code = "vault-unreadable" as const;

  constructor(cause?: unknown) {
    super(i18n.t("common.error.vaultUnreadable"), cause);
    this.name = "VaultUnreadableError";
  }
}

/** No vault key is installed, so nothing can be read until the user unlocks. */
export class VaultLockedError extends VaultError {
  readonly code = "vault-locked" as const;

  constructor() {
    super(i18n.t("common.error.vaultLocked"));
    this.name = "VaultLockedError";
  }
}

/** The vault-failure code behind an error, or null for any other failure. */
export function vaultErrorCode(e: unknown): VaultErrorCode | null {
  return e instanceof VaultError ? e.code : null;
}
