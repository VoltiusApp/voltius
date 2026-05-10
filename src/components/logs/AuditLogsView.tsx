import { useCallback, useEffect, useMemo, useState } from "react";
import { onTeamSseEvent } from "@/services/sync";
import { Icon } from "@iconify/react";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { useAuditStore } from "@/stores/auditStore";
import { usePermissions } from "@/hooks/usePermission";
import { AuditGate } from "./AuditGate";
import { AuditFilters } from "./AuditFilters";
import { AuditTimeline } from "./AuditTimeline";
import { AuditHorizontalTimeline } from "./AuditHorizontalTimeline";
import { AuditList } from "./AuditList";
import { AuditExportButton } from "./AuditExportButton";
import { applyAuditLogSearch } from "./auditLogToolbarUtils";
import type { AuditContext } from "@/services/auditContext";

// ─── Audit context derivation ─────────────────────────────────────────────────

function useSelectedAuditContext(): AuditContext | null {
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const vaults = useVaultStore((s) => s.vaults);
  const teams = useTeamStore((s) => s.teams);

  if (selectedVaultIds.length !== 1) return null;
  const vid = selectedVaultIds[0];

  const team = teams.find((t) => t.id === vid);
  if (team) return { kind: "team", teamId: team.id };

  const vault = vaults.find((v) => v.id === vid);
  if (!vault) return null;
  if (vault.teamId) return { kind: "team", teamId: vault.teamId, vaultId: vault.id };

  return { kind: "local", vaultId: vault.id };
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function Pagination({
  total,
  page,
  perPage,
  onPageChange,
}: {
  total: number;
  page: number;
  perPage: number;
  onPageChange: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-3 px-4 py-3 border-t border-[var(--t-border)]">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg disabled:opacity-40 transition-opacity"
        style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)", color: "var(--t-text-primary)" }}
      >
        <Icon icon="lucide:chevron-left" width={14} />
        Prev
      </button>
      <span className="text-sm text-[var(--t-text-dim)]">
        Page {page} / {totalPages}
      </span>
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg disabled:opacity-40 transition-opacity"
        style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)", color: "var(--t-text-primary)" }}
      >
        Next
        <Icon icon="lucide:chevron-right" width={14} />
      </button>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function AuditLogsView() {
  const auditContext = useSelectedAuditContext();
  const can = usePermissions();
  const canFetchAudit = auditContext?.kind === "local" || !!(auditContext && can("VIEW_AUDIT_LOG", auditContext.teamId));
  const auditKey = auditContext
    ? auditContext.kind === "team"
      ? `team:${auditContext.teamId}:${auditContext.vaultId ?? ""}`
      : `local:${auditContext.vaultId}`
    : null;

  const logs = useAuditStore((s) => s.logs);
  const total = useAuditStore((s) => s.total);
  const filters = useAuditStore((s) => s.filters);
  const layout = useAuditStore((s) => s.layout);
  const loading = useAuditStore((s) => s.loading);
  const error = useAuditStore((s) => s.error);
  const fetchLogs = useAuditStore((s) => s.fetchLogs);
  const setFilter = useAuditStore((s) => s.setFilter);
  const setLayout = useAuditStore((s) => s.setLayout);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (auditContext && canFetchAudit) fetchLogs(auditContext);
  }, [auditKey, canFetchAudit, filters, fetchLogs]);

  const refresh = useCallback(() => {
    if (auditContext && canFetchAudit && !document.hidden) fetchLogs(auditContext);
  }, [auditContext, canFetchAudit, fetchLogs]);

  useEffect(() => {
    document.addEventListener("visibilitychange", refresh);
    const unsub = auditContext?.kind === "team"
      ? onTeamSseEvent((teamId) => { if (teamId === auditContext.teamId) refresh(); })
      : undefined;
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      unsub?.();
    };
  }, [auditKey, refresh]);

  const actors = useMemo(() => {
    const seen = new Map<string, string>();
    for (const log of logs) seen.set(log.actor_id, log.actor_name);
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [logs]);

  const visibleLogs = useMemo(() => applyAuditLogSearch(logs, search), [logs, search]);

  function handlePageChange(p: number) {
    setFilter("page", p);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[var(--t-bg-base)]">
      <AuditGate context={auditContext}>
        <AuditFilters
          actors={actors}
          search={search}
          onSearchChange={setSearch}
          layout={layout}
          onLayoutChange={setLayout}
          actions={auditContext ? <AuditExportButton context={auditContext} /> : null}
        />

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {error ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <Icon icon="lucide:triangle-alert" width={28} className="text-[var(--t-text-dim)]" />
              <span className="text-sm text-[var(--t-text-dim)]">{error}</span>
              <button
                onClick={() => { if (auditContext && canFetchAudit) fetchLogs(auditContext); }}
                className="text-sm px-3 py-1.5 rounded-lg"
                style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)", color: "var(--t-text-primary)" }}
              >
                Retry
              </button>
            </div>
          ) : loading && logs.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <Icon icon="lucide:loader-2" width={24} className="animate-spin text-[var(--t-text-dim)]" />
            </div>
          ) : layout === "timeline" ? (
            <AuditTimeline logs={visibleLogs} />
          ) : layout === "horizontal" ? (
            <AuditHorizontalTimeline logs={visibleLogs} />
          ) : (
            <AuditList logs={visibleLogs} />
          )}
        </div>

        {/* Pagination */}
        {!error && (
          <Pagination
            total={total}
            page={filters.page}
            perPage={filters.per_page}
            onPageChange={handlePageChange}
          />
        )}
      </AuditGate>
    </div>
  );
}
