import { isSessionId } from "@/services/sessionId";
import { isSettingsSection, type SettingsSection } from "@/stores/uiStore";
import { isValidPluginId } from "@/plugins/pluginId";

export type JoinIntent = { route: "join"; sessionId: string; token: string };
export type InviteIntent = { route: "invite"; handle: string };
export type VerifiedIntent = { route: "verified"; userId: string };
export type NotificationIntent = { route: "notification"; entryId: string | null };
export type SettingsIntent = { route: "settings"; section: SettingsSection };
export type BillingIntent = { route: "billing" };
export type SnippetInstallIntent = { route: "snippet-install"; entryId: string };
export type PluginInstallIntent = { route: "plugin-install"; pluginId: string; sourceId: string };
export type DeepLinkIntent =
  | JoinIntent
  | InviteIntent
  | VerifiedIntent
  | NotificationIntent
  | SettingsIntent
  | BillingIntent
  | SnippetInstallIntent
  | PluginInstallIntent;

type TrustClass = "confirm" | "attenuated" | "silent" | "navigate";
type Route = DeepLinkIntent["route"];

/**
 * The single declaration of trust:
 *
 * - `confirm` routes carry a capability and nothing happens until the user
 *   accepts.
 * - `attenuated` routes carry a real capability, worn down by scope, lifetime
 *   and blast radius until acting on it unprompted is safe. The bar is not "the
 *   link is probably genuine": it is that a forged link, tapped by the wrong
 *   person at the wrong moment, still costs the tapping user nothing.
 *
 *   `verified` is the only member, and is classified on the strongest form it
 *   could carry rather than the weakest form it carries today. Today the portal
 *   spends the verification token server-side and the app receives an inert
 *   user id, which would also satisfy `silent`; a mail link that opened the app
 *   directly would hand it the raw token instead. That capability is a
 *   single-use, short-lived token, bound server-side to one account, proving an
 *   address is reachable — no session, no key material, no grant. So a hostile
 *   `verified` link carries the *attacker's* own token: tapping it verifies the
 *   attacker's address, which the attacker can already do unaided, and touches
 *   nothing of the tapper's. A consent sheet on a tap the user asked for by
 *   pressing "verify my email" buys none of that back, and spends the user's
 *   willingness to read the sheets that do carry a capability.
 *
 *   The class stops being honest the moment a `verified` link carries something
 *   a forged one could spend *against* the tapper — a session, a wrapped key, an
 *   account-scoped grant. That route is `confirm`, not `attenuated`.
 *
 *   The stronger form stays hypothetical because mailing the raw token was
 *   considered and rejected. Enterprise rewriters (Outlook SafeLinks, Defender
 *   ATP) re-encode a mailed link onto their own logging host, so the tap
 *   resolves against *that* host: no App Link fires, the mail client's own
 *   browser follows the redirect, and the app never sees the link at all.
 *   Whether a fragment even survives that round trip is undocumented, while the
 *   one rewriter behaviour that is documented mangles query structure. A carrier
 *   that can silently drop the token is not worth what it would buy, which is
 *   one browser tab: the portal already hands the app a `verified` link the
 *   moment it succeeds.
 * - `silent` routes carry no capability at all and run a side effect unprompted.
 *   Currently unpopulated: it is the narrower claim `verified` used to make,
 *   kept for a route that genuinely carries nothing.
 * - `navigate` routes only move the user to a screen they could already reach.
 *   The worst a hostile link achieves is an unexpected panel, so they need no
 *   prompt — but they must never *act*: `billing` opens the account section and
 *   deliberately does not start a checkout.
 */
const TRUST = {
  join: "confirm",
  // Grants a stranger access to a live terminal, so nothing happens until the
  // host accepts.
  invite: "confirm",
  verified: "attenuated",
  notification: "navigate",
  settings: "navigate",
  billing: "navigate",
  // Writes snippets — shell commands the user will later run — into a vault, so
  // nothing lands until the user accepts.
  "snippet-install": "confirm",
  // Executes third-party code on this machine. The strongest confirm on the list:
  // the sheet names the plugin, its catalogue and its permissions before the
  // accept button does anything.
  "plugin-install": "confirm",
} as const satisfies Record<Route, TrustClass>;

type RouteOfClass<C extends TrustClass> = {
  [K in Route]: (typeof TRUST)[K] extends C ? K : never;
}[Route];

