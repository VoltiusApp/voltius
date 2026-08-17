import { isSessionId } from "@/services/sessionId";

export type JoinIntent = { route: "join"; sessionId: string; token: string };
export type VerifiedIntent = { route: "verified"; userId: string };
export type DeepLinkIntent = JoinIntent | VerifiedIntent;

/** Routes whose link carries a capability. Nothing happens until the user accepts. */
export type ConfirmIntent = JoinIntent;
/** Routes whose link carries nothing. Safe to act on unprompted. */
export type SilentIntent = VerifiedIntent;

type TrustClass = "confirm" | "silent";

interface RouteSpec {
  trust: TrustClass;
  parse: (params: URLSearchParams) => DeepLinkIntent | null;
}

const ROUTES: Record<string, RouteSpec> = {
  join: {
    trust: "confirm",
    parse: (params) => {
      const sessionId = params.get("s") ?? "";
      const token = params.get("t") ?? "";
      if (!isSessionId(sessionId) || !token) return null;
      return { route: "join", sessionId, token };
    },
  },
  verified: {
    // Carries no credential: the token died server-side before this link was
    // built, and the user id authorises nothing. A hostile link costs a
    // session refresh, which is a no-op.
    trust: "silent",
    parse: (params) => {
      const userId = params.get("u") ?? "";
      if (!isSessionId(userId)) return null;
      return { route: "verified", userId };
    },
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
  const spec = ROUTES[route];
  if (!spec) return null;
  return spec.parse(parsed.searchParams);
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
  return ROUTES[intent.route].trust === "confirm";
}

export function isSilentIntent(intent: DeepLinkIntent): intent is SilentIntent {
  return ROUTES[intent.route].trust === "silent";
}
