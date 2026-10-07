import type { TFunction } from "i18next";

/**
 * Every code the backend attaches to an error: `ErrorCode` in
 * src-tauri/src/error.rs, translated as `errors.<code>` in
 * src/i18n/locales/<lang>/errors.json.
 */
export const BACKEND_ERROR_CODES = [
  "permission-denied",
  "not-found",
  "already-exists",
  "storage-full",
  "read-only-filesystem",
  "connection-refused",
  "host-unreachable",
  "timed-out",
  "connection-lost",
  "transfer-verify-failed",
  "transfer-source-changed",
  "port-in-use",
  "remote-forward-denied",
  "ssh-key-rejected",
  "ssh-password-rejected",
  "ssh-password-expired",
  "ssh-prompt-unanswerable",
  "ssh-no-usable-auth-method",
  "ssh-auth-timeout",
  "login-rejected",
  "resource-locked",
  "vault-locked",
  "vault-unreadable",
  "vault-sign-in-required",
  "vault-read-only",
  "vault-role-read-only",
  "vault-permissions-unavailable",
  "vault-permissions-corrupted",
  "knock-udp-via-proxy",
] as const;

export type BackendErrorCode = (typeof BACKEND_ERROR_CODES)[number];

/** Values a code's translation interpolates, e.g. `{ port: "8080" }`. */
export type ErrorParams = Record<string, string>;

/**
 * A failure that names its cause with a code. `message` is the English text the
 * backend would have sent as a bare string; `describeError` is what the user
 * should read. Never match on the message — match on the code.
 */
export class BackendError extends Error {
  readonly code: BackendErrorCode;
  readonly params: ErrorParams;

  constructor(code: BackendErrorCode, message: string, params: ErrorParams = {}) {
    super(message);
    this.name = "BackendError";
    this.code = code;
    this.params = params;
  }

  /** `String(e)` stays the bare message a string rejection used to be. */
  override toString(): string {
    return this.message;
  }

  /** `message` is not enumerable, so the logger's JSON.stringify would drop it. */
  toJSON(): { name: string; code: BackendErrorCode; message: string; params: ErrorParams } {
    return { name: this.name, code: this.code, message: this.message, params: this.params };
  }
}

interface WireError {
  code: BackendErrorCode;
  message: string;
  params?: ErrorParams;
}

function isWireError(raw: unknown): raw is WireError {
  const e = raw as Partial<WireError> | null;
  return typeof e === "object" && e !== null && typeof e.code === "string" && typeof e.message === "string";
}

/**
 * A command rejects with its serialized `AppError`: a bare string, or
 * `{ code, message, params? }` when the backend named the cause.
 */
export function fromInvokeRejection(raw: unknown): unknown {
  return isWireError(raw) ? new BackendError(raw.code, raw.message, raw.params) : raw;
}

/** The code behind an error, or null for an uncoded one. */
export function backendErrorCode(e: unknown): BackendErrorCode | null {
  return e instanceof BackendError ? e.code : null;
}

/** Params naming the machine a failure happened at, outermost first. */
const FAILED_AT = ["proxy", "jumpHost"] as const;

/**
 * What to show the user for a failure: the translation of its code, prefixed with
 * the proxy or jump host it happened at, else its message.
 */
export function describeError(e: unknown, t: TFunction): string {
  if (!(e instanceof BackendError)) return e instanceof Error ? e.message : String(e);
  const cause = t(`errors.${e.code}`, { ...e.params, defaultValue: "" });
  if (!cause) return e.message;
  const at = FAILED_AT.find((key) => e.params[key]);
  return at ? t(`errorAt.${at}`, { ...e.params, cause }) : cause;
}