export type ConfirmIntent = Extract<DeepLinkIntent, { route: RouteOfClass<"confirm"> }>;
export type AttenuatedIntent = Extract<DeepLinkIntent, { route: RouteOfClass<"attenuated"> }>;
/** `never` while `silent` has no members; kept so a future route has a home. */
export type SilentIntent = Extract<DeepLinkIntent, { route: RouteOfClass<"silent"> }>;
export type NavigateIntent = Extract<DeepLinkIntent, { route: RouteOfClass<"navigate"> }>;
/** Everything that runs without asking the user first. */
export type UnpromptedIntent = AttenuatedIntent | SilentIntent | NavigateIntent;

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

/** Long enough for any catalogue id upstream authors, short enough to stay a key. */
const MAX_CATALOG_ID = 100;

/**
 * The catalogue a `plugin-install` link means when it names none. Kept as a
 * literal rather than importing `FIRST_PARTY_SOURCE`, so the parser stays free of
 * the marketplace store (and of `@tauri-apps/api`, which every parser test would
 * then have to stub). A test pins the two together.
 */
export const DEFAULT_PLUGIN_SOURCE_ID = "voltius";

/** A source id is a catalogue key, not a URL; this only stops an absurd one. */
const MAX_SOURCE_ID = 100;

/**
 * Mirrors the server's custom-handle rule (server: `src/handles.rs`,
 * `validate_custom_handle`): 3–30 ASCII lowercase/digit/`-`/`_`, never starting
 * or ending in a separator. Generated handles (`adjective-noun-1234`) satisfy it
 * too. The reserved-name list is deliberately not mirrored: it governs *claiming*
 * a handle, not looking one up, and a link naming a reserved handle resolves to
 * nobody anyway.
 */
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/;

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
  invite: {
    // The `@` is how a handle is written throughout the UI, so links carry it;
    // it is display sugar and never part of the stored value.
    parse: (params) => {
      const handle = (params.get("h") ?? "").replace(/^@/, "").toLowerCase();
      if (!HANDLE_RE.test(handle)) return null;
      return { route: "invite", handle };
    },
    params: ({ handle }) => ({ h: `@${handle}` }),
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
  "snippet-install": {
    parse: (params) => {
      const entryId = params.get("id") ?? "";
      // Opaque beyond its length: the catalogue is fetched at confirm time, and an
      // id it does not list fails there, where the sheet can say so.
      if (!entryId || entryId.length > MAX_CATALOG_ID) return null;
      return { route: "snippet-install", entryId };
    },
    params: ({ entryId }) => ({ id: entryId }),
  },
  "plugin-install": {
    parse: (params) => {
      const pluginId = params.get("id") ?? "";
      // Validated here rather than at install time: the id becomes a directory
      // name under the plugins folder, and `assertValidPluginId` throws far too
      // late to render a sheet from.
      if (!isValidPluginId(pluginId)) return null;
      // A source *id* already configured on this device, never a URL. A link able
      // to name a new source is a link able to introduce a new code source; the
      // sheet resolves this against the user's own enabled sources and fails when
      // it matches none.
      const sourceId = params.get("src") || DEFAULT_PLUGIN_SOURCE_ID;
      if (sourceId.length > MAX_SOURCE_ID) return null;
      return { route: "plugin-install", pluginId, sourceId };
    },
    params: ({ pluginId, sourceId }) => ({ id: pluginId, src: sourceId }),
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

/** One guard per trust class, all reading the same single declaration. */
const isOfClass =
  <C extends TrustClass>(trust: C) =>
  (intent: DeepLinkIntent): intent is Extract<DeepLinkIntent, { route: RouteOfClass<C> }> =>
    TRUST[intent.route] === trust;

export const isConfirmIntent = isOfClass("confirm");
export const isAttenuatedIntent = isOfClass("attenuated");
export const isSilentIntent = isOfClass("silent");
export const isNavigateIntent = isOfClass("navigate");

/** A route that acts without a prompt, whether it navigates or runs a side effect. */
export function isUnpromptedIntent(intent: DeepLinkIntent): intent is UnpromptedIntent {
  // Listed class by class rather than as "not `confirm`", so a class added
  // later has to be admitted here deliberately instead of by default.
  return isAttenuatedIntent(intent) || isSilentIntent(intent) || isNavigateIntent(intent);
}
