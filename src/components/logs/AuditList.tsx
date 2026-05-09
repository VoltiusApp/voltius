import type { AuditLog } from "@/services/auditService";
import { AuditEventRow } from "./AuditEventRow";

interface Props {
  logs: AuditLog[];
}

export function AuditList({ logs }: Props) {
  if (logs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-[var(--t-text-dim)] py-12">
        No events match your filters.
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-[var(--t-border)]">
      {/* Header row */}
      <div
        className="grid gap-3 px-4 py-2 text-xs font-medium text-[var(--t-text-dim)] uppercase tracking-wide"
        style={{ gridTemplateColumns: "1fr 1fr 1fr auto" }}
      >
        <span>Actor</span>
        <span>Action</span>
        <span>Target</span>
        <span className="text-right">Time</span>
      </div>

      {logs.map((log) => (
        <AuditEventRow key={log.id} log={log} showDate />
      ))}
    </div>
  );
}
