import i18n from "@/i18n";
import { appFetch } from "@/services/http";
import { getJwt, isJwtExpiredOrExpiring, tryRefreshJwt } from "@/services/authTokens";

interface AuthFetchOptions {
  /** Send `Content-Type: application/json`. */
  json?: boolean;
  /** Turn a 429 into a translated "rate limited, retry in N" error. */
  rateLimit?: boolean;
}

/**
 * The one authenticated fetch against the sync server: refresh a token that is
 * expired or about to be, send, and retry once if the server still says 401.
 *
 * It existed four times before this — `sync`, `teamVaultSync`, `teamService`
 * and `auditService` — and they had drifted. `auditService`'s copy did neither
 * the pre-refresh nor the retry, so an audit page opened on a stale token
 * failed instead of refreshing rather than recovering. The only two real
 * differences between the others are the options above, which is why they are
 * options and not four near-copies.
 */
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

/** For the JSON APIs, whose callers all send and expect JSON. */
export const fetchAuthJson = (url: string, init: RequestInit = {}): Promise<Response> =>
  fetchAuth(url, init, { json: true });

/**
 * For the sync and team-vault routes, which set their own content types and are
 * the ones the server rate-limits.
 */
export const fetchAuthRateLimited = (url: string, init: RequestInit = {}): Promise<Response> =>
  fetchAuth(url, init, { rateLimit: true });
