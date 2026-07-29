import type { AuditFilters, AuditLog } from "@/services/auditService";
import type { AuditTarget, ClientAuditAction } from "@/services/auditContext";
import { applyAuditFilters, csvEscape } from "@/services/auditExportCore";

const LOCAL_AUDIT_KEY = "voltius-local-audit-logs";

/**
 * Ring-buffer bound for the per-vault local log.
 *
 * `writeDb` swallows QuotaExceededError, so an unbounded log does not fail
 * loudly — it silently stops recording. Dropping the oldest history is the
 * better of the two failures: a log that stops recording TODAY's activity is
 * worse than one missing last year's.
 */
export const MAX_LOCAL_LOGS_PER_VAULT = 5000;

/**
 * Serialized-size ring-buffer bound for the per-vault local log, in UTF-16
 * characters (~1 MB) — a second, independent bound alongside
 * `MAX_LOCAL_LOGS_PER_VAULT`.
 *
 * The entry cap alone assumed a roughly-fixed row size. That assumption broke
 * once `localMetadata.command` (an agent-run shell command, bounded but up to
 * 2000 chars — see `auditSeam.ts`) became part of the log: a vault of
 * oversized rows can blow the origin's ~5 MB localStorage quota at a small
 * fraction of the entry cap, and `writeDb` swallows `QuotaExceededError`, so
 * that failure is silent — the trail just stops growing.
 */
export const MAX_LOCAL_LOG_CHARS_PER_VAULT = 512_000;

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

/**
 * Trim a newest-first log list to both the entry-count cap and the
 * serialized-char budget, dropping from the OLDEST end (ring-buffer
 * semantics: newest kept).
 *
 * Walks newest -> oldest, accumulating each entry's own `JSON.stringify`
 * length exactly once — never the whole array's, and never inside a loop —
 * so this is one stringify per entry, not one per entry per entry.
 *
 * The newest entry is always kept, even alone over budget: a log that keeps
 * nothing is worse than one that keeps one oversized row.
 */
export function trimToBudget(logs: LocalAuditLog[]): LocalAuditLog[] {
  const capped = logs.length > MAX_LOCAL_LOGS_PER_VAULT ? logs.slice(0, MAX_LOCAL_LOGS_PER_VAULT) : logs;
  let totalChars = 0;
  for (let i = 0; i < capped.length; i++) {
    const entryChars = JSON.stringify(capped[i]).length;
    if (i > 0 && totalChars + entryChars > MAX_LOCAL_LOG_CHARS_PER_VAULT) {
      return capped.slice(0, i);
    }
    totalChars += entryChars;
  }
  return capped;
}

function writeDb(db: LocalAuditDb): void {
  try {
    localStorage.setItem(LOCAL_AUDIT_KEY, JSON.stringify(db));
  } catch {
    // Local audit logging should not break the user action that produced the event.
  }
}

export async function fetchLocalAuditLogs(
  vaultId: string,
  filters: AuditFilters,
): Promise<{ logs: AuditLog[]; total: number }> {
  const db = readDb();
  const all = [...(db.logsByVault[vaultId] ?? [])].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  const filtered = applyAuditFilters(all, filters);
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
  const filtered = applyAuditFilters(all, filters);

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
  event: AuditTarget & { action: ClientAuditAction; occurred_at: string },
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
  // Only the vault being written is trimmed — the others are not growing, and
  // sweeping them would turn every append into a whole-database rewrite.
  db.logsByVault[vaultId] = trimToBudget([log, ...logs]);
  writeDb(db);
}
