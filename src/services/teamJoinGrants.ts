import i18n from "@/i18n";
import { fetchAuthJson as fetchAuth } from "@/services/authFetch";
import { getServerUrl } from "@/services/authTokens";

/**
 * Team join grants — the client half of the link that admits someone into a
 * team vault (issue #68; server: `migrations/038_team_join_grants.sql`,
 * `src/routes/team_grants.rs`).
 *
 * A grant confers **membership only, never vault access**. The vault key is
 * wrapped per member with X25519, so it cannot travel in a link: it arrives
 * afterwards, when an online key-holder runs the normal distribution pass. A
 * redeemer therefore lands in `awaiting_key` (issue #41) until that happens,
 * which `TeamVaultStatePanel` already renders as an explicit waiting state.
 *
 * `account_id` appears nowhere here and must never be put in a link: despite
 * the name it is the KDF salt for the user's password.
 */

/** Roles a link may confer. `owner` is a 400 on the server, deliberately. */
export const GRANTABLE_ROLES = ["manager", "editor", "member", "connect-only"] as const;
export type GrantableRole = (typeof GRANTABLE_ROLES)[number];

export function isGrantableRole(role: string): role is GrantableRole {
  return (GRANTABLE_ROLES as readonly string[]).includes(role);
}

/** Server clamps, mirrored so the form cannot ask for something it won't get. */
export const MAX_USES_CEILING = 500;
export const MIN_TTL_SECS = 60;
export const MAX_TTL_SECS = 30 * 24 * 3600;
export const DEFAULT_TTL_SECS = 7 * 24 * 3600;

export interface JoinGrant {
  id: string;
  role: string;
  max_uses: number;
  uses: number;
  expires_at: string;
  created_by: string;
}

/** The mint response. `secret` is returned exactly once and never re-fetchable. */
export interface MintedJoinGrant extends JoinGrant {
  secret: string;
}

export interface JoinGrantPreview {
  team_name: string;
  role: string;
  inviter_handle: string | null;
}

export interface JoinGrantRedemption {
  team_id: string;
  team_name: string;
  role: string;
}

/**
 * Why the server refused. Matched on `code`, never on the message: a message is
 * translated and a translated string is not a protocol.
 */
export type JoinGrantErrorCode =
  | "not_found"
  | "revoked_or_expired"
  | "exhausted"
  | "seat_limit"
  | "no_public_key"
  | "unknown";

export class JoinGrantError extends Error {
  constructor(
    readonly code: JoinGrantErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "JoinGrantError";
  }
}

/**
 * The redeem/preview status contract, read off the server rather than the API
 * doc, which did not pin it: 404 wrong id *or* wrong secret (deliberately
 * indistinguishable), 410 revoked or expired, 409 exhausted, 402 seat cap,
 * 400 on redeem means the redeemer has no published public key.
 */
function grantError(status: number, redeeming: boolean): JoinGrantError {
  switch (status) {
    case 404:
      return new JoinGrantError("not_found", i18n.t("members.joinLinks.error.notFound"));
    case 410:
      return new JoinGrantError("revoked_or_expired", i18n.t("members.joinLinks.error.revokedOrExpired"));
    case 409:
      return new JoinGrantError("exhausted", i18n.t("members.joinLinks.error.exhausted"));
    case 402:
      return new JoinGrantError("seat_limit", i18n.t("members.joinLinks.error.seatLimit"));
    case 400:
      return redeeming
        ? new JoinGrantError("no_public_key", i18n.t("members.joinLinks.error.noPublicKey"))
        : new JoinGrantError("unknown", i18n.t("members.joinLinks.error.generic", { status }));
    default:
      return new JoinGrantError("unknown", i18n.t("members.joinLinks.error.generic", { status }));
  }
}

async function serverUrl(): Promise<string> {
  const url = await getServerUrl();
  if (!url) throw new Error(i18n.t("common.error.notConnectedToServer"));
  return url;
}

export async function createJoinGrant(
  teamId: string,
  opts: { role: GrantableRole; maxUses: number; expiresInSecs: number },
): Promise<MintedJoinGrant> {
  const base = await serverUrl();
  const res = await fetchAuth(`${base}/v1/teams/${teamId}/grants`, {
    method: "POST",
    body: JSON.stringify({
      role: opts.role,
      max_uses: opts.maxUses,
      expires_in_secs: opts.expiresInSecs,
    }),
  });
  if (!res.ok) throw grantError(res.status, false);
  return res.json();
}

/** Live grants only — the server filters revoked and expired rows out. */
export async function listJoinGrants(teamId: string): Promise<JoinGrant[]> {
  const base = await serverUrl();
  const res = await fetchAuth(`${base}/v1/teams/${teamId}/grants`);
  if (!res.ok) throw grantError(res.status, false);
  return res.json();
}

export async function revokeJoinGrant(teamId: string, grantId: string): Promise<void> {
  const base = await serverUrl();
  const res = await fetchAuth(`${base}/v1/teams/${teamId}/grants/${grantId}`, { method: "DELETE" });
  if (!res.ok) throw grantError(res.status, false);
}

/**
 * What the link names, before the holder commits to joining. Read-only: it
 * consumes no use, and the server re-checks revocation and expiry again inside
 * the redemption transaction, so nothing here is cached as a decision.
 */
export async function previewJoinGrant(grantId: string, secret: string): Promise<JoinGrantPreview> {
  const base = await serverUrl();
  const res = await fetchAuth(`${base}/v1/grants/${grantId}/preview`, {
    method: "POST",
    body: JSON.stringify({ secret }),
  });
  if (!res.ok) throw grantError(res.status, false);
  return res.json();
}

/**
 * Redeem. `publicKey` fills a NULL on the user row and never overwrites one —
 * overwriting would orphan every vault key already wrapped to the old key — and
 * a redeemer who has published none is refused with a 400 rather than admitted
 * into a vault that could never fill.
 */
export async function redeemJoinGrant(
  grantId: string,
  secret: string,
  publicKey?: string | null,
): Promise<JoinGrantRedemption> {
  const base = await serverUrl();
  const res = await fetchAuth(`${base}/v1/grants/${grantId}/redeem`, {
    method: "POST",
    body: JSON.stringify(publicKey ? { secret, public_key: publicKey } : { secret }),
  });
  if (!res.ok) throw grantError(res.status, true);
  return res.json();
}
