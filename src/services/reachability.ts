import { appFetch } from "@/services/http";

/** The server could not be reached: no HTTP answer, or only one from a proxy in front of it. */
export class UnreachableError extends Error {
  readonly unreachable = true;

  /** Set when a proxy answered for the server, so the network itself works. */
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export function isUnreachable(e: unknown): e is UnreachableError {
  return e instanceof UnreachableError;
}

const CLOUDFLARE_ORIGIN_DOWN = { min: 520, max: 530 };

export function isGatewayStatus(status: number): boolean {
  return (status >= 502 && status <= 504) || (status >= CLOUDFLARE_ORIGIN_DOWN.min && status <= CLOUDFLARE_ORIGIN_DOWN.max);
}

/** The proxy's error page is dropped: it is HTML, and the status says all there is. */
export function gatewayUnreachable(status: number): UnreachableError {
  return new UnreachableError(`HTTP ${status}`, status);
}

export function isProxyAnswer(e: unknown): boolean {
  return isUnreachable(e) && e.status !== undefined;
}

/** `appFetch` whose failures say whether the server was reached at all. Opt-in: other callers rely on the bare rejection. */
export const reachableFetch: typeof appFetch = async (input, init) => {
  let res: Response;
  try {
    res = await appFetch(input, init);
  } catch (e) {
    throw new UnreachableError(e instanceof Error ? e.message : String(e));
  }
  if (isGatewayStatus(res.status)) throw gatewayUnreachable(res.status);
  return res;
};
