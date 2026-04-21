import type { DiskInfo } from "../types";

function fmtSize(kb: number): string {
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(0)}MB`;
  if (kb < 1024 * 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)}GB`;
  return `${(kb / 1024 / 1024 / 1024).toFixed(1)}TB`;
}

export function DiskSection({ disks }: { disks: DiskInfo[] }) {
  return (
    <div className="px-4 pt-3 pb-3 border-b border-[var(--t-border)]">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--t-text-dim)] mb-2">
        Disk
      </p>
      {disks.map((disk) => {
        const pct = disk.total_kb > 0 ? Math.round((disk.used_kb / disk.total_kb) * 100) : 0;
        const barColor =
          pct > 90 ? "var(--t-status-error)" : pct > 75 ? "#f59e0b" : "var(--t-accent)";
        return (
          <div key={disk.mount} className="mb-2.5 last:mb-0">
            <div className="flex justify-between text-[11px] mb-1">
              <span className="font-mono text-[var(--t-text-secondary)] truncate max-w-[120px]">
                {disk.mount}
              </span>
              <span className="text-[var(--t-text-muted)] shrink-0 ml-2">
                {fmtSize(disk.used_kb)} / {fmtSize(disk.total_kb)}
              </span>
            </div>
            <div className="w-full h-1 rounded-full bg-[var(--t-bg-input)] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, background: barColor }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
