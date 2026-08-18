import { isSessionId } from "@/services/sessionId";
import { isSettingsSection, type SettingsSection } from "@/stores/uiStore";

export type JoinIntent = { route: "join"; sessionId: string; token: string };
export type VerifiedIntent = { route: "verified"; userId: string };
export type NotificationIntent = { route: "notification"; entryId: string | null };
export type SettingsIntent = { route: "settings"; section: SettingsSection };
export type BillingIntent = { route: "billing" };
export type DeepLinkIntent =
  | JoinIntent
  | VerifiedIntent
  | NotificationIntent
  | SettingsIntent
  | BillingIntent;

type TrustClass = "confirm" | "silent" | "navigate";
type Route = DeepLinkIntent["route"];

/**
 * The single declaration of trust:
 *
 * - `confirm` routes carry a capability and nothing happens until the user
 *   accepts.
 * - `silent` routes carry no capability and run a side effect unprompted.
 *   `verified` is silent because the token died server-side before the link was
 *   built and the user id authorises nothing, so a hostile link costs a session
 *   refresh, which is a no-op.
 * - `navigate` routes only move the user to a screen they could already reach.
 *   The worst a hostile link achieves is an unexpected panel, so they need no
 *   prompt — but they must never *act*: `billing` opens the account section and
 *   deliberately does not start a checkout.
 */
const TRUST = {
  join: "confirm",
  verified: "silent",
  notification: "navigate",
  settings: "navigate",
  billing: "navigate",
} as const satisfies Record<Route, TrustClass>;

type RouteOfClass<C extends TrustClass> = {
  [K in Route]: (typeof TRUST)[K] extends C ? K : never;
}[Route];

export type ConfirmIntent = Extract<DeepLinkIntent, { route: RouteOfClass<"confirm"> }>;
export type SilentIntent = Extract<DeepLinkIntent, { route: RouteOfClass<"silent"> }>;
export type NavigateIntent = Extract<DeepLinkIntent, { route: RouteOfClass<"navigate"> }>;
/** Everything that runs without asking the user first. */
export type UnpromptedIntent = SilentIntent | NavigateIntent;

/**
 * One codec per route, both directions declared together so the builder and the
 * parser cannot drift as routes are added.
 */
type RouteCodec<K extends Route> = {
  parse: (params: URLSearchParams) => Extract<DeepLinkIntent, { route: K }> | null;
  params: (intent: Extract<DeepLinkIntent, { route: K }>) => Record<string, string>;
};

/** Long enough for any id the inbox builds, short enough to stay a lookup key. */
const MAX_ENTRY_ID = 200;

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
  notification: {
    // The id is opaque here: inbox ids are re-derived from server state on every
    // reconcile, so this cannot check one exists. It is length-capped and the
    // entry is looked up by exact match, so an unknown id just opens the centre.
    parse: (params) => {
      const entryId = params.get("n") ?? "";
      if (entryId.length > MAX_ENTRY_ID) return null;
      return { route: "notification", entryId: entryId || null };
    },
    params: ({ entryId }): Record<string, string> => (entryId ? { n: entryId } : {}),
  },
  settings: {
    parse: (params) => {
      const section = params.get("section") ?? "";
      if (!isSettingsSection(section)) return null;
      return { route: "settings", section };
    },
    params: ({ section }) => ({ section }),
  },
  billing: {
    parse: () => ({ route: "billing" }),
    params: () => ({}),
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
  // A parameterless route (`billing`) must not end in a bare `?`: the two forms
  // have to round-trip through `parseDeepLink` byte for byte.
  const suffix = query ? `?${query}` : "";
  return form === "scheme"
    ? `voltius://${intent.route}${suffix}`
    : `${WEB_ORIGIN}${WEB_PATH}#${intent.route}${suffix}`;
}

const WEB_HOSTS = new Set(["voltius.app", "www.voltius.app"]);

export function parseDeepLink(url: string): DeepLinkIntent | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  if (parsed.protocol === "voltius:") {
    // Custom schemes are not special-scheme URLs, so the route lands in
    // `hostname` on some platforms and `pathname` on others.
    const route = parsed.hostname || parsed.pathname.replace(/^\/+/, "");
    return parseRoute(route, parsed.searchParams);
  }

  // The `https` fallback form. `http` is rejected: an App Link registered for
  // cleartext would be hijackable on a hostile network.
  if (
    parsed.protocol === "https:" &&
    WEB_HOSTS.has(parsed.hostname) &&
    parsed.pathname.replace(/\/+$/, "") === WEB_PATH
  ) {
    return parseFragment(parsed.hash);
  }

  return null;
}

/** `#join?s=…&t=…` — the route, then its parameters, all after the hash. */
function parseFragment(hash: string): DeepLinkIntent | null {
  const body = hash.replace(/^#/, "");
  if (!body) return null;
  const queryAt = body.indexOf("?");
  const route = queryAt === -1 ? body : body.slice(0, queryAt);
  const params = new URLSearchParams(queryAt === -1 ? "" : body.slice(queryAt + 1));
  return parseRoute(route, params);
}

function parseRoute(route: string, params: URLSearchParams): DeepLinkIntent | null {
  if (!isRoute(route)) return null;
  return ROUTES[route].parse(params);
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

export function isNavigateIntent(intent: DeepLinkIntent): intent is NavigateIntent {
  return TRUST[intent.route] === "navigate";
}

/** A route that acts without a prompt, whether it navigates or runs a side effect. */
export function isUnpromptedIntent(intent: DeepLinkIntent): intent is UnpromptedIntent {
  return isSilentIntent(intent) || isNavigateIntent(intent);
}
