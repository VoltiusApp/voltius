import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useAuditStore } from "@/stores/auditStore";
import { usePermissions } from "@/hooks/usePermission";
import { useSelectedAuditContext } from "@/hooks/useAuditContext";
import { AuditGate } from "@/components/logs/AuditGate";
import { AuditTimeline } from "@/components/logs/AuditTimeline";
import { applyAuditLogSearch } from "@/components/logs/auditLogToolbarUtils";
import MobilePanelHeader from "@/components/mobile/panels/MobilePanelHeader";
import MobileFilterBar from "@/components/mobile/MobileFilterBar";
import LogsExportSheet from "@/components/mobile/sheets/LogsExportSheet";

export default function MobileLogsScreen() {
  const context = useSelectedAuditContext();
  const can = usePermissions();
  const canFetchAudit = context?.kind === "local" || !!(context && can("VIEW_AUDIT_LOG", context.teamId));
  const auditKey = context
    ? context.kind === "team"
      ? `team:${context.teamId}:${context.vaultId ?? ""}`
      : `local:${context.vaultId}`
    : null;

  const logs = useAuditStore((s) => s.logs);
  const total = useAuditStore((s) => s.total);
  const filters = useAuditStore((s) => s.filters);
  const loading = useAuditStore((s) => s.loading);
  const error = useAuditStore((s) => s.error);
  const fetchLogs = useAuditStore((s) => s.fetchLogs);
  const setFilter = useAuditStore((s) => s.setFilter);

  const [search, setSearch] = useState("");
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    if (context && canFetchAudit) fetchLogs(context);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditKey, canFetchAudit, filters, fetchLogs]);

  const visibleLogs = useMemo(() => applyAuditLogSearch(logs, search), [logs, search]);

  const totalPages = Math.max(1, Math.ceil(total / filters.per_page));
  const page = filters.page;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
      <MobilePanelHeader
        title="Logs"
        right={
          context ? (
            <button
              data-logs-export-open
              onClick={() => setExportOpen(true)}
              className="p-2 text-(--t-text-primary)"
            >
              <Icon icon="lucide:download" width={20} />
            </button>
          ) : undefined
        }
      />

      <AuditGate context={context}>
        <MobileFilterBar value={search} onChange={setSearch} placeholder="Filter logs…" />

        <div className="flex-1 overflow-y-auto">
          {error ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <Icon icon="lucide:triangle-alert" width={28} className="text-(--t-text-dim)" />
              <span className="text-sm text-(--t-text-dim)">{error}</span>
              <button
                onClick={() => { if (context && canFetchAudit) fetchLogs(context); }}
                className="text-sm px-3 py-1.5 rounded-lg"
                style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)", color: "var(--t-text-primary)" }}
              >
                Retry
              </button>
            </div>
          ) : loading && logs.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <Icon icon="lucide:loader-2" width={24} className="animate-spin text-(--t-text-dim)" />
            </div>
          ) : (
            <AuditTimeline logs={visibleLogs} />
          )}
        </div>

        {!error && totalPages > 1 && (
          <div
            className="shrink-0 flex items-center justify-center gap-3 px-4 pt-3 border-t border-(--t-border)"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
          >
            <button
              onClick={() => setFilter("page", page - 1)}
              disabled={page <= 1}
              className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg disabled:opacity-40 transition-opacity"
              style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)", color: "var(--t-text-primary)" }}
            >
              <Icon icon="lucide:chevron-left" width={14} />
              Prev
            </button>
            <span className="text-sm text-(--t-text-dim)">
              Page {page} / {totalPages}
            </span>
            <button
              onClick={() => setFilter("page", page + 1)}
              disabled={page >= totalPages}
              className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg disabled:opacity-40 transition-opacity"
              style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)", color: "var(--t-text-primary)" }}
            >
              Next
              <Icon icon="lucide:chevron-right" width={14} />
            </button>
          </div>
        )}
      </AuditGate>

      {exportOpen && context && (
        <LogsExportSheet context={context} onClose={() => setExportOpen(false)} />
      )}
    </div>
  );
}
