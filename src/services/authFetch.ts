import i18n from "@/i18n";
import { appFetch } from "@/services/http";
import { getJwt, isJwtExpiredOrExpiring, tryRefreshJwt } from "@/services/authTokens";
import { clientHeaders } from "@/services/clientHeaders";

interface AuthFetchOptions {
  json?: boolean;
  /** Turn a 429 into a translated "retry in N" error. */
  rateLimit?: boolean;
  /** Carries the request and any token refresh it needs. */
  fetchImpl?: typeof appFetch;
}

// The native request cannot be cancelled mid-flight; this only stops the next step from starting.
function assertNotAborted(signal: AbortSignal | null | undefined): void {
  if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
}

export async function fetchAuth(
  url: string,
  init: RequestInit = {},
  opts: AuthFetchOptions = {},
): Promise<Response> {
  const send = opts.fetchImpl ?? appFetch;
  let jwt = await getJwt();
  if (!jwt || isJwtExpiredOrExpiring(jwt)) {
    assertNotAborted(init.signal);
    jwt = await tryRefreshJwt(opts.fetchImpl);
    if (!jwt) throw new Error(i18n.t("common.error.sessionExpired"));
  }
  const capability = await clientHeaders();
  const makeHeaders = (token: string) => ({
    ...capability,
    ...(init.headers as Record<string, string>),
    ...(opts.json ? { "Content-Type": "application/json" } : {}),
    Authorization: `Bearer ${token}`,
  });
  const request = (token: string) => {
    assertNotAborted(init.signal);
    return send(url, { ...init, headers: makeHeaders(token) });
  };
  let res = await request(jwt);
  if (res.status === 401) {
    assertNotAborted(init.signal);
    const newJwt = await tryRefreshJwt(opts.fetchImpl);
    if (!newJwt) throw new Error(i18n.t("common.error.sessionExpired"));
    res = await request(newJwt);
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
export const fetchAuthRateLimited = (url: string, init: RequestInit = {}, fetchImpl?: typeof appFetch): Promise<Response> =>
  fetchAuth(url, init, { rateLimit: true, fetchImpl });
