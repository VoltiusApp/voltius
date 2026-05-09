import type { AuditLog } from "@/services/auditService";

export type AuditTimeRange = "last-day" | "last-week" | "last-month" | "all" | "custom";

const RANGE_MS: Record<Exclude<AuditTimeRange, "all" | "custom">, number> = {
  "last-day": 24 * 60 * 60 * 1000,
  "last-week": 7 * 24 * 60 * 60 * 1000,
  "last-month": 30 * 24 * 60 * 60 * 1000,
};

export function getAuditTimeRange(range: AuditTimeRange, now = new Date()): { from?: string; to?: string } {
  if (range === "all" || range === "custom") return { from: undefined, to: undefined };
  return { from: new Date(now.getTime() - RANGE_MS[range]).toISOString(), to: undefined };
}

export function applyAuditLogSearch(logs: AuditLog[], search: string): AuditLog[] {
  const query = search.trim().toLowerCase();
  if (!query) return logs;

  return logs.filter((log) => {
    const haystack = [
      log.actor_name,
      log.actor_id,
      log.action,
      log.source,
      log.target_type,
      log.target_id,
      log.target_name,
      log.ip_address,
      log.metadata ? JSON.stringify(log.metadata) : "",
    ].join(" ").toLowerCase();

    return haystack.includes(query);
  });
}
