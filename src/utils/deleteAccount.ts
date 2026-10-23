/** Typed instead of the email when this device has no email on record for the account. */
export const DELETE_ACCOUNT_KEYWORD = "DELETE";

/** What the user must type to confirm: their account email, or the keyword as a fallback. */
export function deleteConfirmationTarget(email: string | null): string {
  return email?.trim() || DELETE_ACCOUNT_KEYWORD;
}

/** Emails compare case-insensitively (the server lowercases them); the keyword must match exactly. */
export function isDeleteConfirmed(input: string, email: string | null): boolean {
  const target = deleteConfirmationTarget(email);
  const typed = input.trim();
  return target === DELETE_ACCOUNT_KEYWORD ? typed === target : typed.toLowerCase() === target.toLowerCase();
}

const ENDED_STATUSES = new Set(["cancelled", "expired"]);

/**
 * A subscription still set to renew. The server cancels it as part of the
 * deletion (and refuses to delete if it cannot), so the dialog only says so.
 */
export function subscriptionRenews(sub: {
  billingEnabled: boolean;
  status: string | null;
  cancelled: boolean;
}): boolean {
  return sub.billingEnabled && !!sub.status && !ENDED_STATUSES.has(sub.status) && !sub.cancelled;
}

/** An i18n key and its params, for the message shown when the server refuses a deletion. */
export interface DeleteAccountFailure {
  key: string;
  params: Record<string, string | number>;
}

/**
 * Maps a failed DELETE /v1/auth/account to a message. The server answers
 * `{ error: CODE }`: 409 OWNS_TEAM_WITH_MEMBERS (with the blocking `teams`) when
 * the user owns a team others still belong to, 502 SUBSCRIPTION_CANCEL_FAILED
 * when Lemon Squeezy would not stop the renewal. Anything else is generic.
 */
export function deleteAccountFailure(status: number, body: unknown): DeleteAccountFailure {
  const b = (body && typeof body === "object" ? body : {}) as { error?: unknown; teams?: unknown };
  if (b.error === "OWNS_TEAM_WITH_MEMBERS") {
    const names = Array.isArray(b.teams)
      ? b.teams.map((t) => (t && typeof t === "object" ? (t as { name?: unknown }).name : undefined))
          .filter((n): n is string => typeof n === "string" && n.trim() !== "")
      : [];
    return { key: "shared.deleteAccount.ownsTeamWithMembers", params: { teams: names.join(", ") || "?" } };
  }
  if (b.error === "SUBSCRIPTION_CANCEL_FAILED") {
    return { key: "shared.deleteAccount.subscriptionCancelFailed", params: {} };
  }
  return { key: "shared.deleteAccount.failed", params: { status } };
}
