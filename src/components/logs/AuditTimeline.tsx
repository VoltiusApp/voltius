import type { AuditLog } from "@/services/auditService";
import { AuditEventRow } from "./AuditEventRow";

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === now.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function groupByDay(logs: AuditLog[]): Array<{ key: string; label: string; items: AuditLog[] }> {
  const groups = new Map<string, AuditLog[]>();
  for (const log of logs) {
    const key = new Date(log.created_at).toDateString();
    const existing = groups.get(key) ?? [];
    existing.push(log);
    groups.set(key, existing);
  }
  return Array.from(groups.entries()).map(([key, items]) => ({
    key,
    label: formatDayLabel(items[0].created_at),
    items,
  }));
}

interface Props {
  logs: AuditLog[];
}

export function AuditTimeline({ logs }: Props) {
  const groups = groupByDay(logs);

  if (groups.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-[var(--t-text-dim)] py-12">
        No events match your filters.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 px-2 py-2">
      {groups.map((group) => (
        <div key={group.key}>
          {/* Day separator */}
          <div className="flex items-center gap-2 px-2 py-2 mt-2">
            <div className="flex-1 h-px bg-[var(--t-border)]" />
            <span className="text-xs font-medium text-[var(--t-text-dim)] shrink-0">{group.label}</span>
            <div className="flex-1 h-px bg-[var(--t-border)]" />
          </div>
          {/* Events */}
          {group.items.map((log) => (
            <AuditEventRow key={log.id} log={log} />
          ))}
        </div>
      ))}
    </div>
  );
}
