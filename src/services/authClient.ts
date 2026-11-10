import i18n from "@/i18n";
import { invoke } from "@/lib/invoke";
import type { PasskeyReturn } from "./passkeyRoundTrip";
import { twoFactorCodeError, type TwoFactorMethod, type TwoFactorProof } from "./twoFactorProof";

export interface LoginData {
  jwt_token: string;
  refresh_token: string;
  wrapped_user_secrets?: string | null;
}

export type LoginStep =
  | { kind: "signed"; data: LoginData }
  | { kind: "secondFactor"; pendingToken: string; methods: TwoFactorMethod[] };

/** How the auth_* commands reject: src-tauri/src/auth `AuthError`. */
export type AuthWireError =
  | { kind: "status"; status: number; code?: string }
  | { kind: "network"; message: string }
  | { kind: "badAnswer" };

interface Session {
  jwt: string;
  refresh_token: string;
  wrapped_user_secrets: string | null;
}

type WireStep = ({ kind: "signed" } & Session) | { kind: "secondFactor"; pending_token: string; methods: TwoFactorMethod[] };

const loginData = (s: Session): LoginData => ({
  jwt_token: s.jwt,
  refresh_token: s.refresh_token,
  wrapped_user_secrets: s.wrapped_user_secrets,
});

export function authChallenge(server: string, email: string): Promise<string> {
  return invoke<string>("auth_challenge", { server, email });
}

export async function authLogin(server: string, accountId: string, authKey: string): Promise<LoginStep> {
  const step = await invoke<WireStep>("auth_login", { server, accountId, authKey });
  return step.kind === "signed"
    ? { kind: "signed", data: loginData(step) }
    : { kind: "secondFactor", pendingToken: step.pending_token, methods: step.methods };
}

export async function authSecondFactor(server: string, pendingToken: string, proof: TwoFactorProof): Promise<LoginData> {
  return loginData(await invoke<Session>("auth_second_factor", { server, pendingToken, proof }));
}

export function authPasskeyStart(server: string, pendingToken: string, returnTo: PasskeyReturn): Promise<string> {
  return invoke<string>("auth_passkey_start", { server, pendingToken, returnTo });
}

/**
 * The auth limiter is a hardcoded 10/min per IP: collapsing its 429 into `expected`
 * rendered it as "Account not found" and sent people off to make a second account.
 */
function authFailure(status: number, expected: string): Error {
  if (status === 429) return new Error(i18n.t("common.error.tooManyAttempts"));
  if (status === 404 || status === 401 || status === 403) return new Error(i18n.t(expected));
  return new Error(i18n.t("common.error.serverError", { status }));
}

export type Refused = (status: number) => Error;

function isAuthWireError(e: unknown): e is AuthWireError {
  const kind = (e as { kind?: unknown } | null)?.kind;
  return typeof e === "object" && (kind === "status" || kind === "network" || kind === "badAnswer");
}

/** A rejected auth_* command as the message the user reads; `expected` is the key for 401/403/404 or a refusal of its own. */
export function authErrorToError(e: unknown, expected: string | Refused, step: "first" | "second" = "first"): Error {
  if (!isAuthWireError(e)) return e instanceof Error ? e : new Error(String(e));
  if (e.kind === "network") return new Error(i18n.t("common.error.networkError", { message: e.message }));
  if (e.kind === "badAnswer") return new Error(i18n.t("common.error.serverLoginFailed"));
  if (step === "second") {
    const refusal = twoFactorCodeError(e.code);
    if (refusal) return refusal;
    // A bare 401 here is the pending token: expired, or the account moved on.
    if (e.status === 401) return new Error(i18n.t("common.error.twoFactorExpired"));
  }
  return typeof expected === "string" ? authFailure(e.status, expected) : expected(e.status);
}
