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

/** `work` then `then`, also when `work` stops for a second factor and resumes later. */
export async function afterSecondFactor<T, R>(work: () => Promise<T>, then: (result: T) => Promise<R>): Promise<R> {
  let result: T;
  try {
    result = await work();
  } catch (e) {
    if (!(e instanceof TwoFactorRequiredError)) throw e;
    const step = e as TwoFactorRequiredError<T>;
    throw new TwoFactorRequiredError(step.methods, (proof) => afterSecondFactor(() => step.complete(proof), then), step.openPasskey);
  }
  return then(result);
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

/** The translated refusal for a server's two-factor error code, else null. */
export function twoFactorCodeError(code: unknown): Error | null {
  return typeof code === "string" && code in MESSAGE_KEYS ? new Error(i18n.t(MESSAGE_KEYS[code])) : null;
}

/** The translated refusal when a failed response carries a two-factor code, else null. Reads the body. */
export async function twoFactorError(res: Response): Promise<Error | null> {
  const body = await res.json().catch(() => null);
  return twoFactorCodeError(body && typeof body === "object" ? (body as { error?: unknown }).error : null);
}
