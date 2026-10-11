import i18n from "@/i18n";
import { appFetch } from "@/services/http";
import { getJwt, getServerUrl, isJwtExpiredOrExpiring, tryRefreshJwt } from "@/services/authTokens";
import { adoptSessionTokens, deriveAuthKey } from "@/services/account";
import { proofBody, twoFactorError, type TwoFactorProof } from "@/services/twoFactorProof";

interface SessionTokens {
  jwt_token: string;
  refresh_token: string;
}

// Not fetchAuth: it retries a 401, and here a 401 is a wrong code that must be counted once.
async function post<T>(path: string, body: unknown): Promise<T> {
  const serverUrl = await getServerUrl();
  let jwt = await getJwt();
  if (jwt && isJwtExpiredOrExpiring(jwt)) jwt = await tryRefreshJwt();
  if (!serverUrl || !jwt) throw new Error(i18n.t("common.error.notConnectedToServer"));

  const res = await appFetch(`${serverUrl}/v1/auth/2fa/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify(body),
  });
  if (res.ok) return res.json();
  const refusal = await twoFactorError(res);
  if (refusal) throw refusal;
  if (res.status === 401) throw new Error(i18n.t("common.error.incorrectPassword"));
  if (res.status === 429) throw new Error(i18n.t("common.error.tooManyAttempts"));
  throw new Error(i18n.t("common.error.serverError", { status: res.status }));
}

export interface TwoFactorSetup {
  secret: string;
  otpauth_uri: string;
}

export async function beginTwoFactorSetup(password: string): Promise<TwoFactorSetup> {
  return post<TwoFactorSetup>("setup", { auth_key: await deriveAuthKey(password) });
}

/** Turns two-factor on and returns the recovery codes, which the server never shows again. */
export async function enableTwoFactor(code: string): Promise<string[]> {
  const enabled = await post<SessionTokens & { recovery_codes: string[] }>("enable", { code: code.trim() });
  await adoptSessionTokens(enabled);
  return enabled.recovery_codes;
}

export async function disableTwoFactor(password: string, proof: TwoFactorProof): Promise<void> {
  const auth_key = await deriveAuthKey(password);
  await adoptSessionTokens(await post<SessionTokens>("disable", { auth_key, ...proofBody(proof) }));
}

export async function regenerateRecoveryCodes(proof: TwoFactorProof): Promise<string[]> {
  return (await post<{ recovery_codes: string[] }>("recovery-codes", proofBody(proof))).recovery_codes;
}
