import { useState } from "react";
import { Icon } from "@iconify/react";
import BottomSheet from "./BottomSheet";
import { useAuditStore } from "@/stores/auditStore";
import type { AuditContext } from "@/services/auditContext";

export default function LogsExportSheet({ context, onClose }: {
  context: AuditContext;
  onClose: () => void;
}) {
  const exportLogs = useAuditStore((s) => s.exportLogs);
  const [exporting, setExporting] = useState(false);

  async function handleExport(format: "csv" | "json") {
    if (exporting) return;
    setExporting(true);
    try {
      await exportLogs(context, format);
      onClose();
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setExporting(false);
    }
  }

  return (
    <BottomSheet title="Export logs" onClose={onClose}>
      <button
        data-logs-export="csv"
        className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl text-left active:bg-(--t-bg-card)"
        style={{ color: "var(--t-text-primary)" }}
        disabled={exporting}
        onClick={() => void handleExport("csv")}
      >
        {exporting ? (
          <Icon icon="lucide:loader-2" width={18} className="animate-spin" />
        ) : (
          <Icon icon="lucide:file-text" width={18} />
        )}
        <span className="text-sm font-medium">Export as CSV</span>
      </button>
      <button
        data-logs-export="json"
        className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl text-left active:bg-(--t-bg-card)"
        style={{ color: "var(--t-text-primary)" }}
        disabled={exporting}
        onClick={() => void handleExport("json")}
      >
        {exporting ? (
          <Icon icon="lucide:loader-2" width={18} className="animate-spin" />
        ) : (
          <Icon icon="lucide:braces" width={18} />
        )}
        <span className="text-sm font-medium">Export as JSON</span>
      </button>
    </BottomSheet>
  );
}
