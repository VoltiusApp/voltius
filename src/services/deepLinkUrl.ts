import { isSessionId } from "@/services/sessionId";

export type JoinIntent = { route: "join"; sessionId: string; token: string };
export type VerifiedIntent = { route: "verified"; userId: string };
export type DeepLinkIntent = JoinIntent | VerifiedIntent;

type TrustClass = "confirm" | "silent";
type Route = DeepLinkIntent["route"];

/**
 * The single declaration of trust: `confirm` routes carry a capability and
 * nothing happens until the user accepts; `silent` routes carry nothing and act
 * unprompted. `verified` is silent because the token died server-side before
 * the link was built and the user id authorises nothing, so a hostile link
 * costs a session refresh, which is a no-op.
 */
const TRUST = {
  join: "confirm",
  verified: "silent",
} as const satisfies Record<Route, TrustClass>;

type RouteOfClass<C extends TrustClass> = {
  [K in Route]: (typeof TRUST)[K] extends C ? K : never;
}[Route];

export type ConfirmIntent = Extract<DeepLinkIntent, { route: RouteOfClass<"confirm"> }>;
export type SilentIntent = Extract<DeepLinkIntent, { route: RouteOfClass<"silent"> }>;

/**
 * One codec per route, both directions declared together so the builder and the
 * parser cannot drift as routes are added.
 */
type RouteCodec<K extends Route> = {
  parse: (params: URLSearchParams) => Extract<DeepLinkIntent, { route: K }> | null;
  params: (intent: Extract<DeepLinkIntent, { route: K }>) => Record<string, string>;
};

const ROUTES: { [K in Route]: RouteCodec<K> } = {
  join: {
    parse: (params) => {
      const sessionId = params.get("s") ?? "";
      const token = params.get("t") ?? "";
      if (!isSessionId(sessionId) || !token) return null;
      return { route: "join", sessionId, token };
    },
    params: ({ sessionId, token }) => ({ s: sessionId, t: token }),
  },
  verified: {
    parse: (params) => {
      const userId = params.get("u") ?? "";
      if (!isSessionId(userId)) return null;
      return { route: "verified", userId };
    },
    params: ({ userId }) => ({ u: userId }),
  },
};

export type LinkForm = "https" | "scheme";

/** The landing site that bridges an `https` link back to the scheme. */
export const WEB_ORIGIN = "https://voltius.app";
const WEB_PATH = "/open";

/**
 * The one link builder. Every route goes through it; a new route means a new
 * entry in `ROUTES`, never a second builder.
 *
 * The `https` form carries the route in the fragment, so a join token never
 * reaches a web server log, a CDN, or a `Referer` header.
 */
export function buildDeepLink(intent: DeepLinkIntent, form: LinkForm = "https"): string {
  // The codec is picked by the intent's own route, so the pairing is right by
  // construction — TypeScript cannot prove that through the index.
  const codec = ROUTES[intent.route] as RouteCodec<Route>;
  const query = new URLSearchParams(codec.params(intent)).toString();
  return form === "scheme"
    ? `voltius://${intent.route}?${query}`
    : `${WEB_ORIGIN}${WEB_PATH}#${intent.route}?${query}`;
}

export function parseDeepLink(url: string): DeepLinkIntent | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "voltius:") return null;
  // Custom schemes are not special-scheme URLs, so the route lands in `hostname`
  // on some platforms and `pathname` on others.
  const route = parsed.hostname || parsed.pathname.replace(/^\/+/, "");
  if (!isRoute(route)) return null;
  return ROUTES[route].parse(parsed.searchParams);
}

// Own-property only: `"toString" in TRUST` is true, and an inherited hit would
// resolve to a function rather than a route.
function isRoute(value: string): value is Route {
  return Object.prototype.hasOwnProperty.call(TRUST, value);
}

/**
 * A stable string identity for an intent, used only for in-memory dedupe. It
 * embeds the join token, so it must never be logged.
 */
export function intentKey(intent: DeepLinkIntent): string {
  return Object.entries(intent)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("&");
}

export function isConfirmIntent(intent: DeepLinkIntent): intent is ConfirmIntent {
  return TRUST[intent.route] === "confirm";
}

export function isSilentIntent(intent: DeepLinkIntent): intent is SilentIntent {
  return TRUST[intent.route] === "silent";
}
