import { useTranslation } from "react-i18next";
import type { AuditLog } from "@/services/auditService";
import { AuditEventRow } from "./AuditEventRow";

interface Props {
  logs: AuditLog[];
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
      {/* Header row */}
      <div
        className="grid gap-3 px-4 py-2 text-xs font-medium text-(--t-text-dim) uppercase tracking-wide"
        style={{ gridTemplateColumns: "1fr 1fr 1fr auto" }}
      >
        <span>{t("logs.list.columns.actor")}</span>
        <span>{t("logs.list.columns.action")}</span>
        <span>{t("logs.list.columns.target")}</span>
        <span className="text-right">{t("logs.list.columns.time")}</span>
      </div>

      {logs.map((log) => (
        <AuditEventRow key={log.id} log={log} showDate />
      ))}
    </div>
  );
}
