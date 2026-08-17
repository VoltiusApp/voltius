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

type RouteParsers = {
  [K in Route]: (params: URLSearchParams) => Extract<DeepLinkIntent, { route: K }> | null;
};

const ROUTES: RouteParsers = {
  join: (params) => {
    const sessionId = params.get("s") ?? "";
    const token = params.get("t") ?? "";
    if (!isSessionId(sessionId) || !token) return null;
    return { route: "join", sessionId, token };
  },
  verified: (params) => {
    const userId = params.get("u") ?? "";
    if (!isSessionId(userId)) return null;
    return { route: "verified", userId };
  },
};

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
  return ROUTES[route](parsed.searchParams);
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
