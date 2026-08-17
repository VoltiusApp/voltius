import i18n from "@/i18n";

/**
 * secrets.enc exists but no key this session holds can decrypt it.
 *
 * Distinct from a wrong password: the file is intact and may still be recoverable
 * once the right key turns up, so nothing may delete it on this signal. The only
 * way out is quarantineVault, which the user asks for.
 *
 * Lives apart from vault.ts so the test files that mock "./vault" wholesale still
 * get the real class.
 */
export class VaultUnreadableError extends Error {
  readonly cause?: unknown;

  constructor(cause?: unknown) {
    super(i18n.t("common.error.vaultUnreadable"));
    this.name = "VaultUnreadableError";
    this.cause = cause;
  }
}
