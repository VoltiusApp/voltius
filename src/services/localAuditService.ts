import type { AuditFilters, AuditLog } from "@/services/auditService";
import type { AuditTarget } from "@/services/auditContext";

const LOCAL_AUDIT_KEY = "voltius-local-audit-logs";

type ClientAction = "connection.started" | "connection.ended" | "secret.viewed";

interface LocalAuditLog extends AuditLog {
  team_id: "local";
}

interface LocalAuditDb {
  nextId: number;
  logsByVault: Record<string, LocalAuditLog[]>;
}

function emptyDb(): LocalAuditDb {
  return { nextId: 1, logsByVault: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isLocalAuditLog(value: unknown): value is LocalAuditLog {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "number" &&
    Number.isFinite(value.id) &&
    value.team_id === "local" &&
    (typeof value.vault_id === "string" || value.vault_id === null) &&
    typeof value.actor_id === "string" &&
    typeof value.actor_name === "string" &&
    typeof value.action === "string" &&
    (value.source === "server" || value.source === "client") &&
    (typeof value.target_type === "string" || value.target_type === null) &&
    (typeof value.target_id === "string" || value.target_id === null) &&
    (typeof value.target_name === "string" || value.target_name === null) &&
    (isRecord(value.metadata) || value.metadata === null) &&
    (typeof value.ip_address === "string" || value.ip_address === null) &&
    typeof value.created_at === "string"
  );
}

function sanitizeLogsByVault(value: unknown): Record<string, LocalAuditLog[]> {
  if (!isRecord(value)) return {};

  const logsByVault: Record<string, LocalAuditLog[]> = {};
  for (const [vaultId, logs] of Object.entries(value)) {
    if (Array.isArray(logs)) {
      logsByVault[vaultId] = logs.filter(isLocalAuditLog);
    }
  }
  return logsByVault;
}

function readDb(): LocalAuditDb {
  try {
    const raw = localStorage.getItem(LOCAL_AUDIT_KEY);
    if (!raw) return emptyDb();
    const parsed = JSON.parse(raw) as unknown;
    const logsByVault = isRecord(parsed) ? sanitizeLogsByVault(parsed.logsByVault) : {};
    const persistedNextId = isRecord(parsed) && typeof parsed.nextId === "number" && Number.isFinite(parsed.nextId)
      ? parsed.nextId
      : 1;
    const nextLogId = Object.values(logsByVault).reduce((max, logs) => {
      for (const log of logs) max = Math.max(max, log.id + 1);
      return max;
    }, 1);
    return {
      nextId: Math.max(persistedNextId, nextLogId, 1),
      logsByVault,
    };
  } catch {
    return emptyDb();
  }
}

function writeDb(db: LocalAuditDb): void {
  try {
    localStorage.setItem(LOCAL_AUDIT_KEY, JSON.stringify(db));
  } catch {
    // Local audit logging should not break the user action that produced the event.
  }
}

function applyFilters(logs: LocalAuditLog[], filters: AuditFilters): LocalAuditLog[] {
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

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function fetchLocalAuditLogs(
  vaultId: string,
  filters: AuditFilters,
): Promise<{ logs: AuditLog[]; total: number }> {
  const db = readDb();
  const all = [...(db.logsByVault[vaultId] ?? [])].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  const filtered = applyFilters(all, filters);
  const page = Math.max(1, filters.page);
  const perPage = Math.min(100, Math.max(1, filters.per_page));
  const start = (page - 1) * perPage;
  return { logs: filtered.slice(start, start + perPage), total: filtered.length };
}

export async function exportLocalAuditLogs(
  vaultId: string,
  filters: Omit<AuditFilters, "page" | "per_page">,
  format: "csv" | "json",
): Promise<Blob> {
  const db = readDb();
  const all = [...(db.logsByVault[vaultId] ?? [])].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  const filtered = applyFilters(all, { ...filters, page: 1, per_page: Number.MAX_SAFE_INTEGER });

  if (format === "csv") {
    const header = [
      "id",
      "team_id",
      "vault_id",
      "actor_id",
      "actor_name",
      "action",
      "source",
      "target_type",
      "target_id",
      "target_name",
      "ip_address",
      "created_at",
      "metadata",
    ];
    const rows = [header.map(csvEscape).join(",")];
    for (const log of filtered) {
      rows.push(
        [
          log.id,
          log.team_id,
          log.vault_id ?? "",
          log.actor_id,
          log.actor_name,
          log.action,
          log.source,
          log.target_type ?? "",
          log.target_id ?? "",
          log.target_name ?? "",
          log.ip_address ?? "",
          log.created_at,
          log.metadata ? JSON.stringify(log.metadata) : "",
        ]
          .map(csvEscape)
          .join(","),
      );
    }
    return new Blob([`${rows.join("\n")}\n`], { type: "text/csv" });
  }

  return new Blob([JSON.stringify(filtered, null, 2)], { type: "application/json" });
}

export async function reportLocalClientEvent(
  vaultId: string,
  event: AuditTarget & { action: ClientAction; occurred_at: string },
): Promise<void> {
  const db = readDb();
  const logs = db.logsByVault[vaultId] ?? [];
  const log: LocalAuditLog = {
    id: db.nextId,
    team_id: "local",
    vault_id: event.vault_id ?? vaultId,
    actor_id: "local-user",
    actor_name: "You",
    action: event.action,
    source: "client",
    target_type: event.target_type ?? null,
    target_id: event.target_id ?? null,
    target_name: event.target_name ?? null,
    metadata: event.metadata ?? null,
    ip_address: null,
    created_at: event.occurred_at,
  };

  db.nextId += 1;
  db.logsByVault[vaultId] = [log, ...logs];
  writeDb(db);
}
