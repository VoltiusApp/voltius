import { useTranslation } from "react-i18next";
import type { AuditLog } from "@/services/auditService";
import { formatDateTime, HOUR_MINUTE, SHORT_DATE } from "@/utils/localeFormat";
import { ActionDot, ActorAvatar, AuditBadges, actionName, actorName, auditDetail } from "./AuditEventRow";

interface Props {
  logs: AuditLog[];
}

const COLUMNS = { gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) 11rem" };

function AuditTableRow({ log }: { log: AuditLog }) {
  const target = log.target_name ?? log.target_id;
  return (
    <div
      className="grid gap-3 items-center px-4 py-2 text-sm hover:bg-(--t-bg-elevated) transition-colors"
      style={COLUMNS}
      title={auditDetail(log) || undefined}
    >
      <span className="flex items-center gap-2 min-w-0">
        <ActorAvatar log={log} className="w-6 h-6 text-[11px]" />
        <span className="truncate font-medium text-(--t-text-primary)">{actorName(log)}</span>
        <AuditBadges log={log} />
      </span>
      <span className="flex items-center gap-2 min-w-0">
        <ActionDot log={log} />
        <span className="truncate text-(--t-text-secondary)">{actionName(log.action)}</span>
      </span>
      <span className={`truncate ${target ? "font-medium text-(--t-text-bright)" : "text-(--t-text-dim)"}`}>{target ?? "—"}</span>
      <span className="text-xs text-right whitespace-nowrap tabular-nums text-(--t-text-dim)">
        {formatDateTime(log.created_at, { ...SHORT_DATE, ...HOUR_MINUTE })}
      </span>
    </div>
  );
}

export function AuditList({ logs }: Props) {
  const { t } = useTranslation();

  if (logs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-(--t-text-dim) py-12">
        {t("logs.emptyState")}
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-(--t-border)">
      <div
        className="grid gap-3 px-4 py-2 text-xs font-medium text-(--t-text-dim) uppercase tracking-wide"
        style={COLUMNS}
      >
        <span>{t("logs.list.columns.actor")}</span>
        <span>{t("logs.list.columns.action")}</span>
        <span>{t("logs.list.columns.target")}</span>
        <span className="text-right">{t("logs.list.columns.time")}</span>
      </div>

      {logs.map((log) => <AuditTableRow key={log.id} log={log} />)}
    </div>
  );
}
