import type { TeamVaultStatus } from "@/stores/teamVaultStateStore";

export type TeamObjectListErrorAction = "fallback" | Extract<TeamVaultStatus, "offline" | "forbidden" | "payment_required">;

export function classifyTeamObjectListError(err: unknown): TeamObjectListErrorAction {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("403") || message.toLowerCase().includes("permission")) return "forbidden";
  if (message.includes("402") || message.toLowerCase().includes("subscription")) return "payment_required";
  if (message.toLowerCase().includes("network") || message.toLowerCase().includes("connected")) return "offline";
  return "fallback";
}
