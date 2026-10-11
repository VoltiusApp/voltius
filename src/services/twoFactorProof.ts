import i18n from "@/i18n";
import type { OpenPasskey } from "@/services/passkeyRoundTrip";

export type TwoFactorMethod = "totp" | "passkey" | "recovery";

/** `passkeyCode` is what a finished passkey ceremony handed back, not something the user types. */
export type TwoFactorProof = { code: string } | { recoveryCode: string } | { passkeyCode: string };

export function proofBody(
  proof?: TwoFactorProof | null,
): { code?: string; recovery_code?: string; passkey_code?: string } {
  if (!proof) return {};
  if ("code" in proof) return { code: proof.code.trim() };
  if ("recoveryCode" in proof) return { recovery_code: proof.recoveryCode.trim() };
  return { passkey_code: proof.passkeyCode };
}

/**
 * The server accepted the password and wants a second factor; `complete` finishes the
 * interrupted sign-in, and `openPasskey` starts the browser ceremony for the same one.
 */
export class TwoFactorRequiredError<T = unknown> extends Error {
  constructor(
    readonly methods: TwoFactorMethod[],
    readonly complete: (proof: TwoFactorProof) => Promise<T>,
    readonly openPasskey: OpenPasskey,
  ) {
    super(i18n.t("common.error.twoFactorRequired"));
    this.name = "TwoFactorRequiredError";
  }
}

const MESSAGE_KEYS: Record<string, string> = {
  TWO_FACTOR_REQUIRED: "common.error.twoFactorRequired",
  TWO_FACTOR_INVALID: "common.error.twoFactorInvalid",
  TWO_FACTOR_LOCKED: "common.error.twoFactorLocked",
  TWO_FACTOR_UNAVAILABLE: "common.error.twoFactorUnavailable",
  TWO_FACTOR_ALREADY_ENABLED: "common.error.twoFactorAlreadyEnabled",
  TWO_FACTOR_NOT_ENABLED: "common.error.twoFactorNotEnabled",
  PASSKEY_LIMIT: "common.error.passkeyLimit",
};

export async function twoFactorCode(res: Response): Promise<string | null> {
  const body = await res.json().catch(() => null);
  const code = body && typeof body === "object" ? (body as { error?: unknown }).error : null;
  return typeof code === "string" && code in MESSAGE_KEYS ? code : null;
}

/** The translated refusal when a failed response carries a two-factor code, else null. Reads the body. */
export async function twoFactorError(res: Response): Promise<Error | null> {
  const code = await twoFactorCode(res);
  return code ? new Error(i18n.t(MESSAGE_KEYS[code])) : null;
}
