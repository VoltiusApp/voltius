import i18n from "@/i18n";
import { fetchAuthJson as fetchAuth } from "@/services/authFetch";
import { getServerUrl } from "@/services/authTokens";

// A grant confers team membership, never vault access: the vault key is wrapped
// per member with X25519, so it follows separately and the redeemer sits in
// `awaiting_key` until a key-holder wraps it.

/** `owner` is absent deliberately — the server answers 400 for it. */
export const GRANTABLE_ROLES = ["manager", "editor", "member", "connect-only"] as const;
export type GrantableRole = (typeof GRANTABLE_ROLES)[number];

export function isGrantableRole(role: string): role is GrantableRole {
  return (GRANTABLE_ROLES as readonly string[]).includes(role);
}

/** Server-side clamps, mirrored so the form cannot ask for what it won't get. */
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

/** `secret` is returned by this call only; the server stores just its sha256. */
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

export type JoinGrantErrorCode =
  | "not_found"
  | "revoked_or_expired"
  | "exhausted"
  | "seat_limit"
  | "no_public_key"
  | "unknown";

/** Carries a code so callers never match on a translated message. */
export class JoinGrantError extends Error {
  constructor(
    readonly code: JoinGrantErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "JoinGrantError";
  }
}

// 404 covers a wrong id and a wrong secret alike, deliberately. 400 means
// "no published public key" only when redeeming.
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

/** Consumes no use; the server re-checks validity inside the redeem transaction. */
export async function previewJoinGrant(grantId: string, secret: string): Promise<JoinGrantPreview> {
  const base = await serverUrl();
  const res = await fetchAuth(`${base}/v1/grants/${grantId}/preview`, {
    method: "POST",
    body: JSON.stringify({ secret }),
  });
  if (!res.ok) throw grantError(res.status, false);
  return res.json();
}

// `public_key` fills a NULL only and never overwrites — overwriting would orphan
// every vault key already wrapped to the old one.
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
