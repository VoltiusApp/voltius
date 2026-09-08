import { MAX_TTL_SECS, MAX_USES_CEILING, MIN_TTL_SECS } from "@/services/teamJoinGrants";

/** TTL presets, all inside the server's own `[60, 2592000]` clamp. */
export const TTL_PRESETS = [
  { key: "hour1", secs: 3600 },
  { key: "day1", secs: 24 * 3600 },
  { key: "day7", secs: 7 * 24 * 3600 },
  { key: "day30", secs: MAX_TTL_SECS },
] as const;

/** Use presets, all inside the server's own `[1, 500]` clamp. */
export const USES_PRESETS = [1, 5, 25, MAX_USES_CEILING] as const;

/**
 * Mirrors the server's clamps rather than trusting the form. A request the
 * server would silently reshape is a link whose printed terms are a lie.
 */
export function clampTtlSecs(secs: number): number {
  return Math.min(Math.max(Math.round(secs), MIN_TTL_SECS), MAX_TTL_SECS);
}

export function clampMaxUses(uses: number): number {
  return Math.min(Math.max(Math.round(uses), 1), MAX_USES_CEILING);
}

export type ExpiryLabel =
  | { unit: "expired" }
  | { unit: "minutes" | "hours" | "days"; count: number };

/**
 * How long a live grant has left, as a unit and a count for the caller to
 * translate. Anything under a minute reads as expired rather than "0 minutes".
 *
 * The unit is picked by flooring but the count is rounded to nearest, so a link
 * minted seconds ago with a 7-day life reads "7 days left" rather than "6" —
 * flooring there looked like a bug and taught the user to distrust the number.
 * The count is a hint either way: the row carries the exact expiry as a
 * tooltip, and the server, not this, decides when the grant stops working.
 */
export function expiresIn(expiresAt: string, now: number = Date.now()): ExpiryLabel {
  const remainingMs = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(remainingMs) || remainingMs < 60_000) return { unit: "expired" };
  const minutes = remainingMs / 60_000;
  if (minutes < 60) return { unit: "minutes", count: Math.round(minutes) };
  const hours = minutes / 60;
  if (hours < 24) return { unit: "hours", count: Math.round(hours) };
  return { unit: "days", count: Math.round(hours / 24) };
}

/** Uses left on a grant, never negative even if the server ever over-issued. */
export function usesRemaining(grant: { uses: number; max_uses: number }): number {
  return Math.max(0, grant.max_uses - grant.uses);
}
