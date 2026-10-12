import type { SyncStatus } from "@/services/sync";

export type SignOutRisk = "no-server-copy" | "unsynced";

// Signing out erases this device's copy: either the only one, or one that may be ahead of the server's.
export function signOutRisk(account: { isPro: boolean; paused: boolean; status: SyncStatus }): SignOutRisk | null {
  if (!account.isPro) return "no-server-copy";
  if (account.paused || account.status === "offline" || account.status === "error") return "unsynced";
  return null;
}
