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
 * The server deletes the account row only; it never cancels the Lemon Squeezy
 * subscription. A subscription that is still set to renew keeps charging after
 * the account is gone, so the user has to be told to cancel it first.
 */
export function subscriptionStillBills(sub: {
  billingEnabled: boolean;
  status: string | null;
  cancelled: boolean;
}): boolean {
  return sub.billingEnabled && !!sub.status && !ENDED_STATUSES.has(sub.status) && !sub.cancelled;
}
