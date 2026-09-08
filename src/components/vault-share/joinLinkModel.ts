import { MAX_TTL_SECS, MAX_USES_CEILING, MIN_TTL_SECS } from "@/services/teamJoinGrants";

export const TTL_PRESETS = [
  { key: "hour1", secs: 3600 },
  { key: "day1", secs: 24 * 3600 },
  { key: "day7", secs: 7 * 24 * 3600 },
  { key: "day30", secs: MAX_TTL_SECS },
] as const;

export const USES_PRESETS = [1, 5, 25, MAX_USES_CEILING] as const;

export function clampTtlSecs(secs: number): number {
  return Math.min(Math.max(Math.round(secs), MIN_TTL_SECS), MAX_TTL_SECS);
}

export function clampMaxUses(uses: number): number {
  return Math.min(Math.max(Math.round(uses), 1), MAX_USES_CEILING);
}

export type ExpiryLabel =
  | { unit: "expired" }
  | { unit: "minutes" | "hours" | "days"; count: number };

// The unit floors but the count rounds: flooring both showed "6 days left" on a
// link minted seconds earlier with a 7-day life.
export function expiresIn(expiresAt: string, now: number = Date.now()): ExpiryLabel {
  const remainingMs = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(remainingMs) || remainingMs < 60_000) return { unit: "expired" };
  const minutes = remainingMs / 60_000;
  if (minutes < 60) return { unit: "minutes", count: Math.round(minutes) };
  const hours = minutes / 60;
  if (hours < 24) return { unit: "hours", count: Math.round(hours) };
  return { unit: "days", count: Math.round(hours / 24) };
}

export function usesRemaining(grant: { uses: number; max_uses: number }): number {
  return Math.max(0, grant.max_uses - grant.uses);
}
