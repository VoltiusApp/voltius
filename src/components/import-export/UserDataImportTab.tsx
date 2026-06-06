import { useCallback, useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { USER_DATA_HANDLERS, applyUserDataBundle } from "@/services/user-data/registry";
import { fromUserDataJSON } from "@/services/user-data/formats";
import type { UserDataBundle } from "@/services/user-data/formats";
import { ActionBtn } from "./shared";
import { FileInputArea } from "./FileInputArea";

type UserDataImportStatus =
  | { type: "idle" }
  | { type: "error"; message: string }
  | { type: "ready"; bundle: UserDataBundle };

export function UserDataImportTab({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<UserDataImportStatus>({ type: "idle" });
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  const parse = useCallback((raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) { setStatus({ type: "idle" }); return; }
    try {
      const bundle = fromUserDataJSON(trimmed);
      setStatus({ type: "ready", bundle });
      setIncluded(Object.fromEntries(Object.keys(bundle.sections).map((k) => [k, true])));
    } catch (err) {
      setStatus({ type: "error", message: String(err) });
    }
  }, []);

  useEffect(() => { parse(text); }, [text, parse]);

  const handleImport = async () => {
    if (status.type !== "ready") return;
    setImporting(true);
    try {
      const keys = Object.entries(included).filter(([, v]) => v).map(([k]) => k);
      const { applied } = await applyUserDataBundle(status.bundle, keys);
      setImportResult(`Applied ${applied.length} setting${applied.length !== 1 ? "s" : ""}: ${applied.join(", ")}.`);
      setText("");
      setTimeout(onClose, 1500);
    } catch (err) {
      setImportResult(`Error: ${String(err)}`);
    } finally {
      setImporting(false);
    }
  };

  const selectedCount = Object.values(included).filter(Boolean).length;

  return (
    <div className="flex flex-col gap-4 h-full">
      <FileInputArea
        text={text}
        onChange={setText}
        placeholder={'Paste a Voltius settings JSON here, or drop a file…\n\n{ "type": "voltius-user-data", "version": 2, "sections": { ... } }'}
        fileAccept=".json"
        openLabel="Open File…"
        rows={6}
        hasError={status.type === "error"}
        onClear={() => { setStatus({ type: "idle" }); setImportResult(null); }}
      />

      {status.type === "error" && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-sm"
          style={{ background: "rgba(239,68,68,0.12)", color: "var(--t-status-error)", border: "1px solid rgba(239,68,68,0.25)" }}>
          <Icon icon="lucide:alert-circle" width={15} className="mt-0.5 shrink-0" /> {status.message}
        </div>
      )}

      {status.type === "ready" && (
        <div className="flex flex-col gap-3 p-3 rounded-lg bg-(--t-bg-elevated) border border-(--t-border)">
          <div className="flex items-center gap-2 text-sm text-(--t-text-primary)">
            <Icon icon="lucide:check-circle" width={15} className="text-(--t-status-ok)" />
            Found {Object.keys(status.bundle.sections).length} setting section{Object.keys(status.bundle.sections).length !== 1 ? "s" : ""}
          </div>
          <div className="flex flex-col gap-2 pt-2 border-t border-(--t-border)">
            {USER_DATA_HANDLERS.filter((h) => status.bundle.sections[h.key]).map((h) => (
              <label key={h.key} className="flex items-center gap-2 cursor-pointer select-none">
                <span
                  onClick={() => setIncluded((p) => ({ ...p, [h.key]: !p[h.key] }))}
                  className="flex items-center justify-center w-4 h-4 rounded-sm transition-colors shrink-0"
                  style={{
                    background: included[h.key] ? "var(--t-accent)" : "var(--t-bg-input)",
                    border: `1px solid ${included[h.key] ? "var(--t-accent)" : "var(--t-border-hover)"}`,
                  }}
                >
                  {included[h.key] && <Icon icon="lucide:check" width={10} color="white" />}
                </span>
                <Icon icon={h.icon} width={13} className="text-(--t-text-muted)" />
                <span className="text-sm text-(--t-text-primary)">{h.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {importResult && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
          style={{
            background: importResult.includes("Error") ? "rgba(239,68,68,0.12)" : "rgba(34,197,94,0.1)",
            color: importResult.includes("Error") ? "var(--t-status-error)" : "var(--t-status-ok)",
            border: `1px solid ${importResult.includes("Error") ? "rgba(239,68,68,0.25)" : "rgba(34,197,94,0.2)"}`,
          }}>
          <Icon icon={importResult.includes("Error") ? "lucide:alert-circle" : "lucide:check-circle"} width={14} />
          {importResult}
        </div>
      )}

      <div className="mt-auto pt-3 border-t border-(--t-border)">
        <ActionBtn
          icon={importing ? "lucide:loader" : "lucide:download"}
          label={importing ? "Applying…" : selectedCount > 0 ? `Apply ${selectedCount} section${selectedCount !== 1 ? "s" : ""}` : "Apply"}
          onClick={handleImport} primary disabled={selectedCount === 0 || importing || status.type !== "ready"}
        />
      </div>
    </div>
  );
}
