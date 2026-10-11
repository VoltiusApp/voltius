import i18n from "@/i18n";
import { appFetch } from "@/services/http";
import { getJwt, getServerUrl, isJwtExpiredOrExpiring, tryRefreshJwt } from "@/services/authTokens";
import { adoptSessionTokens, deriveAuthKey } from "@/services/account";
import { passkeyRoundTrip } from "@/services/passkeyRoundTrip";
import { proofBody, twoFactorError, type TwoFactorMethod, type TwoFactorProof } from "@/services/twoFactorProof";

interface SessionTokens {
  jwt_token: string;
  refresh_token: string;
}

async function request(path: string, body?: unknown): Promise<Response> {
  const serverUrl = await getServerUrl();
  let jwt = await getJwt();
  if (jwt && isJwtExpiredOrExpiring(jwt)) jwt = await tryRefreshJwt();
  if (!serverUrl || !jwt) throw new Error(i18n.t("common.error.notConnectedToServer"));

  return appFetch(`${serverUrl}/v1/auth/2fa${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

// Not fetchAuth: it retries a 401, and here a 401 is a wrong code that must be counted once.
async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await request(path, body);
  if (res.ok) return res.json();
  const refusal = await twoFactorError(res);
  if (refusal) throw refusal;
  if (res.status === 401) throw new Error(i18n.t("common.error.incorrectPassword"));
  if (res.status === 429) throw new Error(i18n.t("common.error.tooManyAttempts"));
  throw new Error(i18n.t("common.error.serverError", { status: res.status }));
}

export interface PasskeyInfo {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

export interface Factors {
  totp: boolean;
  passkeys: PasskeyInfo[];
  /** Null on a server that does not report it. */
  recoveryCodesLeft: number | null;
}

/** What the account holds. A server that predates passkeys cannot say: there, two-factor on means an authenticator. */
export async function getFactors(enabled: boolean): Promise<Factors> {
  const res = await request("");
  if (res.status === 404 || res.status === 405) return { totp: enabled, passkeys: [], recoveryCodesLeft: null };
  if (!res.ok) throw new Error(i18n.t("common.error.serverError", { status: res.status }));
  const held = await res.json();
  return { totp: held.totp === true, passkeys: held.passkeys ?? [], recoveryCodesLeft: held.recovery_codes_left ?? null };
}

export function factorMethods(factors: Factors): TwoFactorMethod[] {
  return [...(factors.totp ? ["totp" as const] : []), ...(factors.passkeys.length ? ["passkey" as const] : []), "recovery"];
}

export interface TwoFactorSetup {
  secret: string;
  otpauth_uri: string;
}

/** `proof` is of a factor the account already has; an account without one sends none. */
export async function beginTwoFactorSetup(password: string, proof?: TwoFactorProof | null): Promise<TwoFactorSetup> {
  return post<TwoFactorSetup>("/setup", { auth_key: await deriveAuthKey(password), ...proofBody(proof) });
}

/** The recovery codes of an account that just got its first factor; empty for a later one. */
async function adoptAdded(added: SessionTokens & { recovery_codes: string[] }): Promise<string[]> {
  await adoptSessionTokens(added);
  return added.recovery_codes;
}

/** Confirms the authenticator. Resolves to the recovery codes, which the server never shows again. */
export async function enableTwoFactor(code: string): Promise<string[]> {
  return adoptAdded(await post("/enable", { code: code.trim() }));
}

export async function addPasskey(password: string, proof: TwoFactorProof | null, name: string): Promise<string[]> {
  const auth_key = await deriveAuthKey(password);
  const passkey_code = await passkeyRoundTrip((returnTo) =>
    post("/passkeys/register", { auth_key, ...proofBody(proof), name, return_to: returnTo }),
  );
  return adoptAdded(await post("/passkeys/activate", { passkey_code }));
}

export async function passkeyStepUp(): Promise<TwoFactorProof> {
  return { passkeyCode: await passkeyRoundTrip((returnTo) => post("/passkeys/step-up", { return_to: returnTo })) };
}

export type FactorTarget = { kind: "all" } | { kind: "totp" } | { kind: "passkey"; id: string; name: string };

const REMOVAL_PATH = (target: FactorTarget): string =>
  target.kind === "all" ? "/disable" : target.kind === "totp" ? "/totp/remove" : `/passkeys/${target.id}/remove`;

/** Removes one factor or all of them. Resolves to whether two-factor is still on afterwards. */
export async function removeFactor(
  target: FactorTarget,
  password: string,
  proof: TwoFactorProof | null,
): Promise<boolean> {
  const auth_key = await deriveAuthKey(password);
  const removal = await post<SessionTokens & { two_factor_enabled?: boolean }>(REMOVAL_PATH(target), {
    auth_key,
    ...proofBody(proof),
  });
  await adoptSessionTokens(removal);
  return removal.two_factor_enabled === true;
}

export async function regenerateRecoveryCodes(proof: TwoFactorProof | null): Promise<string[]> {
  return (await post<{ recovery_codes: string[] }>("/recovery-codes", proofBody(proof))).recovery_codes;
}
