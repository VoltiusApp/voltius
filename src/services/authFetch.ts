import i18n from "@/i18n";
import { appFetch } from "@/services/http";
import { getJwt, isJwtExpiredOrExpiring, tryRefreshJwt } from "@/services/authTokens";

interface AuthFetchOptions {
  json?: boolean;
  /** Turn a 429 into a translated "retry in N" error. */
  rateLimit?: boolean;
}

export async function fetchAuth(
  url: string,
  init: RequestInit = {},
  opts: AuthFetchOptions = {},
): Promise<Response> {
  let jwt = await getJwt();
  if (!jwt || isJwtExpiredOrExpiring(jwt)) {
    jwt = await tryRefreshJwt();
    if (!jwt) throw new Error(i18n.t("common.error.sessionExpired"));
  }
  const makeHeaders = (token: string) => ({
    ...(init.headers as Record<string, string>),
    ...(opts.json ? { "Content-Type": "application/json" } : {}),
    Authorization: `Bearer ${token}`,
  });
  let res = await appFetch(url, { ...init, headers: makeHeaders(jwt) });
  if (res.status === 401) {
    const newJwt = await tryRefreshJwt();
    if (!newJwt) throw new Error(i18n.t("common.error.sessionExpired"));
    res = await appFetch(url, { ...init, headers: makeHeaders(newJwt) });
  }
  if (opts.rateLimit && res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") ?? "60", 10);
    throw new Error(i18n.t("common.error.rateLimited", { seconds: retryAfter }));
  }
  return res;
}

export const fetchAuthJson = (url: string, init: RequestInit = {}): Promise<Response> =>
  fetchAuth(url, init, { json: true });

// Not folded into fetchAuthJson: the sync and vault-key routes set their own
// content types, and they are the ones the server rate-limits.
export const fetchAuthRateLimited = (url: string, init: RequestInit = {}): Promise<Response> =>
  fetchAuth(url, init, { rateLimit: true });
