import { appFetch } from "@/services/http";

/** The server could not be reached: no HTTP answer, or only one from a proxy in front of it. */
export class UnreachableError extends Error {
  readonly unreachable = true;
}

export function isUnreachable(e: unknown): e is UnreachableError {
  return e instanceof UnreachableError;
}

const CLOUDFLARE_ORIGIN_DOWN = { min: 520, max: 530 };

export function isGatewayStatus(status: number): boolean {
  return (status >= 502 && status <= 504) || (status >= CLOUDFLARE_ORIGIN_DOWN.min && status <= CLOUDFLARE_ORIGIN_DOWN.max);
}

/** `appFetch` whose failures say whether the server was reached at all. Opt-in: other callers rely on the bare rejection. */
export const reachableFetch: typeof appFetch = async (input, init) => {
  let res: Response;
  try {
    res = await appFetch(input, init);
  } catch (e) {
    throw new UnreachableError(e instanceof Error ? e.message : String(e));
  }
  if (isGatewayStatus(res.status)) throw new UnreachableError(`HTTP ${res.status}`);
  return res;
};
