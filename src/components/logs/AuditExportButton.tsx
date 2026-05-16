import { useState, useRef, useEffect } from "react";
import { Icon } from "@iconify/react";
import { useAuditStore } from "@/stores/auditStore";
import type { AuditContext } from "@/services/auditContext";

interface Props {
  context: AuditContext;
}

export function AuditExportButton({ context }: Props) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportLogs = useAuditStore((s) => s.exportLogs);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function doExport(format: "csv" | "json") {
    setOpen(false);
    setExporting(true);
    setExportError(null);
    try {
      await exportLogs(context, format);
    } catch (e) {
      console.error("Failed to export audit logs", e);
      setExportError("Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={exporting}
        className="flex items-center gap-1.5 text-sm px-3 h-8 rounded-lg transition-colors"
        style={{
          background: "var(--t-bg-elevated)",
          border: "1px solid var(--t-border)",
          color: "var(--t-text-primary)",
        }}
      >
        {exporting ? (
          <Icon icon="lucide:loader-2" width={14} className="animate-spin" />
        ) : (
          <Icon icon="lucide:download" width={14} />
        )}
        Export
        <Icon icon="lucide:chevron-down" width={12} className="text-[var(--t-text-dim)]" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 rounded-lg overflow-hidden shadow-lg z-10 min-w-[120px]"
          style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}
        >
          {(["csv", "json"] as const).map((fmt) => (
            <button
              key={fmt}
              onClick={() => doExport(fmt)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--t-bg-elevated)] transition-colors text-[var(--t-text-primary)]"
            >
              <Icon icon={fmt === "csv" ? "lucide:file-spreadsheet" : "lucide:file-json"} width={14} />
              {fmt.toUpperCase()}
            </button>
          ))}
        </div>
      )}
      {exportError && (
        <p className="mt-1 text-xs" style={{ color: "var(--t-error, #f87171)" }} role="alert">
          {exportError}
        </p>
      )}
    </div>
  );
}
