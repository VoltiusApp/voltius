export interface AuditFilterInput {
  actions?: string[];
  actor_id?: string;
  from?: string;
  to?: string;
}

export function applyAuditFilters<T extends { action: string; actor_id: string; created_at: string }>(
  logs: T[],
  filters: AuditFilterInput,
): T[] {
  const from = filters.from ? Date.parse(filters.from) : null;
  const to = filters.to ? Date.parse(filters.to) : null;
  return logs.filter((log) => {
    if (filters.actions?.length && !filters.actions.includes(log.action)) return false;
    if (filters.actor_id && log.actor_id !== filters.actor_id) return false;
    const created = Date.parse(log.created_at);
    if (from !== null && Number.isFinite(from) && created < from) return false;
    if (to !== null && Number.isFinite(to) && created > to) return false;
    return true;
  });
}

/** Neutralize spreadsheet formula triggers before CSV quoting (Decision 1B). */
function neutralizeFormula(s: string): string {
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

export function csvEscape(value: unknown): string {
  const s = neutralizeFormula(value == null ? "" : String(value));
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
